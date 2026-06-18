// Sync-back freshness: a TTL re-pull brings in mid-session changes (e.g. a CLI
// `brain cloud push`) WITHOUT a re-auth — but it must stay "freshness, not
// correctness":
//   • within the TTL → no network at all;
//   • stale + cloud checksum UNCHANGED → a cheap list, but NO download;
//   • stale + cloud checksum CHANGED → re-download the new brain;
//   • an unsynced local write (failed sync-back) → the re-pull is SKIPPED so the
//     write is never clobbered; once it syncs, normal freshness resumes.
// We stub global.fetch for brain-cloud's list / download / sync(PUT) endpoints and
// count downloads to prove exactly when a pull happens.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureUserBrain, syncBack } from "../src/store.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bc-fresh-"));
process.env.BRAIN_CLOUD_API_URL = "http://cloud.test";
delete process.env.CONNECTOR_STORE;
delete process.env.DEV_LOCAL_BRAIN;

const realFetch = globalThis.fetch;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function brainTarGz(memoryCount: number): Promise<Buffer> {
  const tar = await import("tar");
  const src = fs.mkdtempSync(path.join(tmp, "src-"));
  fs.mkdirSync(path.join(src, "professional"), { recursive: true });
  fs.mkdirSync(path.join(src, "_archived"), { recursive: true });
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

// Mutable "cloud" state + call counters the stub reads/updates.
const cloud: { checksum: string; bundle: Buffer; putOk: boolean } = { checksum: "c1", bundle: Buffer.alloc(0), putOk: true };
const calls = { lists: 0, downloads: 0, puts: 0 };

function stub() {
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT" && /\/api\/brains\/[^/]+\/sync$/.test(u)) {
      calls.puts++;
      return cloud.putOk
        ? ({ ok: true, status: 200, json: async () => ({ checksum: cloud.checksum }) } as any)
        : ({ ok: false, status: 500, json: async () => ({}) } as any);
    }
    if (u.endsWith("/api/brains")) {
      calls.lists++;
      return { ok: true, status: 200, json: async () => [{ id: "b1", created_at: "2026-01-01T00:00:00.000Z", checksum: cloud.checksum }] } as any;
    }
    if (/\/api\/brains\/[^/]+\/sync$/.test(u)) {
      calls.downloads++;
      return { ok: true, status: 200, arrayBuffer: async () => cloud.bundle } as any;
    }
    throw new Error(`unexpected fetch ${method} ${u}`);
  }) as typeof fetch;
}

async function main() {
  const bundle1 = await brainTarGz(1);
  const bundle2 = await brainTarGz(2);
  cloud.bundle = bundle1;
  stub();

  const dir = path.join(tmp, "u-fresh", ".brain");
  const idToken = "tok";
  const ensure = (ttlMs?: number, refresh?: boolean) =>
    ensureUserBrain({ userId: "u-fresh", brainDir: dir, idToken, ttlMs, refresh });

  // 1. Login pull (refresh) → one download.
  let r = await ensure(undefined, true);
  assert.equal(calls.downloads, 1, "login pulls once");
  assert.equal(r.memoryCount, 1);
  console.log(`  ① login → download #${calls.downloads} (${r.memoryCount} memories)`);

  // 2. Within TTL → no network at all.
  const listsBefore = calls.lists, dlBefore = calls.downloads;
  await ensure(60_000);
  assert.equal(calls.lists, listsBefore, "within TTL: no list");
  assert.equal(calls.downloads, dlBefore, "within TTL: no download");
  console.log(`  ② within TTL → no network (lists=${calls.lists}, downloads=${calls.downloads})`);

  // 3. Stale, checksum UNCHANGED → cheap list, NO download.
  await sleep(5);
  const dl3 = calls.downloads, ls3 = calls.lists;
  await ensure(1);
  assert.equal(calls.downloads, dl3, "unchanged checksum: no download");
  assert.equal(calls.lists, ls3 + 1, "unchanged checksum: one cheap list");
  console.log(`  ③ stale + unchanged → list only (downloads still ${calls.downloads})`);

  // 4. Stale, checksum CHANGED → re-download the new brain.
  cloud.checksum = "c2"; cloud.bundle = bundle2;
  await sleep(5);
  r = await ensure(1);
  assert.equal(calls.downloads, dl3 + 1, "changed checksum: re-download");
  assert.equal(r.memoryCount, 2, "new brain pulled (2 memories)");
  console.log(`  ④ stale + changed → download #${calls.downloads} (${r.memoryCount} memories)`);

  // 5. Failed sync-back ⇒ dirty ⇒ stale re-pull is SKIPPED (no clobber).
  cloud.putOk = false;
  const fail = await syncBack({ brainDir: dir, brainId: "b1", idToken });
  assert.equal(fail.pushed, false, "sync-back failed");
  cloud.checksum = "c3"; // cloud moved on, but we have an unsynced local write
  await sleep(5);
  const dl5 = calls.downloads;
  r = await ensure(1);
  assert.equal(calls.downloads, dl5, "dirty: re-pull skipped — local write not clobbered");
  assert.equal(r.memoryCount, 2, "local copy preserved");
  console.log(`  ⑤ dirty (failed push) → re-pull skipped (downloads still ${calls.downloads})`);

  // 6. Successful sync-back clears dirty + records checksum ⇒ stale re-pull sees
  //    "unchanged" and downloads nothing.
  cloud.putOk = true; cloud.checksum = "c3";
  const ok = await syncBack({ brainDir: dir, brainId: "b1", idToken });
  assert.equal(ok.pushed, true, "sync-back succeeded");
  await sleep(5);
  const dl6 = calls.downloads;
  await ensure(1);
  assert.equal(calls.downloads, dl6, "after successful push, checksum matches → no re-download");
  console.log(`  ⑥ after push → freshness resumes, no redundant download (downloads ${calls.downloads})`);

  console.log("\n✅ FRESHNESS: TTL re-pull is cheap, change-aware, and never clobbers an unsynced write.");
}

main()
  .catch((e) => { console.error("\n❌ freshness test failed:", e); process.exit(1); })
  .finally(() => { globalThis.fetch = realFetch; fs.rmSync(tmp, { recursive: true, force: true }); });
