'use strict';

/**
 * brain-store — reference implementation of the Brain store contract
 *
 * A small HTTP server that keeps each user's brain as an opaque archive. It
 * never reads the memories inside one. See CONTRACT.md for the wire contract
 * this implements, and conformance/ for the black-box suite that checks it.
 *
 * No runtime dependencies. One process per data directory.
 */

const crypto = require('crypto');
const http = require('http');
const { UserStore } = require('./lib/auth');
const { Storage, PreconditionFailed, NotFound, UUID_RE } = require('./lib/storage');
const { inspectArchive, ArchiveError } = require('./lib/tar');
const { createVerifier, looksLikeJwt, OidcError } = require('./lib/oidc');

const VERSION = '0.1.0';
const CONTRACT = '1.1';
const EMPTY_PUSH_GUARD = 5; // refuse an empty archive over a brain with at least this many files
const JSON_BODY_LIMIT = 64 * 1024;
const MULTIPART_OVERHEAD = 64 * 1024;

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || null;
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Fixed-window counter. Good enough to blunt token guessing and runaway clients. */
class RateLimiter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  /** @returns {number} 0 when allowed, otherwise seconds until the window resets */
  check(key) {
    if (!this.max) return 0;
    const now = Date.now();
    if (this.hits.size > 10000) {
      for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
    }
    let entry = this.hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count++;
    return entry.count > this.max ? Math.max(1, Math.ceil((entry.reset - now) / 1000)) : 0;
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      return reject(new HttpError(413, 'request body too large'));
    }
    const chunks = [];
    let total = 0;
    let over = false;
    req.on('data', (chunk) => {
      if (over) return;
      total += chunk.length;
      if (total > limit) {
        over = true;
        chunks.length = 0;
        return reject(new HttpError(413, 'request body too large'));
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

/** Extract one file field from a multipart/form-data body. */
function multipartField(body, contentType, fieldName) {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || '');
  if (!m) return null;
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  const delimiter = Buffer.concat([Buffer.from('\r\n'), boundary]);

  let pos = body.indexOf(boundary);
  while (pos !== -1) {
    const afterBoundary = pos + boundary.length;
    if (body[afterBoundary] === 0x2d && body[afterBoundary + 1] === 0x2d) return null; // closing marker
    const headerStart = afterBoundary + 2;
    const headerEnd = body.indexOf('\r\n\r\n', headerStart);
    if (headerEnd === -1) return null;
    const next = body.indexOf(delimiter, headerEnd + 4);
    if (next === -1) return null;
    const headers = body.subarray(headerStart, headerEnd).toString('latin1');
    const name = /content-disposition:[^\r\n]*[;\s]name="([^"]*)"/i.exec(headers);
    if (name && name[1] === fieldName) return body.subarray(headerEnd + 4, next);
    pos = next + 2;
  }
  return null;
}

/** Parse an If-Match / If-None-Match header into bare checksums. `*` is kept as-is. */
function parseEtags(header) {
  if (!header) return null;
  return String(header)
    .split(',')
    .map((part) => part.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

function bearer(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  return m ? m[1] : null;
}

function publicBrain(meta) {
  return {
    id: meta.id,
    user_id: meta.user_id,
    name: meta.name,
    size_bytes: meta.size_bytes,
    file_count: meta.file_count,
    last_synced_at: meta.last_synced_at,
    checksum: meta.checksum,
    created_at: meta.created_at,
  };
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/**
 * @param {Object} opts
 * @param {string} opts.dataDir
 * @param {Buffer|null} [opts.encryptionKey]   32-byte key; enables encryption at rest
 * @param {number} [opts.maxUploadBytes=52428800]
 * @param {number} [opts.maxUserBytes=0]       0 = unlimited
 * @param {number} [opts.maxBrains=10]         per user
 * @param {number} [opts.versionRetention=5]
 * @param {number} [opts.requestsPerMinute=300]  per user
 * @param {number} [opts.uploadsPerMinute=30]    per user
 * @param {number} [opts.failedAuthPerMinute=30] per client address
 * @param {boolean} [opts.trustProxy=false]    take the client address from X-Forwarded-For
 * @param {Object} [opts.oidc]                 accept OpenID Connect ID tokens as bearer credentials:
 *                                             { issuer, audience, allowedDomains?, allowedEmails? }
 * @param {(entry: Object) => void} [opts.log] one call per request; never receives a token
 */
function createStore(opts) {
  if (!opts || !opts.dataDir) throw new Error('dataDir is required');

  const users = new UserStore(opts.dataDir);
  const storage = new Storage(opts.dataDir, {
    encryptionKey: opts.encryptionKey || null,
    versionRetention: opts.versionRetention,
  });
  const maxUploadBytes = opts.maxUploadBytes || 50 * 1024 * 1024;
  const maxUserBytes = opts.maxUserBytes || 0;
  const maxBrains = opts.maxBrains == null ? 10 : opts.maxBrains;
  const pick = (value, fallback) => (value == null ? fallback : value);
  const limits = {
    requests: new RateLimiter(pick(opts.requestsPerMinute, 300), 60000),
    uploads: new RateLimiter(pick(opts.uploadsPerMinute, 30), 60000),
    failedAuth: new RateLimiter(pick(opts.failedAuthPerMinute, 30), 60000),
  };
  const log = opts.log || null;

  // OpenID Connect: a bearer that is a valid ID token from the configured issuer
  // identifies a user, who is provisioned on first sight. Static tokens keep
  // working alongside. Verified tokens are remembered briefly so a burst of
  // requests costs one signature check, not one each.
  const oidc = opts.oidc ? createVerifier(opts.oidc) : null;
  const oidcSeen = new Map(); // sha256(token) -> { user, until }

  async function authenticateOidc(token) {
    const key = crypto.createHash('sha256').update(token).digest('hex');
    const hit = oidcSeen.get(key);
    const nowMs = Date.now();
    if (hit && hit.until > nowMs) return hit.user;
    const claims = await oidc.verify(token);
    const { user, created } = users.upsertOidc(opts.oidc.issuer, claims);
    if (created) storage.createBrain(user.id, 'default');
    if (oidcSeen.size > 1000) oidcSeen.clear();
    // Never trust the cached verdict past the token's own expiry.
    oidcSeen.set(key, { user, until: Math.min(nowMs + 60000, claims.exp * 1000) });
    return user;
  }

  function clientAddress(req) {
    if (opts.trustProxy) {
      const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (forwarded) return forwarded;
    }
    return req.socket.remoteAddress || 'unknown';
  }

  function send(res, status, body, headers) {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    res.writeHead(status, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      ...(headers || {}),
    });
    res.end(payload);
  }

  function sendArchive(res, archive, filename, headers) {
    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': 'application/gzip',
      'Content-Length': archive.length,
      'Content-Disposition': `attachment; filename=${filename}`,
      ...(headers || {}),
    });
    res.end(archive);
  }

  async function requireUser(req) {
    const address = clientAddress(req);
    const token = bearer(req);
    let user = token ? users.authenticate(token) : null;
    if (!user && oidc && looksLikeJwt(token)) {
      try {
        user = await authenticateOidc(token);
      } catch (err) {
        if (!(err instanceof OidcError)) throw err;
        user = null; // an invalid ID token is just an invalid credential
      }
    }
    if (!user) {
      const wait = limits.failedAuth.check(address);
      if (wait) throw new HttpError(429, 'too many failed attempts', { retryAfter: wait });
      throw new HttpError(401, 'unauthorized');
    }
    req.storeUserId = user.id; // for the request log only
    const wait = limits.requests.check(user.id);
    if (wait) throw new HttpError(429, 'rate limit exceeded', { retryAfter: wait });
    return user;
  }

  function requireBrain(user, brainId) {
    if (!UUID_RE.test(brainId)) throw new HttpError(400, 'invalid brain ID');
    const meta = storage.readMeta(user.id, brainId);
    if (!meta) throw new HttpError(404, 'brain not found');
    return meta;
  }

  /** Shared by upload and restore: validate, guard, commit. */
  async function commit(user, brain, archive, req, { force }) {
    let fileCount;
    try {
      ({ fileCount } = await inspectArchive(archive));
    } catch (err) {
      if (err instanceof ArchiveError) throw new HttpError(400, 'invalid archive: ' + err.message);
      throw err;
    }

    const ifMatch = parseEtags(req.headers['if-match']);
    const ifNoneMatch = parseEtags(req.headers['if-none-match']);

    return storage.commitArchive(user.id, brain.id, {
      archive,
      fileCount,
      ifMatch,
      ifNoneMatchAny: Boolean(ifNoneMatch && ifNoneMatch.includes('*')),
      guard: (meta) => {
        if (!force && fileCount === 0 && meta.file_count >= EMPTY_PUSH_GUARD) {
          throw new HttpError(409,
            `refused: this push has 0 memories but your brain has ${meta.file_count}. ` +
            'Retry with ?force=true to overwrite.');
        }
        if (maxUserBytes) {
          const projected = storage.userBytes(user.id) - meta.size_bytes + archive.length;
          if (projected > maxUserBytes) throw new HttpError(413, 'storage quota exceeded');
        }
      },
    });
  }

  // -- routes ----------------------------------------------------------------

  async function route(req, res, url) {
    const { pathname } = url;
    const method = req.method;

    if (pathname === '/health' && method === 'GET') {
      return send(res, 200, {
        status: 'ok',
        server: 'brain-store/' + VERSION,
        contract: CONTRACT,
        capabilities: ['static-token', 'conditional-sync', ...(oidc ? ['oidc'] : [])],
      });
    }

    if (pathname === '/auth/me' && method === 'GET') {
      const user = await requireUser(req);
      return send(res, 200, { user, storage_used: storage.userBytes(user.id) });
    }

    if (pathname.startsWith('/auth/')) {
      throw new HttpError(404, 'not supported: this store issues static tokens. Log in with a token.');
    }

    if (pathname === '/api/brains') {
      const user = await requireUser(req);
      if (method === 'GET') return send(res, 200, storage.listBrains(user.id).map(publicBrain));
      if (method === 'POST') {
        const raw = await readBody(req, JSON_BODY_LIMIT);
        let name = 'default';
        if (raw.length) {
          try {
            const parsed = JSON.parse(raw.toString('utf8'));
            if (parsed && typeof parsed.name === 'string' && parsed.name.trim()) name = parsed.name.trim();
          } catch {
            throw new HttpError(400, 'invalid JSON body');
          }
        }
        if (maxBrains && storage.listBrains(user.id).length >= maxBrains) {
          throw new HttpError(403, 'brain limit reached');
        }
        return send(res, 201, publicBrain(storage.createBrain(user.id, name)));
      }
      throw new HttpError(405, 'method not allowed');
    }

    const m = /^\/api\/brains\/([^/]+)(?:\/(sync|versions)(?:\/([^/]+)\/restore)?)?$/.exec(pathname);
    if (!m) throw new HttpError(404, 'not found');
    const [, brainId, section, versionParam] = m;

    const user = await requireUser(req);
    const brain = requireBrain(user, brainId);

    if (!section) {
      if (method === 'GET') return send(res, 200, publicBrain(brain));
      if (method === 'DELETE') {
        storage.deleteBrain(user.id, brain.id);
        return send(res, 204, null);
      }
      throw new HttpError(405, 'method not allowed');
    }

    if (section === 'sync' && !versionParam) {
      if (method === 'GET') {
        const version = url.searchParams.get('version');
        if (version) {
          return sendArchive(res, storage.readVersion(user.id, brain.id, version), version);
        }
        if (!brain.checksum) throw new HttpError(404, 'brain archive not found');
        const etag = `"${brain.checksum}"`;
        const headers = { ETag: etag, 'X-Checksum': brain.checksum };
        const inm = parseEtags(req.headers['if-none-match']);
        if (inm && (inm.includes('*') || inm.includes(brain.checksum))) {
          res.writeHead(304, { 'Cache-Control': 'no-store', ...headers });
          return res.end();
        }
        return sendArchive(res, storage.readArchive(user.id, brain.id), 'brain.tar.gz', headers);
      }

      if (method === 'PUT') {
        const wait = limits.uploads.check(user.id);
        if (wait) throw new HttpError(429, 'upload rate limit exceeded', { retryAfter: wait });

        const body = await readBody(req, maxUploadBytes + MULTIPART_OVERHEAD);
        const archive = multipartField(body, req.headers['content-type'], 'brain');
        if (!archive) throw new HttpError(400, 'missing brain file');
        if (archive.length > maxUploadBytes) throw new HttpError(413, 'archive too large');

        const meta = await commit(user, brain, archive, req, {
          force: url.searchParams.get('force') === 'true',
        });
        return send(res, 200, {
          size_bytes: meta.size_bytes,
          file_count: meta.file_count,
          checksum: meta.checksum,
        }, { ETag: `"${meta.checksum}"` });
      }
      throw new HttpError(405, 'method not allowed');
    }

    if (section === 'versions' && !versionParam) {
      if (method !== 'GET') throw new HttpError(405, 'method not allowed');
      const versions = storage.listVersions(user.id, brain.id);
      return send(res, 200, { versions, total: versions.length });
    }

    if (section === 'versions' && versionParam) {
      if (method !== 'POST') throw new HttpError(405, 'method not allowed');
      const version = decodeURIComponent(versionParam);
      const archive = storage.readVersion(user.id, brain.id, version);
      const meta = await commit(user, brain, archive, req, { force: true });
      return send(res, 200, { restored_version: version, checksum: meta.checksum },
        { ETag: `"${meta.checksum}"` });
    }

    throw new HttpError(404, 'not found');
  }

  async function handler(req, res) {
    const started = Date.now();

    try {
      const url = new URL(req.url, 'http://store.invalid');
      await route(req, res, url);
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
      } else if (err instanceof HttpError) {
        const headers = {};
        if (err.extra && err.extra.retryAfter) headers['Retry-After'] = String(err.extra.retryAfter);
        if (err.status === 401) headers['WWW-Authenticate'] = 'Bearer';
        if (err.status === 413) headers.Connection = 'close';
        send(res, err.status, { error: err.message }, headers);
      } else if (err instanceof PreconditionFailed) {
        send(res, 412, {
          error: 'precondition failed: the stored archive has changed. Pull, then push again.',
          current_checksum: err.currentChecksum,
        }, err.currentChecksum ? { ETag: `"${err.currentChecksum}"` } : {});
      } else if (err instanceof NotFound) {
        send(res, 404, { error: err.message });
      } else {
        send(res, 500, { error: 'internal error' });
        if (log) log({ level: 'error', message: err && err.message, stack: err && err.stack });
      }
    } finally {
      if (log) {
        log({
          level: 'info',
          method: req.method,
          path: (req.url || '').split('?')[0],
          status: res.statusCode,
          ms: Date.now() - started,
          user: req.storeUserId || null,
        });
      }
    }
  }

  return {
    handler,
    users,
    storage,
    /** Start listening. Resolves with the http.Server once bound. */
    listen(port, host) {
      const server = http.createServer(handler);
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server));
      });
    },
  };
}

module.exports = { createStore, VERSION, CONTRACT, multipartField, parseEtags };
