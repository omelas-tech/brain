// Phase 1 proof (full OAuth): the connector runs the complete OAuth 2.1 + PKCE
// handshake AND, with the issued token, the official-SDK MCP server returns the
// brain's REAL scored recall for the resolved user.
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
    config: { max_depth: 6, consolidation_threshold: 0.3, association_config: { spreading_activation_depth: 2, spreading_activation_decay: 0.5 } },
  }));
  fs.writeFileSync(path.join(brainDir, "professional", "k8s.md"),
    "---\nid: mem_test_1\ntype: decision\ntags: [kubernetes, deployment, rollback]\n---\n# Kubernetes rollback decision\nWe rolled back the kubernetes deployment after the failed canary. Use kubectl rollout undo for fast recovery.\n");
  fs.writeFileSync(path.join(brainDir, "associations.json"), '{"version":1,"edges":{}}');
  fs.writeFileSync(path.join(brainDir, "contexts.json"), '{"version":1,"sessions":[]}');
  fs.writeFileSync(path.join(brainDir, "review-queue.json"), '{"version":1,"items":[]}');
  fs.writeFileSync(path.join(brainDir, "_archived", "index.json"), '{"version":1,"archived_count":0,"memories":{}}');
}

async function main() {
  // Point the connector's per-user store at a temp base, then seed the brain at
  // the exact dir the OAuth flow will resolve to (firebase test uid → userId → dir).
  const baseTmp = fs.mkdtempSync(path.join(os.tmpdir(), "bc-store-"));
  process.env.CONNECTOR_BRAIN_BASE = baseTmp;
  const userId = resolveBrainUserId("firebase-uid-TEST");
  const brainDir = resolveBrainDir(userId);
  seedBrainAt(brainDir);
  await execFileAsync(process.execPath, [RECALL_BIN, "--reindex"], { env: { ...process.env, BRAIN_DIR: brainDir } });

  const srv = createApp().listen(0);
  await new Promise((r) => srv.once("listening", r));
  const port = (srv.address() as import("node:net").AddressInfo).port;
  const base = `http://localhost:${port}`;
  const log = (s: string) => console.log(`  ${s}`);

  try {
    // 1. Unauthenticated MCP call → 401 + WWW-Authenticate (RFC 9728)
    const noauth = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(noauth.status, 401, "unauth → 401");
    assert.match(noauth.headers.get("www-authenticate") ?? "", /resource_metadata=".*oauth-protected-resource"/);
    log(`① unauth → 401 (RFC 9728 challenge)`);

    // 2. Full OAuth 2.1 + PKCE handshake (discover → register → authorize → token)
    const prm: any = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
    const issuer = prm.authorization_servers[0];
    const resource = prm.resource;
    const asm: any = await (await fetch(`${issuer}/.well-known/oauth-authorization-server`)).json();
    assert.ok(asm.code_challenge_methods_supported.includes("S256"));
    log(`② discovery → AS ${issuer}, PKCE S256`);

    const redirectUri = "https://claude.ai/api/mcp/auth_callback";
    const reg: any = await (await fetch(asm.registration_endpoint, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }),
    })).json();
    log(`③ DCR → ${reg.client_id}`);

    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
    const state = b64url(crypto.randomBytes(8));
    const authUrl = new URL(asm.authorization_endpoint);
    authUrl.search = new URLSearchParams({
      response_type: "code", client_id: reg.client_id, redirect_uri: redirectUri,
      code_challenge: challenge, code_challenge_method: "S256",
      resource, scope: "brain.read brain.write", state,
    }).toString();
    const authRes = await fetch(authUrl, { redirect: "manual" });
    assert.equal(authRes.status, 302);
    const cb = new URL(authRes.headers.get("location")!);
    assert.equal(cb.searchParams.get("iss"), issuer, "iss matches (RFC 9207)");
    assert.equal(cb.searchParams.get("state"), state);
    const code = cb.searchParams.get("code")!;
    log(`④ authorize → code (iss + state validated)`);

    // Real OAuth clients (incl. Claude) send the token request form-urlencoded.
    const tok: any = await (await fetch(asm.token_endpoint, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code", code, redirect_uri: redirectUri,
        client_id: reg.client_id, code_verifier: verifier, resource,
      }).toString(),
    })).json();
    assert.equal(tok.token_type, "Bearer");
    assert.ok(tok.access_token);
    log(`⑤ token → audience-bound Bearer (PKCE verified)`);

    // 3. Use the issued token with the official SDK MCP client → real recall
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${tok.access_token}` } },
    });
    const client = new Client({ name: "phase1-test", version: "0.0.1" });
    await client.connect(transport);

    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(tools, ["brain_recall", "brain_status"]);
    log(`⑥ MCP initialize + tools/list → [${tools.join(", ")}]`);

    const statusRes: any = await client.callTool({ name: "brain_status", arguments: {} });
    assert.equal(statusRes.structuredContent.memory_count, 1);

    const recallRes: any = await client.callTool({ name: "brain_recall", arguments: { query: "kubernetes rollback", limit: 5 } });
    const hits = recallRes.structuredContent.results;
    assert.equal(hits[0].id, "mem_test_1");
    assert.ok(typeof hits[0].score === "number" && hits[0].score > 0);
    log(`⑦ brain_recall → ${hits[0].id} (score ${hits[0].score}) for user ${userId}`);

    await client.close();
    console.log(`\n✅ PHASE 1 (full OAuth): handshake → audience-bound token → SDK MCP → REAL scored recall, all in one server.`);
  } finally {
    srv.close();
  }
}

main().catch((e) => {
  console.error("\n❌ phase 1 oauth test failed:", e);
  process.exit(1);
});
