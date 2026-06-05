// Phase 1 proof: official-SDK MCP server, behind the OAuth resource guard,
// returns the brain's REAL scored recall for the authenticated user.
//
// Run: npm test   (from connector/)

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createApp } from "../src/server.js";
import { issueToken } from "../src/auth.js";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECALL_BIN = path.resolve(HERE, "..", "..", "bin", "recall.js");

function seedBrain(): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "bc-test-"));
  const brainDir = path.join(base, ".brain");
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
  return brainDir;
}

async function main() {
  const brainDir = seedBrain();
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
    log(`① unauth → 401, ${noauth.headers.get("www-authenticate")}`);

    // 2. Authenticated MCP session via the official SDK client
    const token = issueToken("user-test", brainDir);
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "phase1-test", version: "0.0.1" });
    await client.connect(transport);
    log("② MCP initialize OK (official SDK client ↔ server)");

    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(tools, ["brain_recall", "brain_status"]);
    log(`③ tools/list → [${tools.join(", ")}]`);

    const statusRes: any = await client.callTool({ name: "brain_status", arguments: {} });
    assert.equal(statusRes.structuredContent.memory_count, 1);
    log(`④ brain_status → memory_count=${statusRes.structuredContent.memory_count}`);

    const recallRes: any = await client.callTool({ name: "brain_recall", arguments: { query: "kubernetes rollback", limit: 5 } });
    const hits = recallRes.structuredContent.results;
    assert.ok(Array.isArray(hits) && hits.length >= 1, "recall returns hits");
    assert.equal(hits[0].id, "mem_test_1", "top hit is the seeded memory");
    assert.ok(typeof hits[0].score === "number" && hits[0].score > 0, "hit carries an engine score");
    log(`⑤ brain_recall("kubernetes rollback") → ${hits[0].id} (score ${hits[0].score})`);

    await client.close();
    console.log(`\n✅ PHASE 1: official-SDK MCP server, OAuth-guarded, returns the brain's REAL scored recall.`);
  } finally {
    srv.close();
  }
}

main().catch((e) => {
  console.error("\n❌ phase 1 test failed:", e);
  process.exit(1);
});
