// OpenID Connect sign-in: the connector in front of a self-hosted store, with an
// organisation's identity provider deciding who the user is.
//
// A mock issuer (real RS256 signatures, real PKCE check) stands in for Google
// Workspace / Entra / Keycloak. The store is the real reference store, configured
// to accept that issuer's ID tokens.
//
// Proves ① /authorize sends the browser to the issuer with PKCE + nonce and keeps
// the secrets server-side, ② the callback completes OAuth and the user's brain is
// provisioned at the store on first sign-in, ③ a write through MCP lands in the
// store under the OIDC user, ④ a callback is single-use and an unknown state is
// refused, ⑤ a user who cancels at the issuer is sent back with access_denied,
// ⑥ a silent refresh renews the ID token, ⑦ revocation at the issuer ends the
// session, and an issuer outage does not, ⑧ the provider refuses to run without an
// explicit store address.
//
// Run: npm test   (from connector/)

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createApp } from "../src/server.js";
import { initOAuthState } from "../src/persist.js";
import { activeProvider } from "../src/identity.js";

const require = createRequire(import.meta.url);
const { startReferenceStore } = require("../../store/conformance/helpers.js");
const { startMockIssuer } = require("../../store/test/mock-issuer.js");

const b64url = (b: Buffer) => b.toString("base64url");
const redirectUri = "https://claude.ai/api/mcp/auth_callback";
const log = (s: string) => console.log(`  ${s}`);

async function main() {
  const idp = await startMockIssuer();
  const ref = await startReferenceStore({ oidc: { issuer: idp.issuer, audience: idp.clientId } });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "bc-oidc-"));
  process.env.CONNECTOR_BRAIN_BASE = path.join(work, "copies");
  process.env.CONNECTOR_REPULL_TTL_MS = "0";
  for (const k of ["NODE_ENV", "CONNECTOR_DEV_AUTH", "CONNECTOR_STORE", "DEV_LOCAL_BRAIN",
    "FIREBASE_API_KEY", "FIREBASE_AUTH_DOMAIN", "FIREBASE_PROJECT_ID", "OIDC_CLIENT_SECRET", "OIDC_AUTH_PARAMS"]) delete process.env[k];
  initOAuthState({ dir: path.join(work, "state"), key: crypto.randomBytes(32).toString("hex") });

  process.env.CONNECTOR_IDP = "oidc";
  process.env.OIDC_ISSUER = idp.issuer;
  process.env.OIDC_CLIENT_ID = idp.clientId;
  delete process.env.BRAIN_CLOUD_API_URL;
  assert.equal(activeProvider(), null, "oidc provider needs an explicit store address");
  process.env.BRAIN_CLOUD_API_URL = ref.url;
  assert.equal(activeProvider()?.name, "oidc");
  log("⑧ oidc provider: refuses to run without an explicit store address");

  const srv = createApp().listen(0);
  await new Promise((r) => srv.once("listening", r));
  const base = `http://localhost:${(srv.address() as import("node:net").AddressInfo).port}`;

  const reg: any = await (await fetch(`${base}/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [redirectUri] }),
  })).json();

  /** Drive /authorize up to the issuer's redirect back to us. */
  async function toIssuer() {
    const verifier = b64url(crypto.randomBytes(32));
    const url = new URL(`${base}/authorize`);
    url.search = new URLSearchParams({
      response_type: "code", client_id: reg.client_id, redirect_uri: redirectUri,
      code_challenge: b64url(crypto.createHash("sha256").update(verifier).digest()), code_challenge_method: "S256",
      resource: `${base}/mcp`, scope: "brain.read brain.write", state: "client-state",
    }).toString();
    const first = await fetch(url, { redirect: "manual" });
    assert.equal(first.status, 302);
    const atIssuer = new URL(first.headers.get("location")!);
    return { verifier, atIssuer };
  }

  async function exchange(code: string, verifier: string): Promise<any> {
    const res = await fetch(`${base}/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code", code, redirect_uri: redirectUri,
        client_id: reg.client_id, code_verifier: verifier, resource: `${base}/mcp`,
      }).toString(),
    });
    assert.equal(res.status, 200);
    return res.json();
  }

  const refresh = (token: string) => fetch(`${base}/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token, client_id: reg.client_id }).toString(),
  });

  try {
    // ① to the issuer
    const { verifier, atIssuer } = await toIssuer();
    assert.equal(atIssuer.origin, idp.issuer);
    const p = atIssuer.searchParams;
    assert.equal(p.get("client_id"), idp.clientId);
    assert.equal(p.get("redirect_uri"), `${base}/oidc/callback`);
    assert.equal(p.get("code_challenge_method"), "S256");
    assert.ok(p.get("nonce") && p.get("code_challenge") && p.get("state")?.startsWith("login_"));
    assert.ok(!atIssuer.toString().includes(verifier), "our client's PKCE verifier never leaves the client");
    log("① /authorize → issuer, with PKCE + nonce; secrets stay server-side");

    // ② issuer → callback → client
    const issuerRes = await fetch(atIssuer, { redirect: "manual" });
    const callback = issuerRes.headers.get("location")!;
    const done = await fetch(callback, { redirect: "manual" });
    assert.equal(done.status, 302);
    const toClient = new URL(done.headers.get("location")!);
    assert.equal(toClient.origin + toClient.pathname, redirectUri);
    assert.equal(toClient.searchParams.get("state"), "client-state");
    const tok = await exchange(toClient.searchParams.get("code")!, verifier);
    assert.ok(tok.access_token && tok.refresh_token);
    const oidcUsers = () => ref.store.users.list().filter((u: any) => u.id.startsWith("oidc_"));
    assert.equal(oidcUsers().length, 1, "the store provisioned the user on first sign-in");
    log("② callback → OAuth completes; user provisioned at the store");

    // ③ write through MCP
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${tok.access_token}` } },
    });
    const mcp = new Client({ name: "oidc-test", version: "0.0.1" });
    await mcp.connect(transport);
    const stored: any = await mcp.callTool({
      name: "brain_memorize",
      arguments: { content: "Sign-in goes through the company identity provider.", title: "Company SSO", origin: "user" },
    });
    assert.equal(stored.structuredContent.synced, true, JSON.stringify(stored.structuredContent));
    const [brain] = ref.store.storage.listBrains(oidcUsers()[0].id);
    assert.ok(brain.checksum && brain.file_count > 0);
    log("③ memorize via MCP → store, under the OIDC user");

    // ④ single-use + unknown state
    assert.equal((await fetch(callback, { redirect: "manual" })).status, 400, "a callback cannot be replayed");
    assert.equal((await fetch(`${base}/oidc/callback?code=x&state=login_nope`, { redirect: "manual" })).status, 400);
    log("④ callback is single-use; unknown state refused");

    // ⑤ cancelled at the issuer
    const again = await toIssuer();
    const cancelled = await fetch(`${base}/oidc/callback?error=access_denied&state=${again.atIssuer.searchParams.get("state")}`, { redirect: "manual" });
    assert.equal(cancelled.status, 302);
    assert.equal(new URL(cancelled.headers.get("location")!).searchParams.get("error"), "access_denied");
    log("⑤ cancelled at the issuer → client gets access_denied");

    // ⑥ silent refresh
    const renewed: any = await (await refresh(tok.refresh_token)).json();
    assert.ok(renewed.access_token, "refresh mints a new access token");
    log("⑥ silent refresh renews the ID token");

    // ⑦ an outage must not cost the user their login; a revocation must end it
    idp.state.tokenEndpointDown = true;
    const during = await refresh(renewed.refresh_token);
    assert.equal(during.status, 503, "issuer outage → retryable, not invalid_grant");
    idp.state.tokenEndpointDown = false;
    const afterOutage: any = await (await refresh(renewed.refresh_token)).json();
    assert.ok(afterOutage.access_token, "the same refresh token still works once the issuer is back");

    idp.state.refreshTokens.clear(); // the issuer revokes the login
    const dead = await refresh(afterOutage.refresh_token);
    assert.equal(dead.status, 400);
    assert.equal(((await dead.json()) as any).error, "invalid_grant");
    log("⑦ issuer outage → 503 and the login survives; revocation → session over");

    console.log("\n✅ OIDC: issuer-hosted sign-in, provisioning at the store, MCP writes, renewal and revocation.");
  } finally {
    srv.close();
    (srv as any).closeAllConnections?.();
    await ref.close();
    await idp.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
