// Refresh-token grant: the fix for "claude.ai makes me log in every hour".
//
// Proves ① the token response carries a refresh_token and the metadata advertises
// the grant, ② a refresh silently mints a working access token and ROTATES the
// refresh token, ③ an in-grace replay (burst race) gets the SAME successor back,
// ④ a post-grace replay is treated as theft — the whole family dies, ⑤ refresh
// tokens are client-bound, ⑥ grants + the DCR client registry survive a process
// restart (deploys no longer log users out).
//
// Run: npm test   (from connector/)

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { createApp } from "../src/server.js";
import { initOAuthState } from "../src/persist.js";

const b64url = (b: Buffer) => b.toString("base64url");
const redirectUri = "https://claude.ai/api/mcp/auth_callback";

async function tokenRequest(base: string, params: Record<string, string>): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  return { status: res.status, body: await res.json() };
}

/** Full headless auth-code dance (dev stub) → token response body. */
async function login(base: string, clientId: string): Promise<any> {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const authUrl = new URL(`${base}/authorize`);
  authUrl.search = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri,
    code_challenge: challenge, code_challenge_method: "S256",
    resource: `${base}/mcp`, scope: "brain.read brain.write", state: "s",
  }).toString();
  const authRes = await fetch(authUrl, { redirect: "manual" });
  assert.equal(authRes.status, 302, "authorize redirects");
  const code = new URL(authRes.headers.get("location")!).searchParams.get("code")!;
  assert.ok(code, "auth code issued");
  const { status, body } = await tokenRequest(base, {
    grant_type: "authorization_code", code, redirect_uri: redirectUri,
    client_id: clientId, code_verifier: verifier, resource: `${base}/mcp`,
  });
  assert.equal(status, 200, "token exchange succeeds");
  return body;
}

async function mcpStatus(base: string, accessToken: string): Promise<number> {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    }),
  });
  res.body?.cancel().catch(() => {});
  return res.status;
}

async function main() {
  process.env.CONNECTOR_BRAIN_BASE = fs.mkdtempSync(path.join(os.tmpdir(), "bc-refresh-store-"));
  process.env.CONNECTOR_DEV_AUTH = "1"; // headless dev login — no Firebase in tests
  delete process.env.NODE_ENV;
  delete process.env.FIREBASE_API_KEY;
  delete process.env.FIREBASE_AUTH_DOMAIN;
  delete process.env.FIREBASE_PROJECT_ID;
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-oauth-state-"));
  initOAuthState({ dir: stateDir });

  const srv = createApp().listen(0);
  await new Promise((r) => srv.once("listening", r));
  const port = (srv.address() as import("node:net").AddressInfo).port;
  const base = `http://localhost:${port}`;
  const log = (s: string) => console.log(`  ${s}`);

  try {
    // ① metadata advertises the refresh grant; login returns a refresh token
    const asm: any = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    assert.ok(asm.grant_types_supported.includes("refresh_token"), "AS metadata advertises refresh_token");
    const reg: any = await (await fetch(`${base}/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [redirectUri] }),
    })).json();
    const tok1 = await login(base, reg.client_id);
    assert.ok(tok1.access_token && tok1.refresh_token, "token response has access + refresh");
    assert.equal(tok1.expires_in, 3600);
    log(`① login → access + refresh token (expires_in ${tok1.expires_in})`);

    // ② silent renewal: refresh → NEW access token that works, NEW refresh token
    const r1 = await tokenRequest(base, {
      grant_type: "refresh_token", refresh_token: tok1.refresh_token, client_id: reg.client_id,
    });
    assert.equal(r1.status, 200, `refresh succeeds (got ${r1.status}: ${JSON.stringify(r1.body)})`);
    assert.ok(r1.body.access_token && r1.body.access_token !== tok1.access_token, "fresh access token");
    assert.ok(r1.body.refresh_token && r1.body.refresh_token !== tok1.refresh_token, "refresh token rotated");
    assert.notEqual(await mcpStatus(base, r1.body.access_token), 401, "refreshed access token accepted by /mcp");
    log(`② refresh → new working access token, rotated refresh token`);

    // ③ replaying the rotated token WITHIN the grace window is a benign burst
    // race (concurrent refresh / lost response) → SAME successor, no punishment
    const graceReplay = await tokenRequest(base, {
      grant_type: "refresh_token", refresh_token: tok1.refresh_token, client_id: reg.client_id,
    });
    assert.equal(graceReplay.status, 200, "in-grace replay succeeds");
    assert.equal(graceReplay.body.refresh_token, r1.body.refresh_token, "in-grace replay returns the SAME successor");
    assert.notEqual(await mcpStatus(base, graceReplay.body.access_token), 401, "in-grace replay access token works");
    log(`③ in-grace replay → same successor token, family intact`);

    // ④ PAST the grace window a replay is the OAuth 2.1 theft signal → family kill
    process.env.CONNECTOR_REFRESH_GRACE_MS = "1";
    await new Promise((r) => setTimeout(r, 25));
    const replay = await tokenRequest(base, {
      grant_type: "refresh_token", refresh_token: tok1.refresh_token, client_id: reg.client_id,
    });
    assert.equal(replay.status, 400);
    assert.equal(replay.body.error, "invalid_grant", "post-grace replay rejected");
    const afterReplay = await tokenRequest(base, {
      grant_type: "refresh_token", refresh_token: r1.body.refresh_token, client_id: reg.client_id,
    });
    assert.equal(afterReplay.body.error, "invalid_grant", "successor token revoked with its family");
    delete process.env.CONNECTOR_REFRESH_GRACE_MS;
    log(`④ post-grace replay → invalid_grant + family revoked`);

    // wrong client can't use a refresh token it didn't get
    const tok2 = await login(base, reg.client_id);
    const cross = await tokenRequest(base, {
      grant_type: "refresh_token", refresh_token: tok2.refresh_token, client_id: "client_someone-else",
    });
    assert.equal(cross.body.error, "invalid_grant", "refresh token is client-bound");
    log(`⑤ client binding enforced on refresh`);

    // ⑥ restart simulation: reload state from disk → client registry AND grants live on
    assert.ok(fs.existsSync(path.join(stateDir, "oauth-state.json")), "state persisted to disk");
    initOAuthState({ dir: stateDir }); // wipes in-memory maps, reloads the file
    const tok3 = await login(base, reg.client_id); // same client_id — registry survived
    const r3 = await tokenRequest(base, {
      grant_type: "refresh_token", refresh_token: tok3.refresh_token, client_id: reg.client_id,
    });
    assert.equal(r3.status, 200, "grant minted before 'restart' still refreshes after reload");
    initOAuthState({ dir: stateDir }); // restart again — the ROTATED grant also survived
    const r4 = await tokenRequest(base, {
      grant_type: "refresh_token", refresh_token: r3.body.refresh_token, client_id: reg.client_id,
    });
    assert.equal(r4.status, 200, "rotated grant survives a second restart");
    log(`⑥ restart → client registration + refresh grants survive (no forced re-login)`);

    console.log(`\n✅ REFRESH GRANT: silent renewal, rotation + theft detection, restart-proof logins.`);
  } finally {
    srv.close();
    initOAuthState({ dir: null }); // detach tests from the temp dir
  }
}

main().catch((e) => {
  console.error("\n❌ refresh grant test failed:", e);
  process.exit(1);
});
