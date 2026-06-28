// Working-copy purge: the connector keeps each connected user's brain as a
// PLAINTEXT working copy on the host. To bound a live-host compromise, those copies
// are reaped — after an idle TTL and on session end (last token expired). This
// proves:
//   ① purgeIdleBrains removes copies idle past the TTL, keeps fresh ones;
//   ② purgeBrain is symlink-safe (never nukes the dev `local` provider's real brain);
//   ③ a purge clears freshness state so a returning user is re-pulled transparently;
//   ④ sweepExpiredTokens reports the right dirs to purge on session end, and a
//      surviving (reconnected) token protects its copy;
//   ⑤ recall still works after a copy is purged mid-session (functionality intact);
//   ⑥ startBrainReaper honors the disable switch.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import {
  recordBrainActivity,
  purgeIdleBrains,
  purgeBrain,
  startBrainReaper,
  ensureUserBrain,
} from "../src/store.js";
import { issueToken, sweepExpiredTokens, authenticate, TOKEN_TTL_MS } from "../src/auth.js";
import { createApp } from "../src/server.js";
import { resolveBrainDir } from "../src/oauth.js";

const execFileAsync = promisify(execFile);
const RECALL_BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "recall.js");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const realFetch = globalThis.fetch;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bc-purge-"));
const log = (s: string) => console.log(`  ${s}`);

/** Make a real (non-empty) directory on disk so purge has something to remove. */
function makeDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.json"), '{"version":2,"memory_count":0,"memories":{}}');
  return dir;
}

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

async function brainTarGz(memoryCount: number): Promise<Buffer> {
  const tar = await import("tar");
  const src = fs.mkdtempSync(path.join(tmp, "src-"));
  fs.mkdirSync(path.join(src, "professional"), { recursive: true });
  const memories: Record<string, unknown> = {};
  for (let i = 1; i <= memoryCount; i++) {
    memories[`mem_${i}`] = { path: `professional/m${i}.md`, title: `M${i}`, type: "learning", cognitive_type: "semantic", strength: 0.7, decay_rate: 0.99, salience: 0.5, confidence: 0.8, last_accessed: "2026-06-01T00:00:00.000Z", access_count: 1, tags: ["m"], related: [], encoding_context: { project: "p", topics: ["m"], task_type: "x" } };
    fs.writeFileSync(path.join(src, "professional", `m${i}.md`), `---\nid: mem_${i}\n---\n# M${i}\nbody\n`);
  }
  fs.writeFileSync(path.join(src, "index.json"), JSON.stringify({
    version: 2, created: "2026-01-01T00:00:00.000Z", last_updated: "2026-06-01T00:00:00.000Z",
    memory_count: memoryCount, memories,
    config: { max_depth: 6, consolidation_threshold: 0.3, association_config: { spreading_activation_depth: 2, spreading_activation_decay: 0.5 } },
  }));
  fs.writeFileSync(path.join(src, "associations.json"), '{"version":1,"edges":{}}');
  const file = path.join(tmp, `bundle-${memoryCount}-${Math.round(performance.now())}.tar.gz`);
  await tar.c({ gzip: true, file, cwd: src, portable: true }, ["."]);
  return fs.readFileSync(file);
}

// ① Idle purge: stale copies go, fresh copies stay. -------------------------
function testIdlePurge() {
  const t0 = 1_000_000;
  const idleDir = makeDir(path.join(tmp, "idle", ".brain"));
  const freshDir = makeDir(path.join(tmp, "fresh", ".brain"));
  recordBrainActivity(idleDir, t0);
  recordBrainActivity(freshDir, t0 + 9_000);

  const purged = purgeIdleBrains({ idleMs: 5_000, now: t0 + 10_000 });
  assert.deepEqual(purged, [idleDir], "only the idle copy is purged");
  assert.ok(!fs.existsSync(idleDir), "idle working copy removed from disk");
  assert.ok(fs.existsSync(freshDir), "fresh working copy preserved");

  // keepAlive vetoes a purge even past the TTL.
  recordBrainActivity(idleDir, t0); // re-register (it was just removed); dir is gone but state present
  makeDir(idleDir);
  const kept = purgeIdleBrains({ idleMs: 5_000, now: t0 + 10_000, keepAlive: (d) => d === idleDir });
  assert.deepEqual(kept, [], "keepAlive vetoes the purge");
  assert.ok(fs.existsSync(idleDir), "vetoed copy preserved");
  purgeBrain(idleDir); purgeBrain(freshDir); // cleanup
  log("① idle purge: stale copy reaped, fresh + keepAlive copies preserved");
}

// ② purgeBrain never follows the dev `local` provider's symlink. ------------
function testSymlinkSafe() {
  const target = makeDir(path.join(tmp, "real-brain"));
  const sentinel = path.join(target, "sentinel.md");
  fs.writeFileSync(sentinel, "do not delete me");
  const link = path.join(tmp, "linked", ".brain");
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link);
  recordBrainActivity(link, 0);

  assert.ok(purgeBrain(link), "purge removed the symlink");
  assert.ok(!fs.existsSync(link), "the symlink is gone");
  assert.ok(fs.existsSync(target) && fs.existsSync(sentinel), "the symlink TARGET (real brain) is untouched");
  log("② symlink-safe: purge unlinks the dev link, never the real brain it points to");
}

// ③ A purge clears freshness state → a returning user is re-pulled. ---------
async function testRePullAfterPurge() {
  delete process.env.CONNECTOR_STORE;
  delete process.env.DEV_LOCAL_BRAIN;
  process.env.BRAIN_CLOUD_API_URL = "http://cloud.test";
  const cloud = { checksum: "c1", bundle: await brainTarGz(1) };
  const calls = { lists: 0, downloads: 0 };
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (u.endsWith("/api/brains")) {
      calls.lists++;
      return { ok: true, status: 200, json: async () => [{ id: "b1", created_at: "2026-01-01T00:00:00.000Z", checksum: cloud.checksum }] } as any;
    }
    if (/\/api\/brains\/[^/]+\/sync$/.test(u) && method === "GET") {
      calls.downloads++;
      return { ok: true, status: 200, arrayBuffer: async () => cloud.bundle } as any;
    }
    throw new Error(`unexpected fetch ${method} ${u}`);
  }) as typeof fetch;

  const dir = path.join(tmp, "repull", ".brain");
  const idToken = "tok";

  const first = await ensureUserBrain({ userId: "u-repull", brainDir: dir, idToken, refresh: true });
  assert.equal(calls.downloads, 1, "login pulls once");
  assert.equal(first.memoryCount, 1);
  assert.ok(fs.existsSync(path.join(dir, "index.json")), "working copy provisioned");

  // Within the TTL there is normally no re-download...
  await ensureUserBrain({ userId: "u-repull", brainDir: dir, idToken, ttlMs: 60_000 });
  assert.equal(calls.downloads, 1, "fresh copy → no re-download");

  // ...but once the reaper purges the idle copy, the next access MUST re-pull it.
  assert.ok(purgeBrain(dir), "idle copy purged");
  assert.ok(!fs.existsSync(dir), "working copy gone after purge");
  const back = await ensureUserBrain({ userId: "u-repull", brainDir: dir, idToken, ttlMs: 60_000 });
  assert.equal(calls.downloads, 2, "purged copy is re-pulled on return");
  assert.equal(back.memoryCount, 1, "re-pulled brain is intact");
  assert.ok(fs.existsSync(path.join(dir, "index.json")), "working copy restored");

  globalThis.fetch = realFetch;
  delete process.env.BRAIN_CLOUD_API_URL;
  purgeBrain(dir);
  log("③ re-pull: purge clears freshness state, returning user transparently re-provisioned");
}

// ④ Session-end: sweepExpiredTokens reports the dirs to purge. --------------
async function testSessionEndOrphans() {
  // Single session: live token protects its dir; expired token reports it.
  const dirY = path.join(tmp, "sess-Y", ".brain");
  const t = Date.now();
  const tokY = issueToken("uY", dirY, { aud: "a" });
  assert.deepEqual(sweepExpiredTokens(t + 100), [], "live token: nothing orphaned");
  assert.ok(authenticate(`Bearer ${tokY}`), "live token still authenticates");
  assert.deepEqual(sweepExpiredTokens(t + TOKEN_TTL_MS + 1_000), [dirY], "expired token: dir reported for purge");
  assert.equal(authenticate(`Bearer ${tokY}`), null, "expired token no longer authenticates");

  // Reconnect: a surviving newer token for the SAME dir protects it from purge.
  const dirX = path.join(tmp, "sess-X", ".brain");
  const t0 = Date.now();
  const tokA = issueToken("uX", dirX, { aud: "a" });
  await sleep(30);
  const tokB = issueToken("uX", dirX, { aud: "a" }); // exp ≥ t0+30+TTL
  const now = t0 + TOKEN_TTL_MS + 10; // tokA expired (by ~10ms), tokB still live (by ~20ms)
  const orphaned = sweepExpiredTokens(now);
  assert.ok(!orphaned.includes(dirX), "reconnected dir NOT orphaned while a live token remains");
  assert.equal(authenticate(`Bearer ${tokA}`), null, "old token expired");
  assert.ok(authenticate(`Bearer ${tokB}`), "new token still live");
  assert.deepEqual(sweepExpiredTokens(t0 + 30 + TOKEN_TTL_MS + 1_000), [dirX], "after the last token expires, dir is orphaned");
  log("④ session-end: expired tokens report dirs to purge; a reconnected token protects its copy");
}

// ⑤ Recall still works after a purge mid-session (functionality intact). ----
async function testRecallSurvivesPurge() {
  const source = path.join(tmp, "e-source");
  seedSourceBrain(source);
  await execFileAsync(process.execPath, [RECALL_BIN, "--reindex"], { env: { ...process.env, BRAIN_DIR: source } });

  process.env.CONNECTOR_BRAIN_BASE = path.join(tmp, "e-users");
  process.env.CONNECTOR_STORE = "local";
  process.env.DEV_LOCAL_BRAIN = source;

  const userId = "brain_purgetest";
  const brainDir = resolveBrainDir(userId);

  const srv = createApp().listen(0);
  await new Promise((r) => srv.once("listening", r));
  const port = (srv.address() as import("node:net").AddressInfo).port;

  try {
    const token = issueToken(userId, brainDir, { aud: `http://localhost:${port}/mcp` });
    const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: "purge-test", version: "0.0.1" });
    await client.connect(transport);

    const r1: any = await client.callTool({ name: "brain_recall", arguments: { query: "postgres pooling", limit: 3 } });
    assert.equal(r1.structuredContent.results[0].id, "mem_src_1", "recall works before purge");

    // Simulate the reaper firing between tool calls.
    assert.ok(purgeBrain(brainDir), "working copy purged mid-session");
    assert.ok(!fs.existsSync(brainDir), "copy gone after purge");

    const r2: any = await client.callTool({ name: "brain_recall", arguments: { query: "postgres pooling", limit: 3 } });
    assert.equal(r2.structuredContent.results[0].id, "mem_src_1", "recall still works after purge (copy transparently re-provisioned)");
    assert.ok(fs.existsSync(brainDir), "working copy restored on next access");

    await client.close();
    log("⑤ recall intact: a mid-session purge is transparently recovered on the next call");
  } finally {
    srv.close();
    delete process.env.CONNECTOR_STORE;
    delete process.env.DEV_LOCAL_BRAIN;
    delete process.env.CONNECTOR_BRAIN_BASE;
  }
}

// ⑥ The reaper honors the disable switch. ----------------------------------
function testReaperToggle() {
  assert.equal(startBrainReaper({ idleMs: 0 }), null, "idleMs=0 disables the reaper");
  const timer = startBrainReaper({ idleMs: 60_000, intervalMs: 60_000 });
  assert.ok(timer, "a positive TTL starts the reaper");
  clearInterval(timer!);
  log("⑥ reaper toggle: disabled at idleMs=0, started for a positive TTL");
}

async function main() {
  testIdlePurge();
  testSymlinkSafe();
  await testRePullAfterPurge();
  await testSessionEndOrphans();
  await testRecallSurvivesPurge();
  testReaperToggle();
  console.log("\n✅ PURGE: idle + session-end reaping removes plaintext working copies, symlink-safe, recall stays intact.");
}

main()
  .catch((e) => { console.error("\n❌ purge test failed:", e); process.exit(1); })
  .finally(() => { globalThis.fetch = realFetch; fs.rmSync(tmp, { recursive: true, force: true }); });
