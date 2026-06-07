// Security regression: with NO identity provider configured and NO explicit dev
// opt-in, /authorize must FAIL CLOSED — it must never auto-approve the shared dev
// user and hand out a token. (Earlier behavior auto-approved a fixed user whenever
// FIREBASE_* was unset, so a misconfigured/broken deploy silently disabled auth.)

import assert from "node:assert/strict";

import { createApp } from "../src/server.js";

async function main() {
  // Ensure neither escape hatch is active.
  delete process.env.CONNECTOR_DEV_AUTH;
  delete process.env.NODE_ENV;
  delete process.env.FIREBASE_API_KEY;
  delete process.env.FIREBASE_AUTH_DOMAIN;
  delete process.env.FIREBASE_PROJECT_ID;

  const srv = createApp().listen(0);
  await new Promise((r) => srv.once("listening", r));
  const port = (srv.address() as import("node:net").AddressInfo).port;
  const base = `http://localhost:${port}`;
  const redirectUri = "https://claude.ai/api/mcp/auth_callback";

  try {
    const reg: any = await (await fetch(`${base}/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [redirectUri] }),
    })).json();

    const authUrl = new URL(`${base}/authorize`);
    authUrl.search = new URLSearchParams({
      response_type: "code", client_id: reg.client_id, redirect_uri: redirectUri,
      code_challenge: "x".repeat(43), code_challenge_method: "S256",
      resource: `${base}/mcp`, scope: "brain.read", state: "s1",
    }).toString();

    const res = await fetch(authUrl, { redirect: "manual" });
    assert.equal(res.status, 302, "authorize redirects back to the client");
    const cb = new URL(res.headers.get("location")!);
    assert.equal(cb.searchParams.get("code"), null, "NO auth code must be issued (fail closed)");
    assert.equal(cb.searchParams.get("error"), "server_error", "returns an OAuth error instead");
    console.log(`  /authorize with no Firebase + no dev flag → error=${cb.searchParams.get("error")}, no code`);
    console.log("\n✅ FAIL-CLOSED AUTH: no identity provider ⇒ no token, ever.");
  } finally {
    srv.close();
  }
}

main().catch((e) => { console.error("\n❌ fail-closed auth test failed:", e); process.exit(1); });
