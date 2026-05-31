const { describe, it, beforeEach, afterEach, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const cloud = require('../src/cloud-sync');

// ---------------------------------------------------------------------------
// A local stub of the Brain Cloud API. Because `request()`/`downloadFile()` use
// the plain `http` module for http:// URLs, we can exercise the ENTIRE cloud
// flow (device auth, token refresh, push, pull, status) end-to-end against a
// real server — no mocking of internals required.
// ---------------------------------------------------------------------------
let server;
let apiUrl;
let routes; // mutable per-test handler map: { 'METHOD /path': (req,res,bodyBuf) => void }

function send(res, status, json, headers = {}) {
  const body = typeof json === 'string' ? json : JSON.stringify(json);
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body);
}

before(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      // Strip query string for routing, keep dynamic :id segments matched loosely.
      const url = req.url.split('?')[0];
      const exact = routes[`${req.method} ${url}`];
      if (exact) return exact(req, res, body);
      // Loose match for /api/brains/<id> and /api/brains/<id>/sync
      const syncMatch = url.match(/^\/api\/brains\/[^/]+\/sync$/);
      if (syncMatch && routes[`${req.method} /api/brains/:id/sync`]) {
        return routes[`${req.method} /api/brains/:id/sync`](req, res, body);
      }
      const brainMatch = url.match(/^\/api\/brains\/[^/]+$/);
      if (brainMatch && routes[`${req.method} /api/brains/:id`]) {
        return routes[`${req.method} /api/brains/:id`](req, res, body);
      }
      send(res, 404, { error: 'not found' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  apiUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
});

let brainDir;
function setup() {
  brainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-cloud-'));
  routes = {};
}
function teardown() {
  fs.rmSync(brainDir, { recursive: true, force: true });
}

// A config that makes getValidToken pass without a refresh round-trip.
function loggedInConfig(extra = {}) {
  return {
    api_url: apiUrl,
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    expires_at: Math.floor(Date.now() / 1000) + 3600, // 1h out → valid
    brain_id: 'brain-123',
    user_email: 'me@example.com',
    connected_at: new Date().toISOString(),
    ...extra,
  };
}

describe('cloud-sync: config round-trip & error handling', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('writeConfig creates .cloud dir; readConfig round-trips', () => {
    assert.equal(cloud.readConfig(brainDir), null); // missing → null
    cloud.writeConfig(brainDir, { api_url: apiUrl, access_token: 'x' });
    const { cloudDir, configPath } = cloud.resolvePaths(brainDir);
    assert.ok(fs.existsSync(cloudDir));
    assert.ok(fs.existsSync(configPath));
    assert.equal(cloud.readConfig(brainDir).access_token, 'x');
  });

  it('readConfig returns null on corrupt JSON (never throws)', () => {
    const { cloudDir, configPath } = cloud.resolvePaths(brainDir);
    fs.mkdirSync(cloudDir, { recursive: true });
    fs.writeFileSync(configPath, '{ this is not json');
    assert.equal(cloud.readConfig(brainDir), null);
  });

  it('logout removes the entire .cloud directory; safe when absent', () => {
    cloud.writeConfig(brainDir, loggedInConfig());
    const { cloudDir } = cloud.resolvePaths(brainDir);
    assert.ok(fs.existsSync(cloudDir));
    cloud.logout(brainDir);
    assert.ok(!fs.existsSync(cloudDir));
    // Idempotent — logging out again must not throw.
    assert.doesNotThrow(() => cloud.logout(brainDir));
  });
});

describe('cloud-sync: packBrain / unpackBrain', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('round-trips brain files and excludes .sync/.cloud/_archived/.DS_Store', () => {
    fs.mkdirSync(path.join(brainDir, 'professional'), { recursive: true });
    fs.writeFileSync(path.join(brainDir, 'index.json'), '{"memory_count":1}');
    fs.writeFileSync(path.join(brainDir, 'professional', 'm.md'), 'keepme');
    // Excluded payloads
    fs.mkdirSync(path.join(brainDir, '.sync'), { recursive: true });
    fs.writeFileSync(path.join(brainDir, '.sync', 'secret'), 'nope');
    fs.mkdirSync(path.join(brainDir, '.cloud'), { recursive: true });
    fs.writeFileSync(path.join(brainDir, '.cloud', 'config.json'), 'nope');
    fs.mkdirSync(path.join(brainDir, '_archived'), { recursive: true });
    fs.writeFileSync(path.join(brainDir, '_archived', 'old.md'), 'nope');
    fs.writeFileSync(path.join(brainDir, '.DS_Store'), 'nope');

    const tar = cloud.packBrain(brainDir);
    try {
      assert.ok(fs.existsSync(tar));
      const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-unpack-'));
      try {
        cloud.unpackBrain(tar, dest);
        assert.equal(fs.readFileSync(path.join(dest, 'professional', 'm.md'), 'utf8'), 'keepme');
        assert.ok(fs.existsSync(path.join(dest, 'index.json')));
        assert.ok(!fs.existsSync(path.join(dest, '.sync')), '.sync excluded');
        assert.ok(!fs.existsSync(path.join(dest, '.cloud')), '.cloud excluded');
        assert.ok(!fs.existsSync(path.join(dest, '_archived')), '_archived excluded');
        assert.ok(!fs.existsSync(path.join(dest, '.DS_Store')), '.DS_Store excluded');
      } finally {
        fs.rmSync(dest, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(tar, { force: true });
    }
  });

  it('unpackBrain throws on a missing tar file', () => {
    assert.throws(() => cloud.unpackBrain(path.join(brainDir, 'nope.tar.gz'), brainDir));
  });
});

describe('cloud-sync: getValidToken', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('throws "Not logged in" when there is no config', async () => {
    await assert.rejects(cloud.getValidToken(brainDir), /Not logged in/);
  });

  it('returns the stored token while it is still valid', async () => {
    cloud.writeConfig(brainDir, loggedInConfig({ access_token: 'still-good' }));
    assert.equal(await cloud.getValidToken(brainDir), 'still-good');
  });

  it('throws when expired and no refresh token is present', async () => {
    cloud.writeConfig(brainDir, loggedInConfig({
      expires_at: Math.floor(Date.now() / 1000) - 100,
      refresh_token: undefined,
    }));
    await assert.rejects(cloud.getValidToken(brainDir), /no refresh token/);
  });

  it('refreshes and persists new tokens when expired', async () => {
    cloud.writeConfig(brainDir, loggedInConfig({
      expires_at: Math.floor(Date.now() / 1000) - 100, // expired
    }));
    const newExp = Math.floor(Date.now() / 1000) + 7200;
    let refreshCalls = 0;
    routes['POST /auth/refresh'] = (req, res, body) => {
      refreshCalls++;
      assert.equal(JSON.parse(body).refresh_token, 'refresh-1');
      send(res, 200, { access_token: 'access-2', refresh_token: 'refresh-2', expires_at: newExp });
    };
    const token = await cloud.getValidToken(brainDir);
    assert.equal(token, 'access-2');
    assert.equal(refreshCalls, 1);
    // Persisted to disk for next time.
    const cfg = cloud.readConfig(brainDir);
    assert.equal(cfg.access_token, 'access-2');
    assert.equal(cfg.refresh_token, 'refresh-2');
    assert.equal(cfg.expires_at, newExp);
  });

  it('throws when the refresh endpoint rejects', async () => {
    cloud.writeConfig(brainDir, loggedInConfig({ expires_at: Math.floor(Date.now() / 1000) - 100 }));
    routes['POST /auth/refresh'] = (req, res) => send(res, 401, { error: 'bad refresh' });
    await assert.rejects(cloud.getValidToken(brainDir), /refresh failed/i);
  });
});

describe('cloud-sync: device-code login flow', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('requestDeviceCode surfaces the code; non-200 throws', async () => {
    routes['POST /auth/device/request'] = (req, res) =>
      send(res, 200, { device_code: 'dev-1', user_code: 'ABCD', verify_url: `${apiUrl}/v`, expires_in: 600 });
    const info = await cloud.requestDeviceCode(apiUrl);
    assert.equal(info.user_code, 'ABCD');

    routes['POST /auth/device/request'] = (req, res) => send(res, 500, { error: 'down' });
    await assert.rejects(cloud.requestDeviceCode(apiUrl), /Failed to request device code/);
  });

  it('pollDeviceCode waits through "pending" then returns tokens on approval', async () => {
    let calls = 0;
    routes['POST /auth/device/poll'] = (req, res, body) => {
      assert.equal(JSON.parse(body).device_code, 'dev-1');
      calls++;
      if (calls < 2) return send(res, 200, { status: 'pending' });
      send(res, 200, { status: 'approved', tokens: { access_token: 'a', refresh_token: 'r', expires_at: 1 } });
    };
    const tokens = await cloud.pollDeviceCode(apiUrl, 'dev-1', 5 /*ms interval*/, 5000);
    assert.equal(tokens.access_token, 'a');
    assert.equal(calls, 2);
  });

  it('pollDeviceCode throws when the device code expired (404)', async () => {
    routes['POST /auth/device/poll'] = (req, res) => send(res, 404, { error: 'expired' });
    await assert.rejects(cloud.pollDeviceCode(apiUrl, 'dev-1', 5, 5000), /expired/i);
  });

  it('pollDeviceCode times out if never approved', async () => {
    routes['POST /auth/device/poll'] = (req, res) => send(res, 200, { status: 'pending' });
    await assert.rejects(cloud.pollDeviceCode(apiUrl, 'dev-1', 5, 40 /*ms deadline*/), /timed out/i);
  });

  it('login() then waitForApproval() persists tokens, user_email and brain_id', async () => {
    routes['POST /auth/device/request'] = (req, res) =>
      send(res, 200, { device_code: 'dev-1', user_code: 'WXYZ', verify_url: `${apiUrl}/v`, expires_in: 600 });
    routes['POST /auth/device/poll'] = (req, res) =>
      send(res, 200, { status: 'approved', tokens: { access_token: 'tok', refresh_token: 'ref', expires_at: 999 } });
    routes['GET /auth/me'] = (req, res) => {
      assert.equal(req.headers['authorization'], 'Bearer tok');
      send(res, 200, { user: { email: 'login@example.com' } });
    };
    routes['GET /api/brains'] = (req, res) => send(res, 200, [{ id: 'brain-xyz' }]);

    const { user_code, waitForApproval } = await cloud.login(brainDir, apiUrl);
    assert.equal(user_code, 'WXYZ');
    await waitForApproval();

    const cfg = cloud.readConfig(brainDir);
    assert.equal(cfg.access_token, 'tok');
    assert.equal(cfg.user_email, 'login@example.com');
    assert.equal(cfg.brain_id, 'brain-xyz');
    assert.equal(cfg.api_url, apiUrl);
  });

  it('login tolerates an empty brains list (brain_id stays null)', async () => {
    routes['POST /auth/device/request'] = (req, res) =>
      send(res, 200, { device_code: 'dev-1', user_code: 'WXYZ', verify_url: 'x', expires_in: 600 });
    routes['POST /auth/device/poll'] = (req, res) =>
      send(res, 200, { status: 'approved', tokens: { access_token: 'tok', refresh_token: 'ref', expires_at: 1 } });
    routes['GET /auth/me'] = (req, res) => send(res, 200, { user: { email: 'a@b.c' } });
    routes['GET /api/brains'] = (req, res) => send(res, 200, []);

    const { waitForApproval } = await cloud.login(brainDir, apiUrl);
    await waitForApproval();
    assert.equal(cloud.readConfig(brainDir).brain_id, null);
  });
});

describe('cloud-sync: push', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('throws "Not logged in" with no config', async () => {
    await assert.rejects(cloud.push(brainDir), /Not logged in/);
  });

  it('throws "No brain linked" when brain_id is missing', async () => {
    cloud.writeConfig(brainDir, loggedInConfig({ brain_id: null }));
    await assert.rejects(cloud.push(brainDir), /No brain linked/);
  });

  it('uploads the packed brain and records last_push', async () => {
    fs.writeFileSync(path.join(brainDir, 'index.json'), '{"memory_count":0}');
    cloud.writeConfig(brainDir, loggedInConfig());
    let uploadedBytes = 0;
    routes['PUT /api/brains/:id/sync'] = (req, res, body) => {
      uploadedBytes = body.length;
      assert.equal(req.headers['authorization'], 'Bearer access-1');
      assert.match(req.headers['content-type'], /multipart\/form-data/);
      send(res, 200, { size_bytes: 123, file_count: 1, checksum: 'sha-abc' });
    };
    const r = await cloud.push(brainDir);
    assert.equal(r.size_bytes, 123);
    assert.equal(r.checksum, 'sha-abc');
    assert.ok(typeof r.local_size === 'number' && r.local_size > 0);
    assert.ok(uploadedBytes > 0, 'server received a non-empty multipart body');
    assert.ok(cloud.readConfig(brainDir).last_push, 'last_push timestamp written');
  });

  it('surfaces a server-side push error', async () => {
    fs.writeFileSync(path.join(brainDir, 'index.json'), '{}');
    cloud.writeConfig(brainDir, loggedInConfig());
    routes['PUT /api/brains/:id/sync'] = (req, res) => send(res, 413, { error: 'too big' });
    await assert.rejects(cloud.push(brainDir), /Push failed \(413\): too big/);
  });

  it('cleans up the temp tarball even when upload fails', async () => {
    fs.writeFileSync(path.join(brainDir, 'index.json'), '{}');
    cloud.writeConfig(brainDir, loggedInConfig());
    routes['PUT /api/brains/:id/sync'] = (req, res) => send(res, 500, { error: 'boom' });
    const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('brain-upload-'));
    await assert.rejects(cloud.push(brainDir));
    const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('brain-upload-'));
    assert.deepEqual(after, before, 'no brain-upload-*.tar.gz left behind');
  });
});

describe('cloud-sync: pull', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('throws "Not logged in" / "No brain linked" guards', async () => {
    await assert.rejects(cloud.pull(brainDir), /Not logged in/);
    cloud.writeConfig(brainDir, loggedInConfig({ brain_id: null }));
    await assert.rejects(cloud.pull(brainDir), /No brain linked/);
  });

  it('downloads, unpacks into the brain dir, and records last_pull', async () => {
    cloud.writeConfig(brainDir, loggedInConfig());
    // Build a real tarball the server will hand back.
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-remote-'));
    fs.mkdirSync(path.join(srcDir, 'personal'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'personal', 'note.md'), 'pulled-content');
    const remoteTar = cloud.packBrain(srcDir);
    const tarBytes = fs.readFileSync(remoteTar);
    routes['GET /api/brains/:id/sync'] = (req, res) => {
      assert.equal(req.headers['authorization'], 'Bearer access-1');
      res.writeHead(200, { 'Content-Type': 'application/gzip', 'x-checksum': 'sum-999' });
      res.end(tarBytes);
    };
    try {
      const r = await cloud.pull(brainDir);
      assert.equal(r.checksum, 'sum-999');
      assert.ok(r.size_bytes > 0);
      assert.equal(fs.readFileSync(path.join(brainDir, 'personal', 'note.md'), 'utf8'), 'pulled-content');
      assert.ok(cloud.readConfig(brainDir).last_pull, 'last_pull timestamp written');
    } finally {
      fs.rmSync(remoteTar, { force: true });
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  });

  it('propagates a non-200 download error and cleans up the temp file', async () => {
    cloud.writeConfig(brainDir, loggedInConfig());
    routes['GET /api/brains/:id/sync'] = (req, res) => send(res, 404, { error: 'gone' });
    const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('brain-download-'));
    await assert.rejects(cloud.pull(brainDir), /Download failed \(404\)/);
    const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('brain-download-'));
    assert.deepEqual(after, before, 'no brain-download-*.tar.gz left behind');
  });
});

describe('cloud-sync: status', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('reports disconnected when there is no config', async () => {
    assert.deepEqual(await cloud.status(brainDir), { connected: false });
  });

  it('reports full status using live brain details', async () => {
    cloud.writeConfig(brainDir, loggedInConfig());
    routes['GET /auth/me'] = (req, res) => send(res, 200, { user: { email: 'live@example.com' } });
    routes['GET /api/brains/:id'] = (req, res) =>
      send(res, 200, { name: 'My Brain', size_bytes: 4096, file_count: 7, last_synced_at: '2026-01-01T00:00:00Z' });
    const s = await cloud.status(brainDir);
    assert.equal(s.connected, true);
    assert.equal(s.brain_name, 'My Brain');
    assert.equal(s.brain_size, 4096);
    assert.equal(s.brain_files, 7);
    assert.equal(s.last_synced, '2026-01-01T00:00:00Z');
    assert.equal(s.api_url, apiUrl);
  });

  it('still reports config-level status when the token cannot be validated', async () => {
    // Expired with no refresh token → getValidToken throws → caught → brain/user stay null.
    cloud.writeConfig(brainDir, loggedInConfig({
      expires_at: Math.floor(Date.now() / 1000) - 100,
      refresh_token: undefined,
      last_push: '2026-05-30T10:00:00Z',
    }));
    const s = await cloud.status(brainDir);
    assert.equal(s.connected, true);
    assert.equal(s.brain_name, null);
    assert.equal(s.user_email, 'me@example.com'); // falls back to config value
    assert.equal(s.last_push, '2026-05-30T10:00:00Z');
  });
});

describe('cloud-sync: HTTP helpers via request()', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('jsonRequest throws a descriptive error on a non-JSON body', async () => {
    // getValidToken's refresh path runs jsonRequest; a non-JSON 200 should throw.
    cloud.writeConfig(brainDir, loggedInConfig({ expires_at: Math.floor(Date.now() / 1000) - 100 }));
    routes['POST /auth/refresh'] = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('<html>not json</html>');
    };
    await assert.rejects(cloud.getValidToken(brainDir), /Non-JSON response/);
  });

  it('request() follows a 302 redirect (device request)', async () => {
    routes['POST /auth/device/request'] = (req, res) => {
      res.writeHead(302, { Location: `${apiUrl}/auth/device/request2` });
      res.end();
    };
    routes['GET /auth/device/request2'] = (req, res) =>
      send(res, 200, { device_code: 'd', user_code: 'RED', verify_url: 'v', expires_in: 1 });
    // 302 switches POST→GET, so the redirect target is a GET route.
    const info = await cloud.requestDeviceCode(apiUrl);
    assert.equal(info.user_code, 'RED');
  });
});
