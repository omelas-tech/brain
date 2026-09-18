'use strict';

/**
 * brain-store — file-only storage
 *
 *   <dataDir>/brains/<userId>/<brainId>/
 *     meta.json              brain record
 *     current.bin            the live archive (plain or encrypted)
 *     versions/<name>        snapshots taken before each overwrite
 *
 * There is no database. A brain's record is its meta.json, and listing a user's
 * brains is a directory listing.
 *
 * Encryption at rest is optional. With a master key, each file is sealed with
 * AES-256-GCM under a per-user key derived by HKDF-SHA256, so one user's data
 * cannot be opened with another user's key. Plain files written before the key
 * was set remain readable and are sealed the next time they are rewritten.
 *
 * Checksums, sizes and file counts always describe the PLAINTEXT archive, so
 * what a client verifies does not depend on how the store keeps the bytes.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAGIC = Buffer.from('BSTORE1\0', 'latin1');
const NONCE_LEN = 12;
const TAG_LEN = 16;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const VERSION_RE = /^\d{8}T\d{6}\.\d{9}\.tar\.gz$/;

class PreconditionFailed extends Error {
  constructor(currentChecksum) {
    super('the stored archive has changed');
    this.name = 'PreconditionFailed';
    this.currentChecksum = currentChecksum;
  }
}

class NotFound extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFound';
  }
}

/** Accept a 32-byte key as 64 hex characters or as base64. */
function parseKey(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  if (key.length !== 32) throw new Error('encryption key must be 32 bytes (64 hex characters, or base64)');
  return key;
}

function versionName(date) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}` +
    `.${p(date.getUTCMilliseconds(), 3)}000000.tar.gz`
  );
}

function versionDate(name) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.(\d{3})/.exec(name);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

class Storage {
  /**
   * @param {string} dataDir
   * @param {Object} [opts]
   * @param {Buffer|null} [opts.encryptionKey] 32-byte master key
   * @param {number} [opts.versionRetention=5] snapshots kept per brain
   */
  constructor(dataDir, opts = {}) {
    this.root = path.join(dataDir, 'brains');
    this.masterKey = opts.encryptionKey || null;
    this.versionRetention = opts.versionRetention == null ? 5 : opts.versionRetention;
    this.locks = new Map();
    fs.mkdirSync(this.root, { recursive: true });
  }

  // -- paths ---------------------------------------------------------------

  userDir(userId) {
    if (!USER_ID_RE.test(userId)) throw new NotFound('user not found');
    return path.join(this.root, userId);
  }

  brainDir(userId, brainId) {
    if (!UUID_RE.test(brainId)) throw new NotFound('brain not found');
    return path.join(this.userDir(userId), brainId.toLowerCase());
  }

  // -- sealing -------------------------------------------------------------

  userKey(userId) {
    return Buffer.from(
      crypto.hkdfSync('sha256', this.masterKey, Buffer.alloc(0), 'brain-store:' + userId, 32)
    );
  }

  seal(userId, plaintext) {
    if (!this.masterKey) return plaintext;
    const nonce = crypto.randomBytes(NONCE_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.userKey(userId), nonce);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([MAGIC, nonce, body, cipher.getAuthTag()]);
  }

  open(userId, stored) {
    if (stored.length < MAGIC.length || !stored.subarray(0, MAGIC.length).equals(MAGIC)) return stored;
    if (!this.masterKey) throw new Error('archive is encrypted but no encryption key is configured');
    const nonce = stored.subarray(MAGIC.length, MAGIC.length + NONCE_LEN);
    const tag = stored.subarray(stored.length - TAG_LEN);
    const body = stored.subarray(MAGIC.length + NONCE_LEN, stored.length - TAG_LEN);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.userKey(userId), nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  }

  // -- serialising writes --------------------------------------------------

  /**
   * Run `fn` with exclusive access to one brain. The precondition check and the
   * swap must not interleave with another upload to the same brain, or two
   * clients could both pass an `If-Match` against the same checksum. The lock is
   * in-process: run one server process per data directory.
   */
  async withLock(key, fn) {
    const previous = this.locks.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((r) => { release = r; });
    const tail = previous.then(() => gate);
    this.locks.set(key, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  // -- brain records -------------------------------------------------------

  writeAtomic(file, data, mode = 0o600) {
    const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    fs.writeFileSync(tmp, data, { mode });
    fs.renameSync(tmp, file);
  }

  readMeta(userId, brainId) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.brainDir(userId, brainId), 'meta.json'), 'utf8'));
    } catch (err) {
      if (err instanceof NotFound || err.code === 'ENOENT') return null;
      throw err;
    }
  }

  writeMeta(meta) {
    this.writeAtomic(
      path.join(this.brainDir(meta.user_id, meta.id), 'meta.json'),
      JSON.stringify(meta, null, 2) + '\n'
    );
  }

  listBrains(userId) {
    let names;
    try {
      names = fs.readdirSync(this.userDir(userId));
    } catch {
      return [];
    }
    return names
      .filter((n) => UUID_RE.test(n))
      .map((n) => this.readMeta(userId, n))
      .filter(Boolean)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  createBrain(userId, name) {
    const meta = {
      id: crypto.randomUUID(),
      user_id: userId,
      name: String(name || 'default').slice(0, 100),
      size_bytes: 0,
      file_count: 0,
      last_synced_at: null,
      checksum: null,
      created_at: new Date().toISOString(),
    };
    fs.mkdirSync(path.join(this.brainDir(userId, meta.id), 'versions'), { recursive: true, mode: 0o700 });
    this.writeMeta(meta);
    return meta;
  }

  deleteBrain(userId, brainId) {
    const dir = this.brainDir(userId, brainId);
    if (!fs.existsSync(path.join(dir, 'meta.json'))) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }

  deleteUser(userId) {
    fs.rmSync(this.userDir(userId), { recursive: true, force: true });
  }

  /** Bytes on disk for one user, across live archives and snapshots. */
  userBytes(userId) {
    let total = 0;
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) total += fs.statSync(p).size;
      }
    };
    walk(this.userDir(userId));
    return total;
  }

  // -- archives ------------------------------------------------------------

  readArchive(userId, brainId) {
    const file = path.join(this.brainDir(userId, brainId), 'current.bin');
    let stored;
    try {
      stored = fs.readFileSync(file);
    } catch (err) {
      if (err.code === 'ENOENT') throw new NotFound('brain archive not found');
      throw err;
    }
    return this.open(userId, stored);
  }

  /**
   * Replace a brain's archive.
   *
   * @param {Object} args
   * @param {Buffer} args.archive        plaintext tar.gz
   * @param {number} args.fileCount
   * @param {string[]|null} args.ifMatch       acceptable current checksums, or ['*']
   * @param {boolean} args.ifNoneMatchAny      true for `If-None-Match: *`
   * @param {(meta: Object) => void} [args.guard]  throws to refuse; runs under the lock
   */
  commitArchive(userId, brainId, args) {
    return this.withLock(userId + '/' + brainId, () => {
      const meta = this.readMeta(userId, brainId);
      if (!meta) throw new NotFound('brain not found');

      const current = meta.checksum || null;
      if (args.ifNoneMatchAny && current) throw new PreconditionFailed(current);
      if (args.ifMatch) {
        const ok = current && (args.ifMatch.includes('*') || args.ifMatch.includes(current));
        if (!ok) throw new PreconditionFailed(current);
      }
      if (args.guard) args.guard(meta);

      const dir = this.brainDir(userId, brainId);
      const live = path.join(dir, 'current.bin');
      this.snapshot(dir, live);

      this.writeAtomic(live, this.seal(userId, args.archive));

      meta.size_bytes = args.archive.length;
      meta.file_count = args.fileCount;
      meta.checksum = crypto.createHash('sha256').update(args.archive).digest('hex');
      meta.last_synced_at = new Date().toISOString();
      this.writeMeta(meta);
      return meta;
    });
  }

  /** Move the live archive into versions/ under a fresh timestamped name, then prune. */
  snapshot(dir, live) {
    if (!fs.existsSync(live)) return;
    const versions = path.join(dir, 'versions');
    fs.mkdirSync(versions, { recursive: true, mode: 0o700 });
    let when = new Date();
    let name = versionName(when);
    while (fs.existsSync(path.join(versions, name))) {
      when = new Date(when.getTime() + 1);
      name = versionName(when);
    }
    fs.copyFileSync(live, path.join(versions, name));
    const names = fs.readdirSync(versions).filter((n) => VERSION_RE.test(n)).sort();
    while (names.length > this.versionRetention) {
      fs.rmSync(path.join(versions, names.shift()), { force: true });
    }
  }

  listVersions(userId, brainId) {
    let names;
    try {
      names = fs.readdirSync(path.join(this.brainDir(userId, brainId), 'versions'));
    } catch {
      return [];
    }
    return names
      .filter((n) => VERSION_RE.test(n))
      .sort()
      .reverse()
      .map((version) => ({ version, date: versionDate(version) || undefined }));
  }

  readVersion(userId, brainId, version) {
    if (!VERSION_RE.test(version)) throw new NotFound('version not found');
    const file = path.join(this.brainDir(userId, brainId), 'versions', version);
    let stored;
    try {
      stored = fs.readFileSync(file);
    } catch (err) {
      if (err.code === 'ENOENT') throw new NotFound('version not found');
      throw err;
    }
    return this.open(userId, stored);
  }
}

module.exports = { Storage, PreconditionFailed, NotFound, parseKey, UUID_RE, VERSION_RE };
