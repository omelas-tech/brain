// Choosing among several Brain Cloud brains (brain_use).
//   • no choice → the account's oldest brain, as before;
//   • a choice → that brain, and the previous brain's working copy is dropped
//     first, so nothing of it is shown or pushed into the chosen one;
//   • sync-back goes to the brain the copy was pulled from, even when the
//     session token still names the previous brain;
//   • a choice whose brain was deleted falls back to the oldest;
//   • the choice survives a restart (persisted with the OAuth state).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureUserBrain, syncBack, matchBrain, servedBrain, pulledBrainId } from "../src/store.js";
import { initOAuthState, getBrainChoice, setBrainChoice } from "../src/persist.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bc-choice-"));
process.env.BRAIN_CLOUD_API_URL = "http://cloud.test";
delete process.env.CONNECTOR_STORE;
delete process.env.DEV_LOCAL_BRAIN;
const realFetch = globalThis.fetch;

async function brainTarGz(memoryCount: number): Promise<Buffer> {
  const tar = await import("tar");
  const src = fs.mkdtempSync(path.join(tmp, "src-"));
  fs.mkdirSync(path.join(src, "professional"), { recursive: true });
  const memories: Record<string, unknown> = {};
  for (let i = 1; i <= memoryCount; i++) {
    memories[`mem_${i}`] = { path: `professional/m${i}.md`, title: `M${i}`, type: "learning" };
    fs.writeFileSync(path.join(src, "professional", `m${i}.md`), `---\nid: mem_${i}\n---\n# M${i}\n`);
  }
  fs.writeFileSync(path.join(src, "index.json"), JSON.stringify({ version: 2, memory_count: memoryCount, memories }));
  const file = path.join(tmp, `bundle-${memoryCount}.tar.gz`);
  await tar.c({ gzip: true, file, cwd: src, portable: true }, ["."]);
  return fs.readFileSync(file);
}

// Two brains: "default" (oldest, has an archive) and "Studia" (never pushed).
let brains = [
  { id: "b1", name: "default", created_at: "2026-09-30T00:00:00.000Z", checksum: "c1" as string | null },
  { id: "b2", name: "Studia", created_at: "2026-10-11T00:00:00.000Z", checksum: null as string | null },
];
const puts: { url: string; headers: Record<string, string> }[] = [];

function stub(bundle: Buffer) {
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    const m = u.match(/\/api\/brains\/([^/]+)\/sync$/);
    if (method === "PUT" && m) {
      puts.push({ url: u, headers: init.headers });
      return { ok: true, status: 200, json: async () => ({ checksum: "c-new" }) } as any;
    }
    if (u.endsWith("/api/brains")) return { ok: true, status: 200, json: async () => brains } as any;
    if (m) {
      const b = brains.find((x) => x.id === m[1]);
      if (!b?.checksum) return { ok: false, status: 404 } as any;
      return { ok: true, status: 200, arrayBuffer: async () => bundle } as any;
    }
    throw new Error(`unexpected fetch ${method} ${u}`);
  }) as typeof fetch;
}

const count = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf-8")).memory_count;

async function main() {
  stub(await brainTarGz(3));
  initOAuthState({ dir: path.join(tmp, "state"), key: "a".repeat(64) });
  const userId = "brain_choice_user";
  const dir = path.join(tmp, userId, ".brain");

  // ① no choice → the oldest brain
  let r = await ensureUserBrain({ userId, brainDir: dir, idToken: "tok", refresh: true });
  assert.equal(r.brainId, "b1");
  assert.equal(count(dir), 3);
  assert.equal(r.identity?.status, "multiple-brains");
  assert.match(r.identity?.note ?? "", /using "default"/);
  console.log("  ① no choice → oldest brain (3 memories)");

  // ② choose the empty brain → the old copy is dropped, not carried over
  setBrainChoice(userId, "b2");
  r = await ensureUserBrain({ userId, brainDir: dir, idToken: "tok", refresh: true });
  assert.equal(r.brainId, "b2");
  assert.equal(pulledBrainId(dir), "b2");
  assert.equal(count(dir), 0);
  console.log("  ② choice → that brain, previous copy dropped (0 memories)");

  // ③ a write syncs to the pulled brain, not the stale session brain, and only
  //    into an empty archive
  const res = await syncBack({ brainDir: dir, brainId: "b1", idToken: "tok" });
  assert.equal(res.pushed, true);
  assert.match(puts.at(-1)!.url, /\/api\/brains\/b2\/sync$/);
  assert.equal(puts.at(-1)!.headers["If-None-Match"], "*");
  console.log("  ③ sync-back targets the pulled brain (b2), If-None-Match: *");

  // ④ the choice survives a restart
  initOAuthState({ dir: path.join(tmp, "state"), key: "a".repeat(64) });
  assert.equal(getBrainChoice(userId), "b2");
  console.log("  ④ choice persisted across a restart");

  // ⑤ the chosen brain is deleted → back to the oldest
  brains = brains.filter((b) => b.id !== "b2");
  r = await ensureUserBrain({ userId, brainDir: dir, idToken: "tok", refresh: true });
  assert.equal(r.brainId, "b1");
  assert.equal(count(dir), 3);
  assert.equal(servedBrain(brains, "gone").id, "b1");
  console.log("  ⑤ deleted choice → falls back to the oldest");

  // ⑥ names match ignoring case; a shared name needs the id
  const named = [{ id: "x", name: "Notes" }, { id: "y", name: "STUDIA МИРА" }];
  assert.equal(matchBrain(named, "studia мира")?.id, "y");
  assert.equal(matchBrain(named, "x")?.id, "x");
  assert.equal(matchBrain(named, "other"), null);
  assert.throws(() => matchBrain([...named, { id: "z", name: "notes" }], "NOTES"), /2 brains are named/);
  console.log("  ⑥ name matching: case-insensitive, ambiguity refused");

  console.log("\n✅ BRAIN CHOICE: oldest by default, chosen brain served and synced, choice persisted.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => {
    globalThis.fetch = realFetch;
    fs.rmSync(tmp, { recursive: true, force: true });
  });
