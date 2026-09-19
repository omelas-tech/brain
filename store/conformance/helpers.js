'use strict';

/**
 * Helpers for the store conformance suite. Nothing here imports the reference
 * server except startReferenceStore(), so the suite can be pointed at any
 * implementation of the contract.
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

// -- a minimal ustar writer, so the suite needs no system `tar` ----------------

function tarHeader(name, size, typeflag) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 'latin1');
  header.write('0000000\0', 108, 'latin1');
  header.write('0000000\0', 116, 'latin1');
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 'latin1');
  header.write('00000000000\0', 136, 'latin1');
  header.fill(0x20, 148, 156);
  header.write(typeflag, 156, 'latin1');
  header.write('ustar\0', 257, 'latin1');
  header.write('00', 263, 'latin1');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'latin1');
  return header;
}

/**
 * Build a gzip-compressed tar archive.
 * @param {Object<string,string>} files  path -> content
 */
function makeArchive(files) {
  const blocks = [tarHeader('./', 0, '5')];
  for (const [name, content] of Object.entries(files)) {
    const body = Buffer.from(content, 'utf8');
    blocks.push(tarHeader(name, body.length, '0'), body);
    const pad = (512 - (body.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}

/** An archive with `count` memory files and unique content, so its checksum is unique too. */
function sampleArchive(count, label) {
  const files = {};
  const nonce = crypto.randomBytes(8).toString('hex');
  for (let i = 0; i < count; i++) {
    files[`professional/mem_${i}.md`] = `---\nid: mem_${i}\n---\n\n${label || 'sample'} ${nonce} ${i}\n`;
  }
  if (count > 0) files['index.json'] = JSON.stringify({ label: label || 'sample', nonce });
  return makeArchive(files);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// -- a thin client -----------------------------------------------------------

/**
 * One HTTP request on a socket of its own, closed when the response ends.
 *
 * Deliberately not `fetch`: fetch keeps connections alive in a pool, and on
 * Node 18 a pooled socket to a server that has just been shut down could keep a
 * finished test process from exiting, which hung CI. With `agent: false` and
 * `Connection: close` nothing outlives the request, on any Node version.
 *
 * @returns {Promise<{status: number, headers: {get: (name: string) => string|null}, body: Buffer}>}
 */
function rawRequest(method, url, { headers, body } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const mod = target.protocol === 'https:' ? https : http;
    const req = mod.request(target, {
      method,
      agent: false,
      headers: {
        Connection: 'close',
        ...(headers || {}),
        ...(body != null ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: {
          get(name) {
            const value = res.headers[String(name).toLowerCase()];
            if (value == null) return null;
            return Array.isArray(value) ? value.join(', ') : value;
          },
        },
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error(`${method} ${url} timed out`)));
    req.end(body != null ? body : undefined);
  });
}

function parseBody(buf) {
  const text = buf.toString('utf8');
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

/** The subset of `fetch` the OIDC verifier uses, without a connection pool. */
async function plainFetch(url, opts = {}) {
  const res = await rawRequest(opts.method || 'GET', String(url), { headers: opts.headers, body: opts.body });
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    headers: res.headers,
    json: async () => JSON.parse(res.body.toString('utf8')),
    text: async () => res.body.toString('utf8'),
  };
}

function client(baseUrl, token) {
  const base = baseUrl.replace(/\/$/, '');
  const auth = token ? { Authorization: `Bearer ${token}` } : {};

  async function json(method, pathname, body, headers) {
    const res = await rawRequest(method, base + pathname, {
      headers: { ...auth, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(headers || {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, headers: res.headers, data: parseBody(res.body) };
  }

  async function upload(brainId, archive, { headers, query, field } = {}) {
    const boundary = '----conformance' + crypto.randomBytes(8).toString('hex');
    const head = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${field || 'brain'}"; filename="brain.tar.gz"\r\n` +
      'Content-Type: application/gzip\r\n\r\n'
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const res = await rawRequest('PUT', `${base}/api/brains/${brainId}/sync${query || ''}`, {
      headers: { ...auth, 'Content-Type': `multipart/form-data; boundary=${boundary}`, ...(headers || {}) },
      body: Buffer.concat([head, archive, tail]),
    });
    return { status: res.status, headers: res.headers, data: parseBody(res.body) };
  }

  async function download(brainId, { headers, query } = {}) {
    const res = await rawRequest('GET', `${base}/api/brains/${brainId}/sync${query || ''}`, {
      headers: { ...auth, ...(headers || {}) },
    });
    return { status: res.status, headers: res.headers, body: res.body };
  }

  return { json, upload, download };
}

// -- the reference store, for when no STORE_URL is given ------------------------

async function startReferenceStore(options = {}) {
  const { createStore } = require('../server');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-store-conformance-'));
  const store = createStore({
    dataDir,
    requestsPerMinute: 0,
    uploadsPerMinute: 0,
    failedAuthPerMinute: 0,
    ...options,
  });
  const a = store.users.add('conformance-a', 'a@example.test');
  const b = store.users.add('conformance-b', 'b@example.test');
  const server = await store.listen(0, '127.0.0.1');
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    token: a.token,
    token2: b.token,
    store,
    dataDir,
    close: () => new Promise((resolve) => {
      server.close(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
        resolve();
      });
      if (server.closeAllConnections) server.closeAllConnections();
    }),
  };
}

module.exports = { makeArchive, sampleArchive, sha256, client, plainFetch, startReferenceStore };
