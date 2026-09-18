'use strict';

/**
 * OpenID Connect: the ID-token verifier, and the store accepting ID tokens as
 * bearer credentials. Real signatures against a mock issuer (mock-issuer.js).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { createVerifier, looksLikeJwt, OidcError } = require('../lib/oidc');
const { startMockIssuer, makeKey, sign } = require('./mock-issuer');
const { client, startReferenceStore, sampleArchive } = require('../conformance/helpers');

describe('ID-token verification', () => {
  let idp;
  let verifier;
  before(async () => {
    idp = await startMockIssuer();
    verifier = createVerifier({ issuer: idp.issuer, audience: idp.clientId });
  });
  after(() => idp.close());

  it('accepts a valid RS256 token and a valid ES256 token', async () => {
    assert.equal((await verifier.verify(idp.idToken())).sub, 'user-123');
    assert.equal((await verifier.verify(idp.idToken({}, { key: idp.state.keys[1] }))).sub, 'user-123');
  });

  it('caches the issuer\'s keys', async () => {
    const before = idp.state.jwksHits;
    await verifier.verify(idp.idToken());
    await verifier.verify(idp.idToken());
    assert.equal(idp.state.jwksHits, before);
  });

  const rejects = (token, pattern, expect) => assert.rejects(verifier.verify(token, expect), (err) => {
    assert.ok(err instanceof OidcError, `expected OidcError, got ${err}`);
    assert.match(err.message, pattern);
    return true;
  });

  it('rejects a token for another audience', () => rejects(idp.idToken({ aud: 'someone-else' }), /audience/));
  it('rejects a token from another issuer', () => rejects(idp.idToken({ iss: 'https://evil.example' }), /issuer/));
  it('rejects an expired token', () => rejects(idp.idToken({ exp: Math.floor(Date.now() / 1000) - 600 }), /expired/));
  it('rejects a token issued in the future', () => rejects(idp.idToken({ iat: Math.floor(Date.now() / 1000) + 3600 }), /future/));
  it('rejects a token with no subject', () => rejects(idp.idToken({ sub: '' }), /subject/));
  it('rejects a multi-audience token whose authorized party is someone else',
    () => rejects(idp.idToken({ aud: [idp.clientId, 'other'], azp: 'other' }), /authorized party/));
  it('checks the nonce when one is expected', async () => {
    await rejects(idp.idToken({ nonce: 'a' }), /nonce/, { nonce: 'b' });
    await verifier.verify(idp.idToken({ nonce: 'a' }), { nonce: 'a' });
  });

  it('rejects a tampered payload', async () => {
    const [h, p, s] = idp.idToken().split('.');
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    claims.sub = 'someone-else';
    await rejects(`${h}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${s}`, /signature/);
  });

  it('rejects alg "none"', async () => {
    const [, p] = idp.idToken().split('.');
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid: 'rsa-1' })).toString('base64url');
    await rejects(`${header}.${p}.`, /malformed|unsupported/);
    await rejects(`${header}.${p}.AAAA`, /unsupported algorithm/);
  });

  it('rejects an HMAC token signed with the public key (algorithm confusion)', async () => {
    const [, p] = idp.idToken().split('.');
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', kid: 'rsa-1' })).toString('base64url');
    const pem = crypto.createPublicKey({ key: idp.state.keys[0].jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
    const mac = crypto.createHmac('sha256', pem).update(`${header}.${p}`).digest('base64url');
    await rejects(`${header}.${p}.${mac}`, /unsupported algorithm/);
  });

  it('rejects a token whose algorithm does not fit the key it names', async () => {
    // Header says ES256 but points at the RSA key.
    const forged = sign({ ...idp.state.keys[1], kid: 'rsa-1' }, {}, {
      iss: idp.issuer, aud: idp.clientId, sub: 'x', exp: Math.floor(Date.now() / 1000) + 60,
    });
    await rejects(forged, /does not match the algorithm/);
  });

  it('rejects a token signed by a key the issuer does not publish', async () => {
    const stranger = makeKey('RS256', 'rsa-1'); // same kid, different key
    const forged = sign(stranger, {}, { iss: idp.issuer, aud: idp.clientId, sub: 'x', exp: Math.floor(Date.now() / 1000) + 60 });
    await rejects(forged, /signature/);
  });

  it('rejects junk', async () => {
    for (const junk of ['', 'a.b', 'a.b.c', 'x'.repeat(20000), null, 42]) await rejects(junk, /malformed/);
  });

  it('recognises the shape of a JWT', () => {
    assert.equal(looksLikeJwt('aaa.bbb.ccc'), true);
    assert.equal(looksLikeJwt('bst_abc'), false);
    assert.equal(looksLikeJwt(undefined), false);
  });
});

describe('issuer safeguards', () => {
  it('refuses an issuer that is not https', () => {
    assert.throws(() => createVerifier({ issuer: 'http://idp.example.org', audience: 'x' }), /https/);
  });

  it('refuses a public issuer without an allow-list', () => {
    assert.throws(() => createVerifier({ issuer: 'https://accounts.google.com', audience: 'x' }), /allow-list/);
    createVerifier({ issuer: 'https://accounts.google.com', audience: 'x', allowedDomains: 'example.org' });
  });

  it('refuses a discovery document that names a different issuer', async () => {
    const idp = await startMockIssuer();
    try {
      const fetchLying = async (url) => {
        const res = await fetch(url);
        const body = await res.json();
        if (body.issuer) body.issuer = 'https://somewhere-else.example';
        return { ok: true, status: 200, json: async () => body };
      };
      const v = createVerifier({ issuer: idp.issuer, audience: idp.clientId, fetch: fetchLying });
      await assert.rejects(v.verify(idp.idToken()), /different issuer/);
    } finally {
      await idp.close();
    }
  });
});

describe('allow-lists', () => {
  let idp;
  before(async () => { idp = await startMockIssuer(); });
  after(() => idp.close());

  it('admits a verified address in an allowed domain, and nobody else', async () => {
    const v = createVerifier({ issuer: idp.issuer, audience: idp.clientId, allowedDomains: 'example.org, other.test' });
    await v.verify(idp.idToken());
    await assert.rejects(v.verify(idp.idToken({ email: 'mallory@evil.test' })), /allow-list/);
    await assert.rejects(v.verify(idp.idToken({ email: 'x@notexample.org' })), /allow-list/);
  });

  it('ignores an address the issuer has not verified', async () => {
    const v = createVerifier({ issuer: idp.issuer, audience: idp.clientId, allowedDomains: 'example.org' });
    await assert.rejects(v.verify(idp.idToken({ email_verified: false })), /allow-list/);
    await assert.rejects(v.verify(idp.idToken({ email_verified: undefined })), /allow-list/);
  });

  it('admits by Google hosted-domain claim and by exact address', async () => {
    const byHd = createVerifier({ issuer: idp.issuer, audience: idp.clientId, allowedDomains: 'corp.test' });
    await byHd.verify(idp.idToken({ hd: 'corp.test', email: 'someone@gmail.test' }));
    const byEmail = createVerifier({ issuer: idp.issuer, audience: idp.clientId, allowedEmails: ['Alice@Example.org'] });
    await byEmail.verify(idp.idToken());
    await assert.rejects(byEmail.verify(idp.idToken({ email: 'bob@example.org' })), /allow-list/);
  });
});

describe('the store accepts ID tokens', () => {
  let idp;
  let ref;
  before(async () => {
    idp = await startMockIssuer();
    ref = await startReferenceStore({ oidc: { issuer: idp.issuer, audience: idp.clientId } });
  });
  after(async () => { await ref.close(); await idp.close(); });

  it('advertises the capability', async () => {
    const { data } = await client(ref.url, null).json('GET', '/health');
    assert.ok(data.capabilities.includes('oidc'));
  });

  it('creates the user and a first brain on first sign-in, and recognises them afterwards', async () => {
    const api = client(ref.url, idp.idToken());
    const me = await api.json('GET', '/auth/me');
    assert.equal(me.status, 200);
    assert.match(me.data.user.id, /^oidc_/);
    assert.equal(me.data.user.email, 'alice@example.org');

    const brains = await api.json('GET', '/api/brains');
    assert.equal(brains.data.length, 1);

    const archive = sampleArchive(2, 'oidc');
    assert.equal((await api.upload(brains.data[0].id, archive)).status, 200);

    // A fresh token for the same person reaches the same brain.
    const again = client(ref.url, idp.idToken({ iat: Math.floor(Date.now() / 1000) - 5 }));
    assert.ok((await again.download(brains.data[0].id)).body.equals(archive));
    assert.equal(ref.store.users.list().filter((u) => u.id.startsWith('oidc_')).length, 1);
  });

  it('keeps different people apart', async () => {
    const bob = client(ref.url, idp.idToken({ sub: 'user-456', email: 'bob@example.org' }));
    const alice = client(ref.url, idp.idToken());
    const [aliceBrain] = (await alice.json('GET', '/api/brains')).data;
    assert.equal((await bob.download(aliceBrain.id)).status, 404);
    assert.equal((await bob.json('GET', '/api/brains')).data.length, 1);
  });

  it('answers 401 to a forged, expired or foreign ID token', async () => {
    const stranger = makeKey('RS256', 'rsa-1');
    const forged = sign(stranger, {}, { iss: idp.issuer, aud: idp.clientId, sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 60 });
    for (const token of [forged, idp.idToken({ exp: 1 }), idp.idToken({ aud: 'other' })]) {
      assert.equal((await client(ref.url, token).json('GET', '/auth/me')).status, 401);
    }
  });

  it('still accepts static tokens', async () => {
    assert.equal((await client(ref.url, ref.token).json('GET', '/auth/me')).status, 200);
  });

  it('does not treat ID tokens as credentials when OIDC is not configured', async () => {
    const plain = await startReferenceStore();
    try {
      assert.equal((await client(plain.url, idp.idToken()).json('GET', '/auth/me')).status, 401);
    } finally {
      await plain.close();
    }
  });
});
