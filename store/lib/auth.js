'use strict';

/**
 * brain-store — users and static bearer tokens
 *
 * Users live in `<dataDir>/users.json`. Tokens are 256 bits of randomness, shown
 * once at creation and stored only as a SHA-256 hash. A fast hash is appropriate
 * here because the input is high-entropy random data, not a human password.
 *
 * The file is re-read when it changes on disk, so `brain-store user add` takes
 * effect on a running server without a restart.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const USERS_FILE = 'users.json';
const TOKEN_PREFIX = 'bst_';
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function newToken() {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

function newUserId() {
  return 'usr_' + crypto.randomBytes(9).toString('base64url');
}

class UserStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, USERS_FILE);
    this.users = [];
    this.loadedSig = '';
    fs.mkdirSync(dataDir, { recursive: true });
  }

  /** Re-read users.json if it changed since the last load. */
  refresh() {
    let stat;
    try {
      stat = fs.statSync(this.file);
    } catch {
      this.users = [];
      this.loadedSig = '';
      return;
    }
    const sig = stat.mtimeMs + ':' + stat.size;
    if (sig === this.loadedSig) return;
    const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    this.users = Array.isArray(parsed.users) ? parsed.users : [];
    this.loadedSig = sig;
  }

  save() {
    const tmp = this.file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ users: this.users }, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    const stat = fs.statSync(this.file);
    this.loadedSig = stat.mtimeMs + ':' + stat.size;
  }

  list() {
    this.refresh();
    return this.users.map(publicUser);
  }

  find(nameOrId) {
    this.refresh();
    return this.users.find((u) => u.id === nameOrId || u.name === nameOrId) || null;
  }

  /**
   * Create a user. Returns the public record and the token, which is never
   * stored and cannot be shown again.
   */
  add(name, email) {
    this.refresh();
    if (!NAME_RE.test(name || '')) {
      throw new Error('user name must be 1-64 characters: letters, digits, dot, dash, underscore');
    }
    if (this.users.some((u) => u.name === name)) throw new Error(`user "${name}" already exists`);
    const token = newToken();
    const user = {
      id: newUserId(),
      name,
      email: email || '',
      token_sha256: sha256Hex(token),
      created_at: new Date().toISOString(),
    };
    this.users.push(user);
    this.save();
    return { user: publicUser(user), token };
  }

  /** Replace a user's token. The old token stops working immediately. */
  rotate(nameOrId) {
    const user = this.find(nameOrId);
    if (!user) throw new Error(`no such user: ${nameOrId}`);
    const token = newToken();
    user.token_sha256 = sha256Hex(token);
    user.rotated_at = new Date().toISOString();
    this.save();
    return { user: publicUser(user), token };
  }

  /**
   * Find or create the user behind a verified OpenID Connect identity. The id is
   * derived from issuer and subject, so the same person always maps to the same
   * user, and two issuers can never collide. OIDC users have no static token
   * unless the operator issues one with `user rotate`.
   *
   * @returns {{user: Object, created: boolean}}
   */
  upsertOidc(issuer, claims) {
    this.refresh();
    const id = 'oidc_' + crypto.createHash('sha256')
      .update(issuer + '|' + claims.sub, 'utf8').digest('base64url').slice(0, 16);
    const email = typeof claims.email === 'string' ? claims.email : '';
    let user = this.users.find((u) => u.id === id);
    if (user) {
      if (email && user.email !== email) {
        user.email = email;
        this.save();
      }
      return { user: publicUser(user), created: false };
    }
    user = {
      id,
      name: id,
      email,
      oidc: { iss: issuer, sub: claims.sub },
      created_at: new Date().toISOString(),
    };
    this.users.push(user);
    this.save();
    return { user: publicUser(user), created: true };
  }

  remove(nameOrId) {
    const user = this.find(nameOrId);
    if (!user) throw new Error(`no such user: ${nameOrId}`);
    this.users = this.users.filter((u) => u.id !== user.id);
    this.save();
    return publicUser(user);
  }

  /**
   * Resolve a bearer token to a user. Every stored hash is compared in constant
   * time, and the loop never exits early, so timing reveals nothing about which
   * user (if any) matched.
   */
  authenticate(token) {
    if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
    this.refresh();
    const presented = Buffer.from(sha256Hex(token), 'hex');
    let match = null;
    for (const user of this.users) {
      const stored = Buffer.from(String(user.token_sha256 || ''), 'hex');
      if (stored.length === presented.length && crypto.timingSafeEqual(stored, presented)) match = user;
    }
    return match ? publicUser(match) : null;
  }
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email || '', created_at: user.created_at };
}

module.exports = { UserStore, TOKEN_PREFIX };
