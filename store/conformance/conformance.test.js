'use strict';

/**
 * Store contract conformance suite.
 *
 * Black-box: it speaks HTTP to a store and knows nothing about how the store is
 * built. Point it at any implementation:
 *
 *   STORE_URL=https://store.example STORE_TOKEN=... node --test store/conformance/
 *
 *   STORE_TOKEN_2   a second user's token; enables the tenant-isolation tests
 *   STORE_BRAIN_ID  use this (disposable!) brain instead of creating one, for
 *                   accounts that cannot create another brain
 *   STORE_CONTRACT  "1" to check only contract version 1; default "1.1"
 *
 * With no STORE_URL, the suite starts the reference server on a temporary
 * directory and tests that.
 *
 * The suite overwrites the brain it works on. Never point it at a brain you care
 * about.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { sampleArchive, makeArchive, sha256, client, startReferenceStore } = require('./helpers');

const LEVEL_1_1 = (process.env.STORE_CONTRACT || '1.1') !== '1';
const UNKNOWN_BRAIN = '00000000-0000-4000-8000-000000000000';

describe('store contract', () => {
  let reference = null;
  let api;
  let api2 = null;
  let anonymous;
  let brainId;
  let createdBrain = false;

  let first; // archives uploaded along the way
  let second;

  before(async () => {
    let url = process.env.STORE_URL;
    let token = process.env.STORE_TOKEN;
    let token2 = process.env.STORE_TOKEN_2;
    if (!url) {
      reference = await startReferenceStore();
      ({ url, token, token2 } = reference);
    }
    assert.ok(token, 'STORE_TOKEN is required when STORE_URL is set');
    api = client(url, token);
    anonymous = client(url, null);
    if (token2) api2 = client(url, token2);
  });

  after(async () => {
    if (createdBrain && brainId) await api.json('DELETE', `/api/brains/${brainId}`);
    if (reference) await reference.close();
  });

  // -- version 1 -------------------------------------------------------------

  describe('health and authentication', () => {
    it('GET /health answers without credentials', async () => {
      const res = await anonymous.json('GET', '/health');
      assert.equal(res.status, 200);
      assert.equal(res.data.status, 'ok');
    });

    it('rejects requests without a token', async () => {
      assert.equal((await anonymous.json('GET', '/api/brains')).status, 401);
      assert.equal((await anonymous.json('GET', '/auth/me')).status, 401);
    });

    it('rejects an unknown token', async () => {
      const stranger = client(process.env.STORE_URL || reference.url, 'bst_not-a-real-token');
      assert.equal((await stranger.json('GET', '/api/brains')).status, 401);
    });

    it('GET /auth/me describes the caller', async () => {
      const res = await api.json('GET', '/auth/me');
      assert.equal(res.status, 200);
      assert.equal(typeof res.data.user, 'object');
      assert.equal(typeof res.data.user.id, 'string');
      assert.equal(typeof res.data.user.email, 'string');
    });

    it('errors are JSON objects with an "error" string', async () => {
      const res = await anonymous.json('GET', '/api/brains');
      assert.equal(typeof res.data.error, 'string');
    });
  });

  describe('brain records', () => {
    it('creates a brain, or adopts STORE_BRAIN_ID', async () => {
      if (process.env.STORE_BRAIN_ID) {
        brainId = process.env.STORE_BRAIN_ID;
        return;
      }
      const name = 'conformance-' + Date.now();
      const res = await api.json('POST', '/api/brains', { name });
      assert.equal(res.status, 201, `could not create a brain (${res.status}); set STORE_BRAIN_ID to a disposable brain`);
      assert.match(res.data.id, /^[0-9a-f-]{36}$/i);
      assert.equal(res.data.name, name);
      brainId = res.data.id;
      createdBrain = true;
    });

    it('lists the brain as a bare JSON array', async () => {
      const res = await api.json('GET', '/api/brains');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data));
      assert.ok(res.data.some((b) => b.id === brainId));
    });

    it('returns the brain record with the documented fields', async () => {
      const res = await api.json('GET', `/api/brains/${brainId}`);
      assert.equal(res.status, 200);
      for (const field of ['id', 'name', 'size_bytes', 'file_count', 'last_synced_at', 'checksum', 'created_at']) {
        assert.ok(field in res.data, `missing field ${field}`);
      }
    });

    it('answers 404 for an unknown brain and 400 or 404 for a malformed ID', async () => {
      assert.equal((await api.json('GET', `/api/brains/${UNKNOWN_BRAIN}`)).status, 404);
      assert.ok([400, 404].includes((await api.json('GET', '/api/brains/not-a-uuid')).status));
    });
  });

  describe('sync', () => {
    it('downloading a brain that was never uploaded is 404', { skip: Boolean(process.env.STORE_BRAIN_ID) }, async () => {
      assert.equal((await api.download(brainId)).status, 404);
    });

    it('accepts an upload and reports size, file count and SHA-256 of the archive', async () => {
      first = sampleArchive(6, 'first'); // 6 memories + index.json
      const res = await api.upload(brainId, first);
      assert.equal(res.status, 200);
      assert.equal(res.data.size_bytes, first.length);
      assert.equal(res.data.file_count, 7);
      assert.equal(res.data.checksum, sha256(first));
    });

    it('returns exactly the bytes that were uploaded, with X-Checksum', async () => {
      const res = await api.download(brainId);
      assert.equal(res.status, 200);
      assert.ok(res.body.equals(first), 'downloaded archive differs from the upload');
      assert.equal(res.headers.get('x-checksum'), sha256(first));
    });

    it('reflects the upload in the brain record', async () => {
      const res = await api.json('GET', `/api/brains/${brainId}`);
      assert.equal(res.data.size_bytes, first.length);
      assert.equal(res.data.file_count, 7);
      assert.equal(res.data.checksum, sha256(first));
      assert.ok(!Number.isNaN(Date.parse(res.data.last_synced_at)));
    });

    it('rejects a request with no "brain" file field', async () => {
      const res = await api.upload(brainId, first, { field: 'something-else' });
      assert.equal(res.status, 400);
    });
  });

  describe('snapshots', () => {
    it('keeps the previous archive as a snapshot when a new one is uploaded', async () => {
      second = sampleArchive(6, 'second');
      assert.equal((await api.upload(brainId, second)).status, 200);

      const res = await api.json('GET', `/api/brains/${brainId}/versions`);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.data.versions));
      assert.ok(res.data.versions.length >= 1);
      assert.equal(res.data.total, res.data.versions.length);
      assert.equal(typeof res.data.versions[0].version, 'string');
    });

    it('lists snapshots newest first', async () => {
      const { data } = await api.json('GET', `/api/brains/${brainId}/versions`);
      const names = data.versions.map((v) => v.version);
      assert.deepEqual(names, [...names].sort().reverse());
    });

    it('serves a snapshot through ?version=', async () => {
      const { data } = await api.json('GET', `/api/brains/${brainId}/versions`);
      const res = await api.download(brainId, { query: `?version=${encodeURIComponent(data.versions[0].version)}` });
      assert.equal(res.status, 200);
      assert.ok(res.body.equals(first), 'newest snapshot should be the archive that was just replaced');
    });

    it('refuses version names that try to leave the snapshot directory', async () => {
      for (const name of ['../meta.json', '..%2F..%2Fusers.json', 'nope.tar.gz']) {
        const res = await api.download(brainId, { query: `?version=${name}` });
        assert.ok([400, 404].includes(res.status), `${name} -> ${res.status}`);
      }
    });

    it('restores a snapshot as the live archive', async () => {
      const { data } = await api.json('GET', `/api/brains/${brainId}/versions`);
      const version = data.versions[0].version;
      const res = await api.json('POST', `/api/brains/${brainId}/versions/${encodeURIComponent(version)}/restore`);
      assert.equal(res.status, 200);
      assert.equal(res.data.restored_version, version);
      assert.ok((await api.download(brainId)).body.equals(first));
    });

    it('answers 404 when restoring a snapshot that does not exist', async () => {
      const res = await api.json('POST', `/api/brains/${brainId}/versions/19990101T000000.000000000.tar.gz/restore`);
      assert.equal(res.status, 404);
    });
  });

  describe('the empty-push guard', () => {
    it('refuses an empty archive over a brain that has memories', async () => {
      const res = await api.upload(brainId, makeArchive({}));
      assert.equal(res.status, 409);
      assert.ok((await api.download(brainId)).body.equals(first), 'a refused push must change nothing');
    });

    it('accepts it with ?force=true', async () => {
      const empty = makeArchive({});
      const res = await api.upload(brainId, empty, { query: '?force=true' });
      assert.equal(res.status, 200);
      assert.equal(res.data.file_count, 0);
      // Put real content back for the tests that follow.
      assert.equal((await api.upload(brainId, first)).status, 200);
    });
  });

  describe('tenant isolation', () => {
    it('hides one user\'s brain from another', async (t) => {
      if (!api2) return t.skip('no second token (STORE_TOKEN_2)');
      assert.equal((await api2.json('GET', `/api/brains/${brainId}`)).status, 404);
      assert.equal((await api2.download(brainId)).status, 404);
      assert.equal((await api2.upload(brainId, sampleArchive(1, 'intruder'))).status, 404);
      assert.equal((await api2.json('GET', `/api/brains/${brainId}/versions`)).status, 404);
      const list = await api2.json('GET', '/api/brains');
      assert.ok(!list.data.some((b) => b.id === brainId));
      assert.ok((await api.download(brainId)).body.equals(first), 'the owner\'s archive must be untouched');
    });
  });

  // -- version 1.1: conditional sync -------------------------------------------

  describe('conditional sync (contract 1.1)', { skip: !LEVEL_1_1 }, () => {
    it('GET /health advertises contract 1.1 or later', async () => {
      const { data } = await anonymous.json('GET', '/health');
      assert.ok(parseFloat(data.contract) >= 1.1, `contract is ${data.contract}`);
    });

    it('sends the checksum as a strong ETag on download and upload', async () => {
      const down = await api.download(brainId);
      assert.equal(down.headers.get('etag'), `"${sha256(first)}"`);
      const up = await api.upload(brainId, first);
      assert.equal(up.headers.get('etag'), `"${sha256(first)}"`);
    });

    it('answers 304 to If-None-Match when the client is current', async () => {
      const res = await api.download(brainId, { headers: { 'If-None-Match': `"${sha256(first)}"` } });
      assert.equal(res.status, 304);
      assert.equal(res.body.length, 0);
    });

    it('sends the archive when If-None-Match is stale', async () => {
      const res = await api.download(brainId, { headers: { 'If-None-Match': `"${'0'.repeat(64)}"` } });
      assert.equal(res.status, 200);
      assert.ok(res.body.equals(first));
    });

    it('accepts an upload whose If-Match names the current archive', async () => {
      second = sampleArchive(6, 'second-conditional');
      const res = await api.upload(brainId, second, { headers: { 'If-Match': `"${sha256(first)}"` } });
      assert.equal(res.status, 200);
      assert.equal(res.data.checksum, sha256(second));
    });

    it('refuses a stale If-Match with 412, reports the current checksum, and changes nothing', async () => {
      const late = sampleArchive(6, 'late-writer');
      const res = await api.upload(brainId, late, { headers: { 'If-Match': `"${sha256(first)}"` } });
      assert.equal(res.status, 412);
      assert.equal(res.data.current_checksum, sha256(second));
      assert.ok((await api.download(brainId)).body.equals(second), 'a refused push must change nothing');
      const { data } = await api.json('GET', `/api/brains/${brainId}`);
      assert.equal(data.checksum, sha256(second));
    });

    it('lets exactly one of two racing writers win', async () => {
      const base = sha256(second);
      const a = sampleArchive(6, 'racer-a');
      const b = sampleArchive(6, 'racer-b');
      const results = await Promise.all([
        api.upload(brainId, a, { headers: { 'If-Match': `"${base}"` } }),
        api.upload(brainId, b, { headers: { 'If-Match': `"${base}"` } }),
      ]);
      const statuses = results.map((r) => r.status).sort();
      assert.deepEqual(statuses, [200, 412]);
      const winner = results[0].status === 200 ? a : b;
      assert.ok((await api.download(brainId)).body.equals(winner));
      second = winner;
    });

    it('treats If-None-Match: * on upload as "only if nothing is stored yet"', async () => {
      const res = await api.upload(brainId, sampleArchive(6, 'first-writer'), { headers: { 'If-None-Match': '*' } });
      assert.equal(res.status, 412);
      assert.ok((await api.download(brainId)).body.equals(second));
    });

    it('still accepts an unconditional upload (version 1 clients)', async () => {
      const res = await api.upload(brainId, first);
      assert.equal(res.status, 200);
    });

    it('rejects an upload that is not a gzip-compressed tar archive', async () => {
      for (const junk of [Buffer.from('this is not an archive'), require('zlib').gzipSync(Buffer.from('gzip, but not tar'.repeat(64)))]) {
        const res = await api.upload(brainId, junk);
        assert.equal(res.status, 400);
      }
      assert.ok((await api.download(brainId)).body.equals(first), 'a rejected upload must change nothing');
    });

    it('honours If-Match on restore', async () => {
      const { data } = await api.json('GET', `/api/brains/${brainId}/versions`);
      const version = data.versions[0].version;
      const res = await api.json('POST', `/api/brains/${brainId}/versions/${encodeURIComponent(version)}/restore`,
        null, { 'If-Match': `"${'0'.repeat(64)}"` });
      assert.equal(res.status, 412);
    });
  });

  // -- last: removal -----------------------------------------------------------

  describe('removal', () => {
    it('deletes a brain, after which it is gone', async (t) => {
      if (!createdBrain) return t.skip('working on STORE_BRAIN_ID; not deleting it');
      const res = await api.json('DELETE', `/api/brains/${brainId}`);
      assert.ok([200, 204].includes(res.status));
      assert.equal((await api.json('GET', `/api/brains/${brainId}`)).status, 404);
      assert.equal((await api.download(brainId)).status, 404);
      createdBrain = false;
    });
  });
});
