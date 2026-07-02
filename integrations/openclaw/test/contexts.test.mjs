import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import {
  MAX_CONTEXT_ENTRIES,
  appendContextEntry,
  appendContextEntryToFile,
  buildContextEntry,
  resolveBrainDir,
} from "../plugin/src/lib/contexts.mjs";

test("buildContextEntry matches the brain session-end schema", () => {
  const entry = buildContextEntry({
    sessionKey: "agent:main:main",
    started: "2026-07-02T09:00:00.000Z",
    ended: "2026-07-02T10:00:00.000Z",
    project: "openclaw",
    topics: ["fitness", "fitness", "travel"],
    memoriesCreated: ["mem-a"],
    memoriesRecalled: ["mem-b", "mem-b"],
  });
  assert.equal(entry.project, "openclaw");
  assert.equal(entry.started, "2026-07-02T09:00:00.000Z");
  assert.equal(entry.ended, "2026-07-02T10:00:00.000Z");
  assert.equal(entry.task_type, "conversation");
  assert.deepEqual(entry.topics, ["fitness", "travel"]); // deduped
  assert.deepEqual(entry.memories_created, ["mem-a"]);
  assert.deepEqual(entry.memories_recalled, ["mem-b"]);
  assert.deepEqual(entry.notable_unsaved, []);
  assert.match(entry.session_id, /^20260702100000-agent_main_main$/);
});

test("append to missing/empty file starts a fresh array", () => {
  const entry = { session_id: "s1" };
  const out = JSON.parse(appendContextEntry(null, entry));
  assert.deepEqual(out, [entry]);
  const out2 = JSON.parse(appendContextEntry("", entry));
  assert.deepEqual(out2, [entry]);
});

test("append keeps only the last 20 entries", () => {
  let content = null;
  for (let i = 0; i < MAX_CONTEXT_ENTRIES + 7; i++) {
    content = appendContextEntry(content, { session_id: `s${i}` });
  }
  const parsed = JSON.parse(content);
  assert.equal(parsed.length, MAX_CONTEXT_ENTRIES);
  assert.equal(parsed[0].session_id, "s7");
  assert.equal(parsed.at(-1).session_id, `s${MAX_CONTEXT_ENTRIES + 6}`);
});

test("malformed existing JSON recovers with a fresh array", () => {
  const out = JSON.parse(appendContextEntry("{oops", { session_id: "s1" }));
  assert.deepEqual(out, [{ session_id: "s1" }]);
});

test("wrapped {sessions: [...]} shape is preserved", () => {
  const existing = JSON.stringify({ version: 1, sessions: [{ session_id: "old" }] });
  const out = JSON.parse(appendContextEntry(existing, { session_id: "new" }));
  assert.equal(out.version, 1);
  assert.deepEqual(out.sessions.map((s) => s.session_id), ["old", "new"]);
});

test("appendContextEntryToFile writes atomically via a temp file", () => {
  const writes = [];
  const renames = [];
  const files = new Map([[path.join("/fake/.brain", "contexts.json"), JSON.stringify([{ session_id: "prev" }])]]);
  const fsImpl = {
    existsSync: (p) => p === "/fake/.brain",
    readFileSync: (p) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p);
    },
    writeFileSync: (p, data) => writes.push([p, data]),
    renameSync: (from, to) => renames.push([from, to]),
  };
  const result = appendContextEntryToFile({ session_id: "s2" }, { brainDir: "/fake/.brain", fsImpl });
  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  assert.ok(writes[0][0].includes("contexts.json.")); // temp file
  assert.deepEqual(JSON.parse(writes[0][1]).map((s) => s.session_id), ["prev", "s2"]);
  assert.deepEqual(renames[0][1], path.join("/fake/.brain", "contexts.json"));
});

test("appendContextEntryToFile skips silently when no brain dir exists", () => {
  const fsImpl = { existsSync: () => false };
  const result = appendContextEntryToFile({ session_id: "s" }, { brainDir: "/nope/.brain", fsImpl });
  assert.deepEqual(result, { ok: false, skipped: true });
});

test("resolveBrainDir honors BRAIN_DIR with ~ expansion", () => {
  assert.equal(resolveBrainDir({ BRAIN_DIR: "/custom/brain" }), path.resolve("/custom/brain"));
  assert.ok(resolveBrainDir({ BRAIN_DIR: "~/synced/brain" }).endsWith(path.join("synced", "brain")));
  assert.ok(resolveBrainDir({}).endsWith(".brain"));
});
