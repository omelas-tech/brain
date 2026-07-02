/**
 * event-hook session tracking against a temp fake home: one upserted entry
 * per session in ~/.brain/contexts.json, 20-entry trim, no-brain skip,
 * subagent exclusion, malformed-file recovery, wrapped-shape preservation.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import descriptor from "../plugin/brain-memory.js";

function makeFakeHome({ withBrain = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "brain-kilo-test-"));
  if (withBrain) fs.mkdirSync(path.join(home, ".brain"), { recursive: true });
  return home;
}

function readContexts(home) {
  return JSON.parse(fs.readFileSync(path.join(home, ".brain", "contexts.json"), "utf8"));
}

async function makeHooks(home, { clock } = {}) {
  return descriptor.server(
    { directory: "/home/u/code/my-proj", worktree: "/home/u/code/my-proj" },
    {
      env: {},
      homedir: home,
      warn: () => {},
      now: clock || (() => new Date("2026-07-02T10:00:00.000Z")),
    },
  );
}

const idle = (sessionID) => ({ event: { type: "session.idle", properties: { sessionID } } });

test("session.idle writes one schema-correct boundary entry", async (t) => {
  const home = makeFakeHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const hooks = await makeHooks(home);
  await hooks["event"](idle("ses-1"));

  const entries = readContexts(home);
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.ok(entry.session_id.endsWith("-ses-1"));
  assert.equal(entry.project, "my-proj");
  assert.equal(entry.ended, "2026-07-02T10:00:00.000Z");
  assert.equal(entry.started, entry.ended);
  assert.deepEqual(entry.topics, []);
  assert.deepEqual(entry.memories_created, []);
  assert.deepEqual(entry.memories_recalled, []);
  assert.deepEqual(entry.notable_unsaved, []);
  assert.equal(typeof entry.task_type, "string");
});

test("repeated idles upsert the same session entry (started kept, ended advances)", async (t) => {
  const home = makeFakeHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  let tick = 0;
  const times = ["2026-07-02T10:00:00.000Z", "2026-07-02T10:05:00.000Z", "2026-07-02T10:30:00.000Z"];
  const hooks = await makeHooks(home, { clock: () => new Date(times[Math.min(tick++, times.length - 1)]) });

  await hooks["event"](idle("ses-1"));
  await hooks["event"](idle("ses-1"));
  await hooks["event"](idle("ses-1"));

  const entries = readContexts(home);
  assert.equal(entries.length, 1, "one entry per session, not one per turn");
  assert.equal(entries[0].started, times[0]);
  assert.equal(entries[0].ended, times[2]);
});

test("keeps only the newest 20 session entries", async (t) => {
  const home = makeFakeHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const hooks = await makeHooks(home);
  for (let i = 0; i < 25; i += 1) {
    await hooks["event"](idle(`ses-${i}`));
  }
  const entries = readContexts(home);
  assert.equal(entries.length, 20);
  assert.ok(entries[0].session_id.endsWith("-ses-5"), "oldest trimmed");
  assert.ok(entries.at(-1).session_id.endsWith("-ses-24"));
});

test("session.deleted also records the boundary", async (t) => {
  const home = makeFakeHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const hooks = await makeHooks(home);
  await hooks["event"]({ event: { type: "session.deleted", properties: { info: { id: "ses-9" } } } });
  const entries = readContexts(home);
  assert.equal(entries.length, 1);
  assert.ok(entries[0].session_id.endsWith("-ses-9"));
});

test("subagent sessions (parentID) are not tracked", async (t) => {
  const home = makeFakeHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const hooks = await makeHooks(home);
  await hooks["event"]({
    event: { type: "session.idle", properties: { info: { id: "child-1", parentID: "ses-1" } } },
  });
  assert.ok(!fs.existsSync(path.join(home, ".brain", "contexts.json")));
});

test("no ~/.brain: skips silently and never creates the directory", async (t) => {
  const home = makeFakeHome({ withBrain: false });
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const hooks = await makeHooks(home);
  await hooks["event"](idle("ses-1"));
  assert.ok(!fs.existsSync(path.join(home, ".brain")));
});

test("malformed contexts.json: recovers to a valid array", async (t) => {
  const home = makeFakeHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(path.join(home, ".brain", "contexts.json"), "{corrupt!!", "utf8");

  const hooks = await makeHooks(home);
  await hooks["event"](idle("ses-1"));
  const entries = readContexts(home);
  assert.equal(entries.length, 1);
});

test("wrapped {sessions: []} shape is preserved", async (t) => {
  const home = makeFakeHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(home, ".brain", "contexts.json"),
    JSON.stringify({ schema: 2, sessions: [{ session_id: "old" }] }),
    "utf8",
  );

  const hooks = await makeHooks(home);
  await hooks["event"](idle("ses-1"));
  const parsed = readContexts(home);
  assert.equal(parsed.schema, 2);
  assert.equal(parsed.sessions.length, 2);
  assert.equal(parsed.sessions[0].session_id, "old");
});

test("BRAIN_DIR override is honored", async (t) => {
  const home = makeFakeHome({ withBrain: false });
  const brainDir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-kilo-dir-"));
  t.after(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(brainDir, { recursive: true, force: true });
  });

  const hooks = await descriptor.server(
    { worktree: "/home/u/code/my-proj" },
    { env: { BRAIN_DIR: brainDir }, homedir: home, warn: () => {}, now: () => new Date() },
  );
  await hooks["event"](idle("ses-1"));
  const entries = JSON.parse(fs.readFileSync(path.join(brainDir, "contexts.json"), "utf8"));
  assert.equal(entries.length, 1);
});
