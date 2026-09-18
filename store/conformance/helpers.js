'use strict';

/**
 * Helpers for the store conformance suite. Nothing here imports the reference
 * server except startReferenceStore(), so the suite can be pointed at any
 * implementation of the contract.
 */

const crypto = require('crypto');
const fs = require('fs');
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

function client(baseUrl, token) {
  const base = baseUrl.replace(/\/$/, '');
  const auth = token ? { Authorization: `Bearer ${token}` } : {};

  async function json(method, pathname, body, headers) {
    const res = await fetch(base + pathname, {
      method,
      headers: { ...auth, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(headers || {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, headers: res.headers, data };
  }

  async function upload(brainId, archive, { headers, query, field } = {}) {
    const boundary = '----conformance' + crypto.randomBytes(8).toString('hex');
    const head = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${field || 'brain'}"; filename="brain.tar.gz"\r\n` +
      'Content-Type: application/gzip\r\n\r\n'
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const res = await fetch(`${base}/api/brains/${brainId}/sync${query || ''}`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': `multipart/form-data; boundary=${boundary}`, ...(headers || {}) },
      body: Buffer.concat([head, archive, tail]),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, headers: res.headers, data };
  }

  async function download(brainId, { headers, query } = {}) {
    const res = await fetch(`${base}/api/brains/${brainId}/sync${query || ''}`, {
      headers: { ...auth, ...(headers || {}) },
    });
    const body = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, body };
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

module.exports = { makeArchive, sampleArchive, sha256, client, startReferenceStore };
