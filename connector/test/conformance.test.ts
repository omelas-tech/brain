// MCP conformance + parity checks for the connector:
//   1. Every memory-bearing tool result declares private cache scope
//      (memory must never be cached across users).
//   2. Write tools are gated on the brain.write scope (read-only tokens are
//      refused with an error result, not a silent success).
//   3. brain_verify surfaces the quarantine queue.
//   4. Non-POST verbs on /mcp get an explicit 405.
//
// Run: npm test   (from connector/)

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createApp } from "../src/server.js";
import { resolveBrainUserId, resolveBrainDir } from "../src/oauth.js";
import { CACHE_SCOPE_KEY, isPrivateScoped, memoryResult } from "../src/result.js";
import { hasScope, type Session } from "../src/auth.js";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECALL_BIN = path.resolve(HERE, "..", "..", "bin", "recall.js");
const b64url = (b: Buffer) => b.toString("base64url");

function seedBrainAt(brainDir: string) {
  fs.mkdirSync(path.join(brainDir, "professional"), { recursive: true });
  fs.mkdirSync(path.join(brainDir, "_archived"), { recursive: true });
  fs.writeFileSync(path.join(brainDir, "index.json"), JSON.stringify({
    version: 2, created: "2026-01-01T00:00:00.000Z", last_updated: "2026-06-01T00:00:00.000Z",
    memory_count: 1,
    memories: {
      mem_test_1: {
        path: "professional/k8s.md", title: "Kubernetes rollback decision", type: "decision",
        cognitive_type: "semantic", strength: 0.85, decay_rate: 0.995, salience: 0.6, confidence: 0.9,
        last_accessed: "2026-06-01T00:00:00.000Z", access_count: 1,
        tags: ["kubernetes", "deployment", "rollback"], related: [],
        encoding_context: { project: "infra", topics: ["kubernetes"], task_type: "deciding" },
      },
    },
    config: {},
  }));
  fs.writeFileSync(path.join(brainDir, "professional", "k8s.md"),
    "---\nid: mem_test_1\ntype: decision\ntags: [kubernetes, deployment, rollback]\n---\n# Kubernetes rollback decision\nWe rolled back the kubernetes deployment. Use kubectl rollout undo.\n");
  fs.writeFileSync(path.join(brainDir, "associations.json"), '{"version":1,"edges":{}}');
  fs.writeFileSync(path.join(brainDir, "contexts.json"), '{"version":1,"sessions":[]}');
  fs.writeFileSync(path.join(brainDir, "review-queue.json"), '{"version":1,"items":[]}');
  fs.writeFileSync(path.join(brainDir, "_archived", "index.json"), '{"version":1,"archived_count":0,"memories":{}}');
}

/** Full OAuth 2.1 + PKCE handshake for a given scope → Bearer access token. */
async function getToken(base: string, scope: string): Promise<string> {
  const prm: any = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
  const issuer = prm.authorization_servers[0];
  const resource = prm.resource;
  const asm: any = await (await fetch(`${issuer}/.well-known/oauth-authorization-server`)).json();
  const redirectUri = "https://claude.ai/api/mcp/auth_callback";
  const reg: any = await (await fetch(asm.registration_endpoint, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }),
  })).json();
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const authUrl = new URL(asm.authorization_endpoint);
  authUrl.search = new URLSearchParams({
    response_type: "code", client_id: reg.client_id, redirect_uri: redirectUri,
    code_challenge: challenge, code_challenge_method: "S256", resource, scope, state: "x",
  }).toString();
  const authRes = await fetch(authUrl, { redirect: "manual" });
  const cb = new URL(authRes.headers.get("location")!);
  const code = cb.searchParams.get("code")!;
  const tok: any = await (await fetch(asm.token_endpoint, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: redirectUri,
      client_id: reg.client_id, code_verifier: verifier, resource,
    }).toString(),
  })).json();
  return tok.access_token;
}

function clientFor(base: string, token: string): Client {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "conformance-test", version: "0.0.1" });
  return Object.assign(client, { __transport: transport });
}

function unitChecks() {
  // memoryResult always stamps private cache scope.
  const r = memoryResult("hi", { a: 1 });
  assert.equal(r._meta?.[CACHE_SCOPE_KEY], "private");
  assert.ok(isPrivateScoped(r));
  assert.ok(!isPrivateScoped({ _meta: {} }));

  // hasScope splits the space-delimited scope string.
  const s = (scope: string): Session => ({ userId: "u", brainDir: "/x", scope, aud: "a", exp: 0 });
  assert.ok(hasScope(s("brain.read brain.write"), "brain.write"));
  assert.ok(!hasScope(s("brain.read"), "brain.write"));
  assert.ok(hasScope(s("brain.read"), "brain.read"));
  console.log("  ✓ unit: memoryResult scope + hasScope");
}

async function main() {
  unitChecks();

  const baseTmp = fs.mkdtempSync(path.join(os.tmpdir(), "bc-conf-"));
  process.env.CONNECTOR_BRAIN_BASE = baseTmp;
  process.env.CONNECTOR_DEV_AUTH = "1";
  const userId = resolveBrainUserId("firebase-uid-CONF");
  const brainDir = resolveBrainDir(userId);
  seedBrainAt(brainDir);
  await execFileAsync(process.execPath, [RECALL_BIN, "--reindex"], { env: { ...process.env, BRAIN_DIR: brainDir } });

  const srv = createApp().listen(0);
  await new Promise((r) => srv.once("listening", r));
  const port = (srv.address() as import("node:net").AddressInfo).port;
  const base = `http://localhost:${port}`;

  try {
    // --- 4. Non-POST /mcp → 405 (probe before auth; no token needed) ---
    const getRes = await fetch(`${base}/mcp`, { method: "GET" });
    assert.equal(getRes.status, 405, "GET /mcp → 405");
    assert.equal(getRes.headers.get("allow"), "POST");
    console.log("  ✓ GET /mcp → 405 Allow: POST");

    // --- 1. cacheScope private on every memory-bearing result ---
    const rwToken = await getToken(base, "brain.read brain.write");
    const rw = clientFor(base, rwToken);
    await rw.connect((rw as any).__transport);

    const recallRes: any = await rw.callTool({ name: "brain_recall", arguments: { query: "kubernetes", limit: 5 } });
    assert.equal(recallRes._meta?.[CACHE_SCOPE_KEY], "private", "brain_recall must be private-scoped");
    const statusRes: any = await rw.callTool({ name: "brain_status", arguments: {} });
    assert.equal(statusRes._meta?.[CACHE_SCOPE_KEY], "private", "brain_status must be private-scoped");
    console.log("  ✓ recall + status results declare cacheScope=private");

    // --- 2a. write tool WITH scope → succeeds and is private-scoped ---
    const memRes: any = await rw.callTool({
      name: "brain_memorize",
      arguments: { content: "Deploys go out Tuesdays.", type: "preference", origin: "user" },
    });
    assert.ok(!memRes.isError, "write with brain.write scope should succeed");
    assert.equal(memRes._meta?.[CACHE_SCOPE_KEY], "private");
    console.log("  ✓ brain_memorize with brain.write → ok, private-scoped");

    // --- 3. brain_verify list is reachable and private-scoped ---
    const verifyRes: any = await rw.callTool({ name: "brain_verify", arguments: { action: "list" } });
    assert.equal(verifyRes._meta?.[CACHE_SCOPE_KEY], "private");
    assert.ok(typeof verifyRes.structuredContent?.total === "number", "verify list returns a total");
    console.log("  ✓ brain_verify list → private-scoped queue");
    await rw.close();

    // --- 2b. write tool WITHOUT scope → refused (error result, not success) ---
    const roToken = await getToken(base, "brain.read");
    const ro = clientFor(base, roToken);
    await ro.connect((ro as any).__transport);
    const denied: any = await ro.callTool({
      name: "brain_memorize",
      arguments: { content: "should not be stored", origin: "user" },
    });
    assert.equal(denied.isError, true, "read-only token must be refused for writes");
    assert.match(denied.content[0].text, /brain\.write/);
    // read tool still works on the read-only token
    const roRecall: any = await ro.callTool({ name: "brain_recall", arguments: { query: "kubernetes" } });
    assert.equal(roRecall._meta?.[CACHE_SCOPE_KEY], "private");
    await ro.close();
    console.log("  ✓ read-only token: write refused, read allowed");

    console.log("\n✅ CONFORMANCE: cacheScope=private on all memory results, write-scope enforced, 405 on non-POST.");
  } finally {
    srv.close();
  }
}

main().catch((e) => {
  console.error("\n❌ conformance test failed:", e);
  process.exit(1);
});
