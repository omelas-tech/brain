// Identity hygiene: the connector serves the brain of whichever Google account
// signs in (one canonical account). ensureUserBrain must surface that mapping so a
// wrong-account sign-in is caught instead of silently starting a phantom brain:
//   • an account with NO cloud brain → identity "no-cloud-brain" + a safe empty-init
//   • an account with ONE brain      → identity "ok"
//   • a (pro) account with SEVERAL   → identity "multiple-brains", serving the
//                                      canonical (oldest) brain, deterministically.
// We stub global.fetch to stand in for brain-cloud's GET /api/brains (+ /sync).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureUserBrain } from "../src/store.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bc-identity-"));
process.env.BRAIN_CLOUD_API_URL = "http://cloud.test";
// Keep provider inference on "brain-cloud": no local override may leak in.
delete process.env.CONNECTOR_STORE;
delete process.env.DEV_LOCAL_BRAIN;

const realFetch = globalThis.fetch;

/** Build a gzip tar buffer of a one-memory brain (entries rooted at ".", as the CLI packs). */
async function seededBrainTarGz(): Promise<Buffer> {
  const tar = await import("tar");
  const src = fs.mkdtempSync(path.join(tmp, "src-"));
  fs.mkdirSync(path.join(src, "professional"), { recursive: true });
  fs.mkdirSync(path.join(src, "_archived"), { recursive: true });
  fs.writeFileSync(path.join(src, "index.json"), JSON.stringify({
    version: 2, created: "2026-01-01T00:00:00.000Z", last_updated: "2026-06-01T00:00:00.000Z",
    memory_count: 1,
    memories: { mem_id_1: { path: "professional/x.md", title: "X", type: "decision", cognitive_type: "semantic", strength: 0.8, decay_rate: 0.995, salience: 0.5, confidence: 0.9, last_accessed: "2026-06-01T00:00:00.000Z", access_count: 1, tags: ["x"], related: [], encoding_context: { project: "p", topics: ["x"], task_type: "deciding" } } },
    config: { max_depth: 6, consolidation_threshold: 0.3, association_config: { spreading_activation_depth: 2, spreading_activation_decay: 0.5 } },
  }));
  fs.writeFileSync(path.join(src, "professional", "x.md"), "---\nid: mem_id_1\n---\n# X\nbody\n");
  fs.writeFileSync(path.join(src, "associations.json"), '{"version":1,"edges":{}}');
  const file = path.join(tmp, "bundle.tar.gz");
  await tar.c({ gzip: true, file, cwd: src, portable: true }, ["."]);
  return fs.readFileSync(file);
}

/** Stub fetch: GET /api/brains → `brains`; GET /api/brains/{id}/sync → the bundle. */
function stubCloud(brains: Array<{ id: string; created_at?: string; checksum?: string }>, bundle?: Buffer) {
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.endsWith("/api/brains")) {
      return { ok: true, status: 200, json: async () => brains } as any;
    }
    if (/\/api\/brains\/[^/]+\/sync$/.test(u)) {
      return { ok: true, status: 200, arrayBuffer: async () => (bundle ?? Buffer.alloc(0)) } as any;
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof fetch;
}

async function main() {
  // 1. No cloud brain for this account → "no-cloud-brain" + a safe empty brain.
  {
    stubCloud([]);
    const dir = path.join(tmp, "u-empty", ".brain");
    const r = await ensureUserBrain({ userId: "u-empty", brainDir: dir, idToken: "tok", refresh: true });
    assert.equal(r.identity?.status, "no-cloud-brain", "empty account → no-cloud-brain");
    assert.equal(r.identity?.brainCount, 0);
    assert.ok(r.identity?.note && /different Google account/i.test(r.identity.note), "note guides toward the right account");
    assert.ok(fs.existsSync(path.join(dir, "index.json")), "still empty-inits a usable brain");
    console.log(`  ① no brain → identity=${r.identity?.status} (empty-init, ${r.memoryCount} memories)`);
  }

  // 2. Exactly one brain → "ok", pulled and populated.
  {
    const bundle = await seededBrainTarGz();
    stubCloud([{ id: "b-only", created_at: "2026-01-01T00:00:00.000Z", checksum: "c1" }], bundle);
    const dir = path.join(tmp, "u-one", ".brain");
    const r = await ensureUserBrain({ userId: "u-one", brainDir: dir, idToken: "tok", refresh: true });
    assert.equal(r.identity?.status, "ok", "single brain → ok");
    assert.equal(r.brainId, "b-only");
    assert.equal(r.memoryCount, 1, "pulled the brain's memory");
    console.log(`  ② one brain → identity=${r.identity?.status} brainId=${r.brainId} (${r.memoryCount} memories)`);
  }

  // 3. Several brains → "multiple-brains", serving the canonical (OLDEST) one.
  {
    const bundle = await seededBrainTarGz();
    stubCloud([
      { id: "b-newer", created_at: "2026-05-01T00:00:00.000Z" },
      { id: "b-oldest", created_at: "2026-01-01T00:00:00.000Z" },
    ], bundle);
    const dir = path.join(tmp, "u-multi", ".brain");
    const r = await ensureUserBrain({ userId: "u-multi", brainDir: dir, idToken: "tok", refresh: true });
    assert.equal(r.identity?.status, "multiple-brains", "several brains → multiple-brains");
    assert.equal(r.identity?.brainCount, 2);
    assert.equal(r.brainId, "b-oldest", "canonical pick is the OLDEST brain, deterministically");
    console.log(`  ③ multi brain → identity=${r.identity?.status} canonical=${r.brainId} (count ${r.identity?.brainCount})`);
  }

  console.log("\n✅ IDENTITY: one-canonical-account mapping is surfaced (no/one/many brains) and deterministic.");
}

main()
  .catch((e) => { console.error("\n❌ identity test failed:", e); process.exit(1); })
  .finally(() => { globalThis.fetch = realFetch; fs.rmSync(tmp, { recursive: true, force: true }); });
