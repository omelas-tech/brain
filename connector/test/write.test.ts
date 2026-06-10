// Phase 2 proof: write tools. brain_memorize stores explicit content, the new
// memory is immediately recallable (memorize updates the search index), and
// brain_pin/brain_unpin toggle the always-present tier. Uses the `local` store
// provider (writes land in the brain dir directly; sync-back is a no-op there).

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

function seedEmptyBrain(dir: string) {
  for (const c of ["professional", "personal", "social", "family", "_consolidated", "captured", "_archived"]) {
    fs.mkdirSync(path.join(dir, c), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({
    version: 2, created: "2026-01-01T00:00:00.000Z", last_updated: "2026-01-01T00:00:00.000Z", memory_count: 0, memories: {},
    config: { max_depth: 6, consolidation_threshold: 0.3, association_config: { spreading_activation_depth: 2, spreading_activation_decay: 0.5 } },
  }));
  fs.writeFileSync(path.join(dir, "associations.json"), '{"version":1,"edges":{}}');
  fs.writeFileSync(path.join(dir, "contexts.json"), '{"version":1,"sessions":[]}');
  fs.writeFileSync(path.join(dir, "review-queue.json"), '{"version":1,"items":[]}');
  fs.writeFileSync(path.join(dir, "_archived", "index.json"), '{"version":1,"archived_count":0,"memories":{}}');
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bc-write-"));
  const source = path.join(tmp, "source-brain");
  seedEmptyBrain(source);
  await execFileAsync(process.execPath, [RECALL_BIN, "--reindex"], { env: { ...process.env, BRAIN_DIR: source } });

  process.env.CONNECTOR_BRAIN_BASE = path.join(tmp, "users");
  process.env.CONNECTOR_STORE = "local";
  process.env.DEV_LOCAL_BRAIN = source;

  const userId = "brain_writetest";
  const brainDir = resolveBrainDir(userId);

  const srv = createApp().listen(0);
  await new Promise((r) => srv.once("listening", r));
  const port = (srv.address() as import("node:net").AddressInfo).port;
  const log = (s: string) => console.log(`  ${s}`);

  try {
    const token = issueToken(userId, brainDir, { aud: `http://localhost:${port}/mcp` });
    const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "write-test", version: "0.0.1" });
    await client.connect(transport);

    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(tools, ["brain_forget", "brain_memorize", "brain_pin", "brain_recall", "brain_status", "brain_unpin"]);
    log(`① tools/list → [${tools.join(", ")}]`);

    // Write a memory from explicit content
    const mem: any = await client.callTool({
      name: "brain_memorize",
      arguments: { content: "Deploy runbook: always run make deploy-all so the email sidecar updates, not just the Go API.", title: "Deploy runbook", type: "decision", tags: ["deploy", "runbook"] },
    });
    const id = mem.structuredContent.stored.id;
    assert.ok(id, "memorize returns a stored id");
    log(`② brain_memorize → ${id} (synced=${mem.structuredContent.synced})`);

    // It's immediately recallable (memorize updated the search index)
    const rec: any = await client.callTool({ name: "brain_recall", arguments: { query: "deploy runbook sidecar", limit: 3 } });
    assert.equal(rec.structuredContent.results[0].id, id, "the just-written memory is the top recall hit");
    log(`③ brain_recall("deploy runbook sidecar") → ${rec.structuredContent.results[0].id} (score ${rec.structuredContent.results[0].score})`);

    // Pin + unpin it
    await client.callTool({ name: "brain_pin", arguments: { id } });
    const pinned = JSON.parse(fs.readFileSync(path.join(brainDir, "pinned.json"), "utf-8"));
    assert.ok(JSON.stringify(pinned).includes(id), "memory is pinned");
    log(`④ brain_pin → ${id} present in pinned.json`);

    await client.callTool({ name: "brain_unpin", arguments: { id } });
    const after = JSON.parse(fs.readFileSync(path.join(brainDir, "pinned.json"), "utf-8"));
    assert.ok(!JSON.stringify(after).includes(id), "memory is unpinned");
    log(`⑤ brain_unpin → ${id} removed from pinned.json`);

    // Forget (archive) it — gone from recall, recoverable in _archived/
    await client.callTool({ name: "brain_forget", arguments: { id } });
    const recAfter: any = await client.callTool({ name: "brain_recall", arguments: { query: "deploy runbook sidecar", limit: 3 } });
    assert.ok(!recAfter.structuredContent.results.some((h: any) => h.id === id), "archived memory no longer recalled");
    const arch = JSON.parse(fs.readFileSync(path.join(brainDir, "_archived", "index.json"), "utf-8"));
    assert.ok(arch.memories[id], "archived memory is recorded in _archived/index.json (recoverable)");
    const st: any = await client.callTool({ name: "brain_status", arguments: {} });
    assert.equal(st.structuredContent.memory_count, 0, "live memory count is back to 0 after archive");
    log(`⑥ brain_forget → ${id} archived (gone from recall, in _archived, count=0)`);

    await client.close();
    console.log("\n✅ PHASE 2 (writes): memorize → recall → pin/unpin → forget(archive), all through the connector.");
  } finally {
    srv.close();
  }
}

main().catch((e) => { console.error("\n❌ write test failed:", e); process.exit(1); });
