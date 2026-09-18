'use strict';

/**
 * brain-store — OpenID Connect ID-token verification
 *
 * Verifies an ID token against an issuer's published keys: discovery document,
 * JWKS, signature, then the claims. No dependencies. Shared by the store (which
 * accepts ID tokens as bearer credentials) and the MCP connector (which obtains
 * them), so there is exactly one implementation to get right.
 *
 * Deliberately narrow:
 *   - RS256 and ES256 only. `none` and every HMAC algorithm are refused outright,
 *     which closes the classic "sign with the public key as an HMAC secret" hole.
 *   - The key type must agree with the algorithm in the token header.
 *   - `iss` must equal the issuer in the discovery document, exactly.
 *   - HTTPS only, except for loopback addresses (tests, local development).
 */

const crypto = require('crypto');

const ALGS = {
  RS256: { kty: 'RSA', verify: (key, data, sig) => crypto.verify('sha256', data, key, sig) },
  ES256: {
    kty: 'EC',
    crv: 'P-256',
    // JOSE signatures are the raw r||s pair, not DER.
    verify: (key, data, sig) => crypto.verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig),
  },
};

const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_MIN_REFETCH_MS = 60 * 1000;
const PUBLIC_ISSUERS = new Set(['accounts.google.com']);

class OidcError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OidcError';
  }
}

function isLoopback(hostname) {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
}

function requireSecure(url, what) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new OidcError(`${what} is not a URL: ${url}`); }
  if (parsed.protocol === 'https:') return parsed;
  if (parsed.protocol === 'http:' && isLoopback(parsed.hostname)) return parsed;
  throw new OidcError(`${what} must use https: ${url}`);
}

const stripSlash = (s) => String(s).replace(/\/+$/, '');

function decodePart(part, what) {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new OidcError(`malformed token ${what}`);
  }
}

function list(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  return String(value || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
}

/**
 * @param {Object} opts
 * @param {string} opts.issuer      e.g. https://login.microsoftonline.com/<tenant>/v2.0
 * @param {string} opts.audience    the client id the tokens are issued to
 * @param {string|string[]} [opts.allowedDomains]  email / Google `hd` domains allowed in
 * @param {string|string[]} [opts.allowedEmails]   exact addresses allowed in
 * @param {number} [opts.clockSkewSec=60]
 * @param {Function} [opts.fetch]   defaults to the global fetch
 */
function createVerifier(opts) {
  if (!opts || !opts.issuer || !opts.audience) throw new OidcError('issuer and audience are required');
  const issuerUrl = requireSecure(opts.issuer, 'issuer');
  const audience = String(opts.audience);
  const allowedDomains = list(opts.allowedDomains);
  const allowedEmails = list(opts.allowedEmails);
  const skew = opts.clockSkewSec == null ? 60 : opts.clockSkewSec;
  const doFetch = opts.fetch || globalThis.fetch;

  // Anyone on the internet can get a token from a public issuer. Without an
  // allow-list, "signed by Google" would mean "anybody".
  if (PUBLIC_ISSUERS.has(issuerUrl.hostname) && !allowedDomains.length && !allowedEmails.length) {
    throw new OidcError(
      `${issuerUrl.hostname} issues tokens to anyone: set an allow-list of domains or email addresses`
    );
  }

  let discoveryDoc = null;
  let keys = new Map();
  let keysFetchedAt = 0;

  async function getJson(url, what) {
    let res;
    try {
      res = await doFetch(url, { headers: { accept: 'application/json' } });
    } catch (err) {
      throw new OidcError(`${what} unreachable: ${err.message}`);
    }
    if (!res.ok) throw new OidcError(`${what} answered ${res.status}`);
    try { return await res.json(); } catch { throw new OidcError(`${what} is not JSON`); }
  }

  async function discovery() {
    if (discoveryDoc) return discoveryDoc;
    const doc = await getJson(stripSlash(opts.issuer) + '/.well-known/openid-configuration', 'discovery document');
    if (typeof doc.issuer !== 'string' || stripSlash(doc.issuer) !== stripSlash(opts.issuer)) {
      throw new OidcError('discovery document names a different issuer');
    }
    requireSecure(doc.jwks_uri, 'jwks_uri');
    discoveryDoc = doc;
    return doc;
  }

  async function loadKeys() {
    const doc = await discovery();
    const jwks = await getJson(doc.jwks_uri, 'JWKS');
    const next = new Map();
    for (const jwk of Array.isArray(jwks.keys) ? jwks.keys : []) {
      if (!jwk || typeof jwk.kid !== 'string') continue;
      if (jwk.use && jwk.use !== 'sig') continue;
      next.set(jwk.kid, jwk);
    }
    keys = next;
    keysFetchedAt = Date.now();
  }

  async function keyFor(kid) {
    const now = Date.now();
    if (!keysFetchedAt || now - keysFetchedAt > JWKS_TTL_MS) await loadKeys();
    // An unknown key id usually means the issuer rotated its keys. Refetch, but
    // not more than once a minute, so garbage tokens cannot be used to hammer it.
    if (!keys.has(kid) && now - keysFetchedAt > JWKS_MIN_REFETCH_MS) await loadKeys();
    return keys.get(kid) || null;
  }

  function checkAllowList(claims) {
    if (!allowedDomains.length && !allowedEmails.length) return;
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    const verified = claims.email_verified === true;
    if (verified && email && allowedEmails.includes(email)) return;
    if (typeof claims.hd === 'string' && allowedDomains.includes(claims.hd.toLowerCase())) return;
    if (verified && email.includes('@') && allowedDomains.includes(email.slice(email.lastIndexOf('@') + 1))) return;
    throw new OidcError('this account is not on the allow-list');
  }

  /**
   * Verify an ID token. Resolves with its claims, or rejects with OidcError.
   * @param {string} token
   * @param {Object} [expect]
   * @param {string} [expect.nonce]  required to match when given
   */
  async function verify(token, expect = {}) {
    if (typeof token !== 'string' || token.length > 16384) throw new OidcError('malformed token');
    const parts = token.split('.');
    if (parts.length !== 3) throw new OidcError('malformed token');
    const [h, p, s] = parts;
    const header = decodePart(h, 'header');
    const claims = decodePart(p, 'payload');

    const alg = Object.prototype.hasOwnProperty.call(ALGS, header.alg) ? ALGS[header.alg] : null;
    if (!alg) throw new OidcError(`unsupported algorithm: ${String(header.alg)}`);
    if (typeof header.kid !== 'string' || !header.kid) throw new OidcError('token names no key');

    const jwk = await keyFor(header.kid);
    if (!jwk) throw new OidcError('unknown signing key');
    if (jwk.kty !== alg.kty || (alg.crv && jwk.crv !== alg.crv)) throw new OidcError('key does not match the algorithm');
    if (jwk.alg && jwk.alg !== header.alg) throw new OidcError('key does not match the algorithm');

    let key;
    try { key = crypto.createPublicKey({ key: jwk, format: 'jwk' }); } catch { throw new OidcError('unusable signing key'); }
    let ok = false;
    try { ok = alg.verify(key, Buffer.from(`${h}.${p}`), Buffer.from(s, 'base64url')); } catch { ok = false; }
    if (!ok) throw new OidcError('invalid signature');

    const doc = await discovery();
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== doc.issuer) throw new OidcError('issuer mismatch');
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(audience)) throw new OidcError('audience mismatch');
    if (auds.length > 1 && claims.azp !== audience) throw new OidcError('authorized party mismatch');
    if (typeof claims.exp !== 'number' || claims.exp + skew < now) throw new OidcError('token expired');
    if (typeof claims.iat === 'number' && claims.iat - skew > now) throw new OidcError('token issued in the future');
    if (typeof claims.nbf === 'number' && claims.nbf - skew > now) throw new OidcError('token not yet valid');
    if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw new OidcError('no subject');
    if (expect.nonce !== undefined && claims.nonce !== expect.nonce) throw new OidcError('nonce mismatch');

    checkAllowList(claims);
    return claims;
  }

  return { verify, discovery };
}

/** True when a bearer token has the shape of a JWT (and so might be an ID token). */
function looksLikeJwt(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
}

module.exports = { createVerifier, looksLikeJwt, OidcError };
