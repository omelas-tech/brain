/**
 * End to end: the brain CLI's sync engine against the reference store server.
 *
 * Two brain directories stand in for two devices that share one account. The
 * point of the exercise is the second half: a device that has not pulled the
 * other's changes must not be able to overwrite them by accident.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cloud = require('../src/cloud-sync');
const { startReferenceStore } = require('../store/conformance/helpers');

const CLI = path.join(__dirname, '..', 'bin', 'cloud-sync.js');

function newBrain(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `brain-${label}-`));
  fs.mkdirSync(path.join(dir, 'professional'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ memories: {} }));
  return dir;
}

function remember(dir, name, text) {
  fs.writeFileSync(path.join(dir, 'professional', name), `---\nid: ${name}\n---\n\n${text}\n`);
}

describe('cloud-sync against brain-store', () => {
  let ref;
  let laptop;
  let desktop;

  before(async () => {
    ref = await startReferenceStore();
    laptop = newBrain('laptop');
    desktop = newBrain('desktop');
  });

  after(async () => {
    await ref.close();
    for (const dir of [laptop, desktop]) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('logs in with a static token and creates a first brain', async () => {
    const result = await cloud.loginWithToken(laptop, ref.url + '/', ref.token);
    assert.equal(result.api_url, ref.url);
    assert.match(result.brain_id, /^[0-9a-f-]{36}$/);

    const config = cloud.readConfig(laptop);
    assert.equal(config.token_type, 'static');
    assert.equal(config.refresh_token, undefined);
    assert.equal(await cloud.getValidToken(laptop), ref.token);
  });

  it('a second device links to the same brain rather than creating another', async () => {
    const result = await cloud.loginWithToken(desktop, ref.url, ref.token);
    assert.equal(result.brain_id, cloud.readConfig(laptop).brain_id);
  });

  it('rejects a bad token without writing a config', async () => {
    const dir = newBrain('stranger');
    try {
      await assert.rejects(cloud.loginWithToken(dir, ref.url, 'bst_wrong'), /rejected this token/);
      assert.equal(cloud.readConfig(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to send a token over plain HTTP to another host', async () => {
    const dir = newBrain('http');
    try {
      await assert.rejects(cloud.loginWithToken(dir, 'http://store.example.test', ref.token), /plain HTTP/);
      assert.equal(cloud.isSecureUrl('https://store.example.test'), true);
      assert.equal(cloud.isSecureUrl('http://localhost:8787'), true);
      assert.equal(cloud.isSecureUrl('http://192.168.1.20:8787'), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pushes from one device and pulls on the other', async () => {
    remember(laptop, 'one.md', 'written on the laptop');
    const pushed = await cloud.push(laptop);
    assert.equal(pushed.file_count, 2); // index.json + one.md, and no AppleDouble entries
    assert.equal(cloud.readConfig(laptop).base_checksum, pushed.checksum);

    const pulled = await cloud.pull(desktop);
    assert.equal(pulled.checksum, pushed.checksum);
    assert.equal(cloud.readConfig(desktop).base_checksum, pushed.checksum);
    assert.match(fs.readFileSync(path.join(desktop, 'professional', 'one.md'), 'utf8'), /written on the laptop/);
  });

  it('never uploads the stored token', async () => {
    const raw = ref.store.storage.readArchive(
      ref.store.users.find('conformance-a').id, cloud.readConfig(laptop).brain_id);
    const listing = execFileSync('tar', ['tzf', '-'], { input: raw, encoding: 'utf8' });
    assert.ok(!listing.includes('.cloud'), listing);
  });

  it('stops a device from overwriting changes it has not pulled', async () => {
    remember(desktop, 'two.md', 'written on the desktop');
    const fromDesktop = await cloud.push(desktop);

    remember(laptop, 'three.md', 'written on the laptop, without pulling first');
    await assert.rejects(cloud.push(laptop), (err) => {
      assert.equal(err.name, 'PushConflictError');
      assert.equal(err.code, 'PUSH_CONFLICT');
      assert.equal(err.remote_checksum, fromDesktop.checksum);
      assert.match(err.message, /brain cloud pull/);
      return true;
    });

    // The store still holds the desktop's archive.
    const check = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-check-'));
    try {
      await cloud.loginWithToken(check, ref.url, ref.token);
      await cloud.pull(check);
      assert.ok(fs.existsSync(path.join(check, 'professional', 'two.md')));
      assert.ok(!fs.existsSync(path.join(check, 'professional', 'three.md')));
    } finally {
      fs.rmSync(check, { recursive: true, force: true });
    }
  });

  it('pull, then push, carries both devices\' memories', async () => {
    await cloud.pull(laptop);
    const pushed = await cloud.push(laptop);
    assert.equal(pushed.file_count, 4); // index.json + one, two, three

    await cloud.pull(desktop);
    for (const name of ['one.md', 'two.md', 'three.md']) {
      assert.ok(fs.existsSync(path.join(desktop, 'professional', name)), name);
    }
  });

  it('--force overwrites on purpose', async () => {
    remember(desktop, 'four.md', 'desktop moves ahead');
    await cloud.push(desktop);

    remember(laptop, 'five.md', 'laptop insists');
    await assert.rejects(cloud.push(laptop), /have not pulled/);
    const forced = await cloud.push(laptop, { force: true });
    assert.equal(cloud.readConfig(laptop).base_checksum, forced.checksum);

    // Forcing loses nothing for good: the store kept a snapshot of what it replaced.
    const versions = await cloud.listVersions(laptop);
    assert.ok(versions.length >= 1);
  });

  it('a brain with no recorded checksum pushes unconditionally, as older versions did', async () => {
    const config = cloud.readConfig(desktop);
    delete config.base_checksum;
    cloud.writeConfig(desktop, config);
    const pushed = await cloud.push(desktop);
    assert.equal(cloud.readConfig(desktop).base_checksum, pushed.checksum);
  });

  describe('the command line', () => {
    // Asynchronous on purpose: the store under test runs in this process, so a
    // blocking spawn would stop it from answering the child it is waiting for.
    const run = (dir, args, opts = {}) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [CLI, ...args], {
        env: { ...process.env, BRAIN_DIR: dir, BRAIN_STORE_TOKEN: '', ...(opts.env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c) => { stdout += c; });
      child.stderr.on('data', (c) => { stderr += c; });
      child.on('error', reject);
      child.on('close', (status) => {
        if (status === 0) return resolve(stdout);
        const err = new Error(`exit ${status}: ${stderr}`);
        err.status = status;
        err.stderr = stderr;
        reject(err);
      });
      child.stdin.end(opts.input || '');
    });

    it('reads the token from standard input', async () => {
      const dir = newBrain('cli-stdin');
      try {
        const out = await run(dir, ['login', '--api-url', ref.url, '--token-stdin'], { input: ref.token + '\n' });
        assert.match(out, /Logged in as/);
        assert.equal(cloud.readConfig(dir).access_token, ref.token);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('reads the token from the environment', async () => {
      const dir = newBrain('cli-env');
      try {
        await run(dir, ['login', '--api-url', ref.url], { env: { BRAIN_STORE_TOKEN: ref.token } });
        assert.equal(cloud.readConfig(dir).token_type, 'static');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('explains a conflict and exits non-zero; --force goes through', async () => {
      const a = newBrain('cli-a');
      const b = newBrain('cli-b');
      try {
        for (const dir of [a, b]) await run(dir, ['login', '--api-url', ref.url, '--token', ref.token]);
        await run(a, ['pull']);
        await run(b, ['pull']);
        remember(a, 'from-a.md', 'a');
        await run(a, ['push']);
        remember(b, 'from-b.md', 'b');
        await assert.rejects(run(b, ['push']), (err) => {
          assert.notEqual(err.status, 0);
          assert.match(err.stderr, /have not pulled/);
          return true;
        });
        assert.match(await run(b, ['push', '--force']), /Push complete/);
      } finally {
        for (const dir of [a, b]) fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
