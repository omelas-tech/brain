// Self-hosting: the connector as a stateless MCP server in front of a brain-store.
//
// No Firebase, no Brain Cloud. The real connector talks to the real reference
// store (../store), and login is the static identity provider: the user pastes the
// token their store's operator issued.
//
// Proves ① the login page is served and cannot be framed, ② a wrong token is
// refused, may be retried a bounded number of times, and then the login is spent,
// ③ the right token completes OAuth, ④ a brand-new user (brain record, no archive
// yet) logs in cleanly, ⑤ a write through MCP lands in the store, ⑥ a second
// writer's push is never overwritten: the connector starts again from the store's
// brain, re-applies its write, and both memories survive, ⑦ a silent refresh
// works, and rotating the token at the store ends the session, ⑧ the static
// provider refuses to run without an explicit store address.
//
// Run: npm test   (from connector/)

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createApp } from "../src/server.js";
import { initOAuthState } from "../src/persist.js";
import { activeProvider } from "../src/identity.js";

const require = createRequire(import.meta.url);
const { startReferenceStore, client: storeClient } = require("../../store/conformance/helpers.js");
const cloud = require("../../src/cloud-sync.js");

const b64url = (b: Buffer) => b.toString("base64url");
const redirectUri = "https://claude.ai/api/mcp/auth_callback";
const log = (s: string) => console.log(`  ${s}`);

interface Pending { loginId: string; verifier: string; clientId: string; frame: string | null }

async function beginLogin(base: string, clientId: string): Promise<Pending> {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const url = new URL(`${base}/authorize`);
  url.search = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri,
    code_challenge: challenge, code_challenge_method: "S256",
    resource: `${base}/mcp`, scope: "brain.read brain.write", state: "s",
  }).toString();
  const res = await fetch(url, { redirect: "manual" });
  assert.equal(res.status, 200, "authorize renders the login page");
  const html = await res.text();
  const loginId = /login_id: "(login_[^"]+)"/.exec(html)?.[1];
  assert.ok(loginId, "login page carries the login id");
  assert.match(html, /name="store_token"/);
  assert.doesNotMatch(html, /https?:\/\/(?!127\.0\.0\.1|localhost)/, "login page loads nothing from other hosts");
  return { loginId: loginId!, verifier, clientId, frame: res.headers.get("x-frame-options") };
}

async function complete(base: string, p: Pending, storeToken: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/authorize/complete`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ login_id: p.loginId, store_token: storeToken }),
  });
  return { status: res.status, body: await res.json() };
}

async function exchange(base: string, p: Pending, redirect: string): Promise<any> {
  const code = new URL(redirect).searchParams.get("code")!;
  const res = await fetch(`${base}/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: redirectUri,
      client_id: p.clientId, code_verifier: p.verifier, resource: `${base}/mcp`,
    }).toString(),
  });
  assert.equal(res.status, 200, "token exchange succeeds");
  return res.json();
}

async function mcp(base: string, accessToken: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const c = new Client({ name: "selfhost-test", version: "0.0.1" });
  await c.connect(transport);
  return c;
}

async function main() {
  const ref = await startReferenceStore();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "bc-selfhost-"));
  process.env.CONNECTOR_BRAIN_BASE = path.join(work, "copies");
  process.env.CONNECTOR_REPULL_TTL_MS = "0"; // no background re-pull: the test controls every pull
  delete process.env.NODE_ENV;
  delete process.env.CONNECTOR_DEV_AUTH;
  delete process.env.CONNECTOR_STORE;
  delete process.env.DEV_LOCAL_BRAIN;
  for (const k of ["FIREBASE_API_KEY", "FIREBASE_AUTH_DOMAIN", "FIREBASE_PROJECT_ID"]) delete process.env[k];
  initOAuthState({ dir: path.join(work, "state"), key: crypto.randomBytes(32).toString("hex") });

  // ⑧ first: selecting "static" without naming the store must not fall back to the hosted default.
  process.env.CONNECTOR_IDP = "static";
  delete process.env.BRAIN_CLOUD_API_URL;
  assert.equal(activeProvider(), null, "static provider needs an explicit store address");
  process.env.CONNECTOR_IDP = "nonsense";
  assert.equal(activeProvider(), null, "an unknown provider name selects nothing");

  process.env.CONNECTOR_IDP = "static";
  process.env.BRAIN_CLOUD_API_URL = ref.url;
  assert.equal(activeProvider()?.name, "static");
  log("⑧ static provider: refuses to run without an explicit store address");

  const srv = createApp().listen(0);
  await new Promise((r) => srv.once("listening", r));
  const base = `http://localhost:${(srv.address() as import("node:net").AddressInfo).port}`;

  const owner = storeClient(ref.url, ref.token);
  const laptop = fs.mkdtempSync(path.join(work, "laptop-"));

  try {
    const reg: any = await (await fetch(`${base}/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [redirectUri], client_name: "Test client" }),
    })).json();

    // ① the page
    let pending = await beginLogin(base, reg.client_id);
    assert.equal(pending.frame, "DENY", "the credential page cannot be framed");
    log("① login page: served, self-contained, unframeable");

    // ② wrong token: refused, bounded retries, then spent
    for (let i = 1; i <= 3; i++) {
      const bad = await complete(base, pending, "bst_this-is-not-the-token");
      assert.equal(bad.status, 401);
      assert.equal(bad.body.error, "access_denied");
      if (i === 3) assert.match(bad.body.error_description, /too many attempts/);
    }
    const spent = await complete(base, pending, ref.token);
    assert.equal(spent.status, 400, "after three failures even the right token is refused: the login is spent");
    log("② wrong token: refused; three tries, then the login is spent");

    // ③ + ④ the right token, for a user whose brain has never been pushed to
    await owner.json("POST", "/api/brains", { name: "default" });
    pending = await beginLogin(base, reg.client_id);
    const miss = await complete(base, pending, "bst_typo");
    assert.equal(miss.status, 401);
    const ok = await complete(base, pending, ref.token);
    assert.equal(ok.status, 200, "a retry on the same page succeeds");
    const tok = await exchange(base, pending, ok.body.redirect);
    assert.ok(tok.access_token && tok.refresh_token);
    log("③ right token (after one typo): OAuth completes");

    let mcpClient = await mcp(base, tok.access_token);
    const status: any = await mcpClient.callTool({ name: "brain_status", arguments: {} });
    assert.equal(status.structuredContent.memory_count, 0);
    log("④ brand-new user: empty brain, no error");

    // ⑤ a write through MCP lands in the store
    const first: any = await mcpClient.callTool({
      name: "brain_memorize",
      arguments: { content: "We deploy the store behind Caddy.", title: "Store sits behind Caddy", origin: "user" },
    });
    assert.equal(first.structuredContent.synced, true, JSON.stringify(first.structuredContent));
    const [brain] = (await owner.json("GET", "/api/brains")).data;
    assert.ok(brain.checksum, "the store now holds an archive");
    assert.ok(brain.file_count > 0);
    log(`⑤ memorize via MCP → store (${brain.file_count} files)`);

    // ⑥ a second writer pushes; the connector must not overwrite it
    await cloud.loginWithToken(laptop, ref.url, ref.token);
    await cloud.pull(laptop);
    execFileSync(process.execPath, [path.resolve("..", "bin", "memorize.js")], {
      env: { ...process.env, BRAIN_DIR: laptop },
      input: JSON.stringify({ memories: [{
        title: "Laptop note", type: "learning", cognitive_type: "semantic", path: "captured/laptop-note.md",
        tags: [], salience: 0.5, confidence: 0.8, source: "test", origin: "user", content: "Written on the laptop.",
        encoding_context: { project: "", topics: [], task_type: "capturing" },
      }] }),
    });
    const fromLaptop = await cloud.push(laptop);

    const second: any = await mcpClient.callTool({
      name: "brain_memorize",
      arguments: { content: "Backups run nightly at 02:00.", title: "Nightly backups", origin: "user" },
    });
    assert.equal(second.structuredContent.synced, true, "the write still syncs, after starting again from the store's brain");

    const after = (await owner.json("GET", `/api/brains/${brain.id}`)).data;
    assert.notEqual(after.checksum, fromLaptop.checksum);
    const check = fs.mkdtempSync(path.join(work, "check-"));
    await cloud.loginWithToken(check, ref.url, ref.token);
    await cloud.pull(check);
    const index = JSON.parse(fs.readFileSync(path.join(check, "index.json"), "utf-8"));
    const titles = Object.values(index.memories as Record<string, any>).map((m) => m.title).sort();
    assert.deepEqual(titles, ["Laptop note", "Nightly backups", "Store sits behind Caddy"],
      "all three memories are indexed: nobody's work was lost, and the write was not duplicated");
    log("⑥ concurrent writer: push refused (412), write re-applied on the store's brain, nothing lost");

    // ⑦ silent refresh, then revocation at the store
    const refreshed: any = await (await fetch(`${base}/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: reg.client_id }).toString(),
    })).json();
    assert.ok(refreshed.access_token, "refresh mints a new access token");
    mcpClient = await mcp(base, refreshed.access_token);
    const recall: any = await mcpClient.callTool({ name: "brain_recall", arguments: { query: "nightly backups", limit: 3 } });
    assert.ok(recall.structuredContent.count >= 1);

    ref.store.users.rotate("conformance-a"); // the operator rotates the user's token
    const dead = await fetch(`${base}/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshed.refresh_token, client_id: reg.client_id }).toString(),
    });
    assert.equal(dead.status, 400);
    assert.equal(((await dead.json()) as any).error, "invalid_grant");
    log("⑦ refresh works; rotating the token at the store ends the session");

    console.log("\n✅ SELF-HOST: static login, stateless MCP over a remote brain-store, and no lost writes.");
  } finally {
    srv.close();
    (srv as any).closeAllConnections?.();
    await ref.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
