'use strict';

/**
 * Tests for the reference server's own behaviour: the parts the contract leaves
 * to the implementation (archive inspection, encryption at rest, tokens, limits,
 * the command line). Contract behaviour is covered by ../conformance/.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const { inspectArchive, ArchiveError } = require('../lib/tar');
const { UserStore } = require('../lib/auth');
const { Storage, parseKey } = require('../lib/storage');
const { multipartField, parseEtags } = require('../server');
const { makeArchive, sampleArchive, sha256, client, startReferenceStore } = require('../conformance/helpers');

const BIN = path.join(__dirname, '..', 'bin', 'brain-store.js');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('archive inspection', () => {
  it('counts regular files and ignores directories', async () => {
    const { fileCount } = await inspectArchive(makeArchive({ 'a.md': 'a', 'dir/b.md': 'b', 'index.json': '{}' }));
    assert.equal(fileCount, 3);
  });

  it('counts zero for an empty archive', async () => {
    assert.equal((await inspectArchive(makeArchive({}))).fileCount, 0);
  });

  it('reads archives written by the system tar, as the brain CLI produces them', async () => {
    const dir = tmpDir('brain-store-tar-');
    try {
      fs.mkdirSync(path.join(dir, 'professional', 'deep', 'nested'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.json'), '{}');
      fs.writeFileSync(path.join(dir, 'professional', 'one.md'), 'one');
      // A name past the 100-byte ustar limit forces a pax or GNU long-name entry.
      // Kept well under Windows' 260-character path limit.
      fs.writeFileSync(path.join(dir, 'professional', 'deep', 'nested', 'x'.repeat(110) + '.md'), 'long');
      const out = path.join(tmpDir('brain-store-out-'), 'b.tar.gz');
      // COPYFILE_DISABLE stops macOS tar from adding an AppleDouble "._name" entry
      // beside every file, which would otherwise be counted as regular files too.
      execFileSync('tar', ['czf', out, '-C', dir, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
      assert.equal((await inspectArchive(fs.readFileSync(out))).fileCount, 3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects data that is not gzip', async () => {
    await assert.rejects(inspectArchive(Buffer.from('plain text')), ArchiveError);
  });

  it('rejects gzip that does not contain a tar archive', async () => {
    await assert.rejects(inspectArchive(zlib.gzipSync(Buffer.alloc(2048, 7))), /not a tar archive/);
  });

  it('rejects a truncated archive', async () => {
    const full = zlib.gunzipSync(makeArchive({ 'a.md': 'x'.repeat(4000) }));
    await assert.rejects(inspectArchive(zlib.gzipSync(full.subarray(0, 1024))), /truncated/);
  });

  it('stops inflating past the size bound', async () => {
    const bomb = zlib.gzipSync(Buffer.concat([
      zlib.gunzipSync(makeArchive({ 'big.md': 'A'.repeat(4 * 1024 * 1024) })),
    ]));
    assert.ok(bomb.length < 64 * 1024, 'the fixture should compress well');
    await assert.rejects(inspectArchive(bomb, { maxInflatedBytes: 1024 * 1024 }), /beyond the allowed size/);
  });

  it('stops counting past the entry bound', async () => {
    const files = {};
    for (let i = 0; i < 50; i++) files[`m${i}.md`] = String(i);
    await assert.rejects(inspectArchive(makeArchive(files), { maxEntries: 10 }), /too many entries/);
  });
});

describe('users and tokens', () => {
  let dir;
  before(() => { dir = tmpDir('brain-store-users-'); });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('never writes the token to disk', () => {
    const users = new UserStore(dir);
    const { token } = users.add('alice', 'alice@example.test');
    const onDisk = fs.readFileSync(path.join(dir, 'users.json'), 'utf8');
    assert.ok(!onDisk.includes(token));
    assert.ok(onDisk.includes(sha256(Buffer.from(token))));
  });

  it('keeps users.json private to the owner', { skip: process.platform === 'win32' }, () => {
    assert.equal(fs.statSync(path.join(dir, 'users.json')).mode & 0o077, 0);
  });

  it('authenticates the right user and nobody else', () => {
    const users = new UserStore(dir);
    const bob = users.add('bob');
    assert.equal(users.authenticate(bob.token).name, 'bob');
    assert.equal(users.authenticate(bob.token + 'x'), null);
    assert.equal(users.authenticate('bst_' + 'A'.repeat(43)), null);
    assert.equal(users.authenticate(''), null);
    assert.equal(users.authenticate(undefined), null);
  });

  it('rotating a token retires the old one', () => {
    const users = new UserStore(dir);
    const carol = users.add('carol');
    const rotated = users.rotate('carol');
    assert.equal(users.authenticate(carol.token), null);
    assert.equal(users.authenticate(rotated.token).name, 'carol');
  });

  it('refuses duplicate and unsafe names', () => {
    const users = new UserStore(dir);
    assert.throws(() => users.add('alice'), /already exists/);
    for (const bad of ['', '../etc', 'a/b', 'a b', '.hidden']) {
      assert.throws(() => users.add(bad), /user name/);
    }
  });

  it('sees users added by another process without a restart', () => {
    const running = new UserStore(dir);
    running.list();
    const other = new UserStore(dir);
    const dave = other.add('dave');
    assert.equal(running.authenticate(dave.token).name, 'dave');
  });
});

describe('storage', () => {
  it('refuses IDs that could leave the data directory', () => {
    const dir = tmpDir('brain-store-paths-');
    try {
      const storage = new Storage(dir);
      assert.equal(storage.readMeta('../../etc', crypto.randomUUID()), null);
      assert.equal(storage.readMeta('usr_ok', '../../../etc/passwd'), null);
      assert.throws(() => storage.readVersion('usr_ok', crypto.randomUUID(), '../meta.json'), /version not found/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps only the configured number of snapshots', async () => {
    const dir = tmpDir('brain-store-retention-');
    try {
      const storage = new Storage(dir, { versionRetention: 3 });
      const brain = storage.createBrain('usr_r', 'default');
      for (let i = 0; i < 8; i++) {
        await storage.commitArchive('usr_r', brain.id, { archive: sampleArchive(1, 'v' + i), fileCount: 2 });
      }
      assert.equal(storage.listVersions('usr_r', brain.id).length, 3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses keys as hex or base64 and rejects the wrong length', () => {
    const raw = crypto.randomBytes(32);
    assert.ok(parseKey(raw.toString('hex')).equals(raw));
    assert.ok(parseKey(raw.toString('base64')).equals(raw));
    assert.equal(parseKey(''), null);
    assert.throws(() => parseKey('abcd'), /32 bytes/);
  });
});

describe('encryption at rest', () => {
  let dir;
  const key = crypto.randomBytes(32);
  before(() => { dir = tmpDir('brain-store-enc-'); });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('stores ciphertext but serves and checksums the plaintext', async () => {
    const storage = new Storage(dir, { encryptionKey: key });
    const brain = storage.createBrain('usr_e', 'default');
    const archive = sampleArchive(3, 'secret-marker');
    const meta = await storage.commitArchive('usr_e', brain.id, { archive, fileCount: 4 });

    const onDisk = fs.readFileSync(path.join(dir, 'brains', 'usr_e', brain.id, 'current.bin'));
    assert.ok(!onDisk.equals(archive));
    assert.equal(onDisk.subarray(0, 7).toString('latin1'), 'BSTORE1');
    assert.equal(meta.checksum, sha256(archive));
    assert.equal(meta.size_bytes, archive.length);
    assert.ok(storage.readArchive('usr_e', brain.id).equals(archive));
  });

  it('seals snapshots too', async () => {
    const storage = new Storage(dir, { encryptionKey: key });
    const [brain] = storage.listBrains('usr_e');
    const before = storage.readArchive('usr_e', brain.id);
    await storage.commitArchive('usr_e', brain.id, { archive: sampleArchive(3, 'next'), fileCount: 4 });
    const [snapshot] = storage.listVersions('usr_e', brain.id);
    const raw = fs.readFileSync(path.join(dir, 'brains', 'usr_e', brain.id, 'versions', snapshot.version));
    assert.equal(raw.subarray(0, 7).toString('latin1'), 'BSTORE1');
    assert.ok(storage.readVersion('usr_e', brain.id, snapshot.version).equals(before));
  });

  it('cannot open one user\'s archive with another user\'s key', async () => {
    const storage = new Storage(dir, { encryptionKey: key });
    const [brain] = storage.listBrains('usr_e');
    const sealed = fs.readFileSync(path.join(dir, 'brains', 'usr_e', brain.id, 'current.bin'));
    assert.throws(() => storage.open('usr_other', sealed));
  });

  it('detects tampering', async () => {
    const storage = new Storage(dir, { encryptionKey: key });
    const [brain] = storage.listBrains('usr_e');
    const file = path.join(dir, 'brains', 'usr_e', brain.id, 'current.bin');
    const sealed = fs.readFileSync(file);
    sealed[sealed.length - 20] ^= 0xff;
    assert.throws(() => storage.open('usr_e', sealed));
  });

  it('refuses to serve ciphertext when the key is missing', () => {
    const keyless = new Storage(dir);
    const [brain] = keyless.listBrains('usr_e');
    assert.throws(() => keyless.readArchive('usr_e', brain.id), /no encryption key/);
  });

  it('reads archives written before encryption was switched on', async () => {
    const plainDir = tmpDir('brain-store-migrate-');
    try {
      const plain = new Storage(plainDir);
      const brain = plain.createBrain('usr_m', 'default');
      const archive = sampleArchive(2, 'before-key');
      await plain.commitArchive('usr_m', brain.id, { archive, fileCount: 3 });

      const keyed = new Storage(plainDir, { encryptionKey: key });
      assert.ok(keyed.readArchive('usr_m', brain.id).equals(archive));
    } finally {
      fs.rmSync(plainDir, { recursive: true, force: true });
    }
  });
});

describe('request parsing', () => {
  it('finds the named file among several multipart fields', () => {
    const boundary = 'XBOUNDARYX';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nhello\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="brain"; filename="brain.tar.gz"\r\nContent-Type: application/gzip\r\n\r\n`),
      Buffer.from([0x1f, 0x8b, 0x08, 0x0d, 0x0a, 0x2d, 0x2d, 0x00]),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const field = multipartField(body, `multipart/form-data; boundary=${boundary}`, 'brain');
    assert.deepEqual([...field], [0x1f, 0x8b, 0x08, 0x0d, 0x0a, 0x2d, 0x2d, 0x00]);
    assert.equal(multipartField(body, `multipart/form-data; boundary=${boundary}`, 'missing'), null);
    assert.equal(multipartField(body, 'application/json', 'brain'), null);
  });

  it('does not mistake a filename for the field name', () => {
    const boundary = 'B';
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; filename="brain"; name="other"\r\n\r\ndata\r\n--${boundary}--\r\n`);
    assert.equal(multipartField(body, `multipart/form-data; boundary=${boundary}`, 'brain'), null);
  });

  it('parses entity tags', () => {
    assert.deepEqual(parseEtags('"abc"'), ['abc']);
    assert.deepEqual(parseEtags('W/"abc", "def"'), ['abc', 'def']);
    assert.deepEqual(parseEtags('*'), ['*']);
    assert.equal(parseEtags(undefined), null);
  });
});

describe('limits', () => {
  it('refuses an archive larger than the upload limit with 413', async () => {
    const ref = await startReferenceStore({ maxUploadBytes: 2048 });
    try {
      const api = client(ref.url, ref.token);
      const { data: brain } = await api.json('POST', '/api/brains', { name: 'small' });
      const big = makeArchive({ 'big.md': crypto.randomBytes(8192).toString('hex') });
      assert.ok(big.length > 2048);
      // The server may close the socket as it answers, so a transport error is
      // also an acceptable outcome for the client here.
      const outcome = await api.upload(brain.id, big).then((r) => r.status, () => 413);
      assert.equal(outcome, 413);
      assert.equal((await api.download(brain.id)).status, 404);
    } finally {
      await ref.close();
    }
  });

  it('enforces the per-user storage quota', async () => {
    const ref = await startReferenceStore({ maxUserBytes: 1500 });
    try {
      const api = client(ref.url, ref.token);
      const { data: brain } = await api.json('POST', '/api/brains', { name: 'quota' });
      const res = await api.upload(brain.id, makeArchive({ 'big.md': crypto.randomBytes(4096).toString('hex') }));
      assert.equal(res.status, 413);
      assert.match(res.data.error, /quota/);
    } finally {
      await ref.close();
    }
  });

  it('caps the number of brains per user', async () => {
    const ref = await startReferenceStore({ maxBrains: 2 });
    try {
      const api = client(ref.url, ref.token);
      assert.equal((await api.json('POST', '/api/brains', { name: 'one' })).status, 201);
      assert.equal((await api.json('POST', '/api/brains', { name: 'two' })).status, 201);
      assert.equal((await api.json('POST', '/api/brains', { name: 'three' })).status, 403);
    } finally {
      await ref.close();
    }
  });

  it('slows down token guessing with 429 and Retry-After', async () => {
    const ref = await startReferenceStore({ failedAuthPerMinute: 3 });
    try {
      const stranger = client(ref.url, 'bst_wrong');
      const statuses = [];
      let retryAfter = null;
      for (let i = 0; i < 5; i++) {
        const res = await stranger.json('GET', '/api/brains');
        statuses.push(res.status);
        if (res.status === 429) retryAfter = res.headers.get('retry-after');
      }
      assert.deepEqual(statuses, [401, 401, 401, 429, 429]);
      assert.ok(Number(retryAfter) >= 1);
      // A valid token is unaffected by someone else's failures.
      assert.equal((await client(ref.url, ref.token).json('GET', '/api/brains')).status, 200);
    } finally {
      await ref.close();
    }
  });

  it('rate-limits a single user', async () => {
    const ref = await startReferenceStore({ requestsPerMinute: 2 });
    try {
      const api = client(ref.url, ref.token);
      const statuses = [];
      for (let i = 0; i < 3; i++) statuses.push((await api.json('GET', '/api/brains')).status);
      assert.deepEqual(statuses, [200, 200, 429]);
    } finally {
      await ref.close();
    }
  });
});

describe('server hygiene', () => {
  it('never logs a token', async () => {
    const lines = [];
    const ref = await startReferenceStore({ log: (entry) => lines.push(JSON.stringify(entry)) });
    try {
      await client(ref.url, ref.token).json('GET', '/api/brains');
      await client(ref.url, 'bst_wrong-token').json('GET', '/api/brains');
      assert.ok(lines.length >= 2);
      for (const line of lines) {
        assert.ok(!line.includes(ref.token) && !line.includes('bst_wrong-token'), line);
      }
    } finally {
      await ref.close();
    }
  });

  it('does not offer the device-code or refresh endpoints', async () => {
    const ref = await startReferenceStore();
    try {
      const anonymous = client(ref.url, null);
      assert.equal((await anonymous.json('POST', '/auth/device/request', {})).status, 404);
      assert.equal((await anonymous.json('POST', '/auth/refresh', { refresh_token: 'x' })).status, 404);
    } finally {
      await ref.close();
    }
  });

  it('answers unknown paths and methods cleanly', async () => {
    const ref = await startReferenceStore();
    try {
      const api = client(ref.url, ref.token);
      assert.equal((await api.json('GET', '/nope')).status, 404);
      assert.equal((await api.json('PATCH', '/api/brains', {})).status, 405);
      assert.equal((await api.json('POST', '/api/brains', null, { 'Content-Type': 'application/json' })).status, 201);
    } finally {
      await ref.close();
    }
  });
});

describe('command line', () => {
  let dir;
  before(() => { dir = tmpDir('brain-store-cli-'); });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = (...args) => execFileSync(process.execPath, [BIN, ...args, '--data', dir], { encoding: 'utf8' });

  it('creates a user with a first brain, and prints the token once', () => {
    const out = run('user', 'add', 'erin', '--email', 'erin@example.test');
    const token = /(bst_[A-Za-z0-9_-]+)/.exec(out)[1];
    const users = new UserStore(dir);
    const erin = users.authenticate(token);
    assert.equal(erin.email, 'erin@example.test');
    assert.equal(new Storage(dir).listBrains(erin.id).length, 1);
    assert.match(run('user', 'list'), /erin/);
  });

  it('removes a user, and with --purge their data', () => {
    const users = new UserStore(dir);
    const erin = users.find('erin');
    run('user', 'remove', 'erin', '--purge');
    assert.equal(new UserStore(dir).find('erin'), null);
    assert.equal(fs.existsSync(path.join(dir, 'brains', erin.id)), false);
  });

  it('prints a usable encryption key', () => {
    const key = execFileSync(process.execPath, [BIN, 'keygen'], { encoding: 'utf8' }).trim();
    assert.equal(parseKey(key).length, 32);
  });

  it('serves, and shuts down on SIGTERM', { skip: process.platform === 'win32' }, async () => {
    const created = new UserStore(dir).add('frank');
    const child = spawn(process.execPath, [BIN, 'serve', '--port', '0', '--data', dir], {
      env: { ...process.env, STORE_QUIET: '1' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    try {
      const url = await new Promise((resolve, reject) => {
        let err = '';
        child.stderr.on('data', (chunk) => {
          err += chunk;
          const m = /listening on (http:\/\/\S+)/.exec(err);
          if (m) resolve(m[1]);
        });
        child.on('exit', () => reject(new Error('server exited early: ' + err)));
        setTimeout(() => reject(new Error('server did not start: ' + err)), 10000).unref();
      });
      const res = await client(url, created.token).json('GET', '/auth/me');
      assert.equal(res.status, 200);
      assert.equal(res.data.user.name, 'frank');
    } finally {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
  });
});
