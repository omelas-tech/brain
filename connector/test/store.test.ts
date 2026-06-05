// Proves the store seam: with a configured provider, ensureUserBrain populates
// the per-user brainDir, and the connector then recalls over it. Here we use the
// `local` provider (symlink to a source brain) — the same mechanism the brain-cloud
// provider uses, minus the network pull.

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
import { resolveBrainDir } from "../src/oauth.js";

const execFileAsync = promisify(execFile);
const RECALL_BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "recall.js");

function seedSourceBrain(dir: string) {
  fs.mkdirSync(path.join(dir, "professional"), { recursive: true });
  fs.mkdirSync(path.join(dir, "_archived"), { recursive: true });
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({
    version: 2, created: "2026-01-01T00:00:00.000Z", last_updated: "2026-06-01T00:00:00.000Z", memory_count: 1,
    memories: { mem_src_1: { path: "professional/db.md", title: "Postgres connection pooling", type: "decision", cognitive_type: "semantic", strength: 0.8, decay_rate: 0.995, salience: 0.5, confidence: 0.9, last_accessed: "2026-06-01T00:00:00.000Z", access_count: 1, tags: ["postgres", "pooling"], related: [], encoding_context: { project: "infra", topics: ["database"], task_type: "deciding" } } },
    config: { max_depth: 6, consolidation_threshold: 0.3, association_config: { spreading_activation_depth: 2, spreading_activation_decay: 0.5 } },
  }));
  fs.writeFileSync(path.join(dir, "professional", "db.md"), "---\nid: mem_src_1\ntype: decision\ntags: [postgres, pooling]\n---\n# Postgres connection pooling\nUse a pgbouncer pool; size it to the CPU count. Connection pooling pattern.\n");
  fs.writeFileSync(path.join(dir, "associations.json"), '{"version":1,"edges":{}}');
  fs.writeFileSync(path.join(dir, "contexts.json"), '{"version":1,"sessions":[]}');
  fs.writeFileSync(path.join(dir, "review-queue.json"), '{"version":1,"items":[]}');
  fs.writeFileSync(path.join(dir, "_archived", "index.json"), '{"version":1,"archived_count":0,"memories":{}}');
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bc-store-"));
  const sourceBrain = path.join(tmp, "source-brain");
  seedSourceBrain(sourceBrain);
  await execFileAsync(process.execPath, [RECALL_BIN, "--reindex"], { env: { ...process.env, BRAIN_DIR: sourceBrain } });

  // Configure the LOCAL store provider; the per-user dir does NOT exist yet.
  process.env.CONNECTOR_BRAIN_BASE = path.join(tmp, "users");
  process.env.CONNECTOR_STORE = "local";
  process.env.DEV_LOCAL_BRAIN = sourceBrain;

  const userId = "brain_storetest";
  const brainDir = resolveBrainDir(userId);
  assert.ok(!fs.existsSync(path.join(brainDir, "index.json")), "per-user brain absent before recall");

  const srv = createApp().listen(0);
  await new Promise((r) => srv.once("listening", r));
  const port = (srv.address() as import("node:net").AddressInfo).port;

  try {
    const token = issueToken(userId, brainDir, { aud: `http://localhost:${port}/mcp` });
    const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "store-test", version: "0.0.1" });
    await client.connect(transport);

    // The tool handler calls ensureUserBrain → local provider populates brainDir.
    const recallRes: any = await client.callTool({ name: "brain_recall", arguments: { query: "postgres pooling", limit: 3 } });
    const hits = recallRes.structuredContent.results;
    assert.equal(hits[0].id, "mem_src_1", "recall returns the source brain's memory after the store populated it");

    assert.ok(fs.existsSync(path.join(brainDir, "index.json")), "store populated the per-user brain dir");
    console.log(`  store(local) populated ${brainDir} → brain_recall → ${hits[0].id} (score ${hits[0].score})`);
    console.log("\n✅ STORE: ensureUserBrain resolves a user's brain on demand, then the connector recalls over it.");
    await client.close();
  } finally {
    srv.close();
  }
}

main().catch((e) => { console.error("\n❌ store test failed:", e); process.exit(1); });
