'use strict';

/**
 * A tiny OpenID Connect issuer for tests: discovery, JWKS, an authorization
 * endpoint that approves at once, and a token endpoint that checks PKCE. It signs
 * real RS256 and ES256 tokens, so the verifier under test does real cryptography.
 */

const crypto = require('crypto');
const http = require('http');

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

function makeKey(alg, kid) {
  const pair = alg === 'ES256'
    ? crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    : crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { alg, kid, privateKey: pair.privateKey, jwk: { ...pair.publicKey.export({ format: 'jwk' }), kid, alg, use: 'sig' } };
}

function sign(key, header, claims) {
  const data = `${b64({ typ: 'JWT', alg: key.alg, kid: key.kid, ...header })}.${b64(claims)}`;
  const sig = key.alg === 'ES256'
    ? crypto.sign('sha256', Buffer.from(data), { key: key.privateKey, dsaEncoding: 'ieee-p1363' })
    : crypto.sign('sha256', Buffer.from(data), key.privateKey);
  return `${data}.${sig.toString('base64url')}`;
}

async function startMockIssuer({ clientId = 'brain-client' } = {}) {
  const state = {
    keys: [makeKey('RS256', 'rsa-1'), makeKey('ES256', 'ec-1')],
    codes: new Map(),      // code -> { challenge, nonce, redirectUri, person }
    refreshTokens: new Map(), // token -> person
    person: { sub: 'user-123', email: 'alice@example.org', email_verified: true },
    jwksHits: 0,
    returnIdTokenOnRefresh: true,
    tokenEndpointDown: false,
  };
  let issuer = '';

  const idToken = (claims = {}, { key = state.keys[0], header = {} } = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return sign(key, header, { iss: issuer, aud: clientId, iat: now, exp: now + 3600, ...state.person, ...claims });
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, {
        issuer, jwks_uri: `${issuer}/jwks`, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
      });
    }
    if (url.pathname === '/jwks') { state.jwksHits++; return json(200, { keys: state.keys.map((k) => k.jwk) }); }

    if (url.pathname === '/authorize') {
      const q = url.searchParams;
      if (q.get('client_id') !== clientId || q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256') {
        return json(400, { error: 'invalid_request' });
      }
      const code = 'mc_' + crypto.randomBytes(12).toString('hex');
      state.codes.set(code, { challenge: q.get('code_challenge'), nonce: q.get('nonce'), redirectUri: q.get('redirect_uri'), person: { ...state.person } });
      const back = new URL(q.get('redirect_uri'));
      back.searchParams.set('code', code);
      back.searchParams.set('state', q.get('state'));
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }

    if (url.pathname === '/token' && req.method === 'POST') {
      if (state.tokenEndpointDown) return json(503, { error: 'temporarily_unavailable' });
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const form = new URLSearchParams(Buffer.concat(chunks).toString());
      if (form.get('grant_type') === 'authorization_code') {
        const entry = state.codes.get(form.get('code'));
        state.codes.delete(form.get('code'));
        const challenge = crypto.createHash('sha256').update(form.get('code_verifier') || '').digest('base64url');
        if (!entry || entry.challenge !== challenge || entry.redirectUri !== form.get('redirect_uri')) return json(400, { error: 'invalid_grant' });
        const refresh = 'mr_' + crypto.randomBytes(12).toString('hex');
        state.refreshTokens.set(refresh, entry.person);
        return json(200, { token_type: 'Bearer', access_token: 'unused', refresh_token: refresh, id_token: idToken({ ...entry.person, nonce: entry.nonce }) });
      }
      if (form.get('grant_type') === 'refresh_token') {
        const person = state.refreshTokens.get(form.get('refresh_token'));
        if (!person) return json(400, { error: 'invalid_grant' });
        return json(200, { token_type: 'Bearer', access_token: 'unused', ...(state.returnIdTokenOnRefresh ? { id_token: idToken(person) } : {}) });
      }
      return json(400, { error: 'unsupported_grant_type' });
    }
    json(404, { error: 'not found' });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${server.address().port}`;

  return {
    issuer, clientId, state, idToken, makeKey, sign,
    close: () => new Promise((r) => { server.close(r); if (server.closeAllConnections) server.closeAllConnections(); }),
  };
}

module.exports = { startMockIssuer, makeKey, sign };
