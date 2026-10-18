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

describe('cloud-sync: choosing a brain', () => {
  let ref;
  const dirs = [];
  const brainDir = (label) => { const d = newBrain(label); dirs.push(d); return d; };

  before(async () => { ref = await startReferenceStore(); });
  after(async () => {
    await ref.close();
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('links the first brain by default and names the others', async () => {
    const first = await cloud.loginWithToken(brainDir('first'), ref.url, ref.token);
    assert.equal(first.created, true);
    const work = await cloud.loginWithToken(brainDir('work'), ref.url, ref.token, { brain: 'Work' });
    assert.equal(work.created, true);
    assert.equal(work.brain_name, 'Work');
    assert.notEqual(work.brain_id, first.brain_id);

    const again = await cloud.loginWithToken(brainDir('again'), ref.url, ref.token);
    assert.equal(again.brain_id, first.brain_id);
    assert.deepEqual(again.brains.map((b) => b.name).sort(), ['Work', 'default']);
  });

  it('matches a name ignoring case, and refuses an unknown ID', async () => {
    const dir = brainDir('case');
    const result = await cloud.loginWithToken(dir, ref.url, ref.token, { brain: 'WORK' });
    assert.equal(result.brain_name, 'Work');
    assert.equal(result.created, false);
    await assert.rejects(
      cloud.loginWithToken(brainDir('ghost'), ref.url, ref.token, { brain: '00000000-0000-4000-8000-000000000000' }),
      /No brain with ID/);
  });

  it('refuses a name that matches several brains', () => {
    const brains = [{ id: 'a', name: 'Notes' }, { id: 'b', name: 'notes' }];
    assert.throws(() => cloud.matchBrain(brains, 'NOTES'), /2 brains are named/);
    assert.equal(cloud.matchBrain(brains, 'b').id, 'b');
    assert.equal(cloud.matchBrain(brains, 'other'), null);
  });

  it('a fresh login cannot push over a brain that already has an archive', async () => {
    const laptop = brainDir('laptop');
    await cloud.loginWithToken(laptop, ref.url, ref.token);
    remember(laptop, 'one.md', 'the first device fills the empty brain');
    await cloud.push(laptop);

    const other = brainDir('other');
    await cloud.loginWithToken(other, ref.url, ref.token);
    remember(other, 'two.md', 'a new device that never pulled');
    await assert.rejects(cloud.push(other), { name: 'PushConflictError' });
    await cloud.pull(other);
    assert.ok(fs.existsSync(path.join(other, 'professional', 'one.md')));
  });

  it('use switches the link, leaves ~/.brain alone, and guards the push', async () => {
    const dir = brainDir('switch');
    await cloud.loginWithToken(dir, ref.url, ref.token);
    await cloud.pull(dir);
    remember(dir, 'mine.md', 'local memory');

    const listed = await cloud.listBrains(dir);
    assert.equal(listed.filter((b) => b.linked).length, 1);
    assert.equal(listed.find((b) => b.linked).name, 'default');

    // "Work" is empty, so the first push into it goes through.
    const used = await cloud.useBrain(dir, 'work');
    assert.equal(used.changed, true);
    assert.equal(used.brain.name, 'Work');
    const config = cloud.readConfig(dir);
    assert.equal(config.brain_name, 'Work');
    assert.equal(config.base_checksum, undefined);
    assert.ok(fs.existsSync(path.join(dir, 'professional', 'mine.md')));
    await cloud.push(dir);

    // Back to "default", which has an archive: pushing over it needs a pull or --force.
    await cloud.useBrain(dir, 'default');
    await assert.rejects(cloud.push(dir), { name: 'PushConflictError' });
    assert.equal((await cloud.useBrain(dir, 'default')).changed, false);
  });

  it('use refuses an unknown name unless asked to create it', async () => {
    const dir = brainDir('create');
    await cloud.loginWithToken(dir, ref.url, ref.token);
    await assert.rejects(cloud.useBrain(dir, 'Studia'), /Add --create/);
    const made = await cloud.useBrain(dir, 'Studia', { create: true });
    assert.equal(made.created, true);
    assert.equal((await cloud.listBrains(dir)).length, 3);
  });
});
