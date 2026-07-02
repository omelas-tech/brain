/**
 * sessionEnd hook behavior against a temp fake home: contexts.json append
 * and 20-entry trim, no-brain skip (never creates ~/.brain), malformed-file
 * tolerance, and wrapped {sessions: []} shape preservation.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { MAX_CONTEXT_ENTRIES } from "../plugin/hooks/lib/contexts.mjs";
import { handleSessionEnd } from "../plugin/hooks/session-end.mjs";

function makeFakeHome({ withBrain = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "brain-copilot-test-"));
  if (withBrain) fs.mkdirSync(path.join(home, ".brain"), { recursive: true });
  return home;
}

function readContexts(home) {
  return JSON.parse(fs.readFileSync(path.join(home, ".brain", "contexts.json"), "utf8"));
}

const HOOK_INPUT = {
  sessionId: "sess-42",
  timestamp: 1751400000000,
  cwd: "/home/u/code/my-proj",
  reason: "user_exit",
};

test("appends a session-boundary entry matching the contexts schema", (t) => {
  const home = makeFakeHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const output = handleSessionEnd(HOOK_INPUT, { env: {}, homedir: home, warn: () => {} });
  assert.deepEqual(output, {}, "sessionEnd output is always the empty decision object");

  const entries = readContexts(home);
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.ok(entry.session_id.endsWith("-sess-42"));
  assert.equal(entry.ended, new Date(HOOK_INPUT.timestamp).toISOString());
  assert.equal(entry.project, "my-proj");
  assert.deepEqual(entry.topics, []);
  assert.deepEqual(entry.memories_created, []);
  assert.deepEqual(entry.memories_recalled, []);
  assert.deepEqual(entry.notable_unsaved, []);
  assert.equal(typeof entry.task_type, "string");
});

test("keeps only the newest 20 entries", (t) => {
  const home = makeFakeHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  for (let i = 0; i < MAX_CONTEXT_ENTRIES + 5; i += 1) {
    handleSessionEnd(
      { ...HOOK_INPUT, sessionId: `sess-${i}`, timestamp: HOOK_INPUT.timestamp + i * 1000 },
      { env: {}, homedir: home, warn: () => {} },
    );
  }
  const entries = readContexts(home);
  assert.equal(entries.length, MAX_CONTEXT_ENTRIES);
  assert.ok(entries[0].session_id.endsWith("-sess-5"), "oldest entries trimmed");
  assert.ok(entries.at(-1).session_id.endsWith(`-sess-${MAX_CONTEXT_ENTRIES + 4}`));
});

test("no ~/.brain: skips silently and never creates the directory", (t) => {
  const home = makeFakeHome({ withBrain: false });
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const warnings = [];
  const output = handleSessionEnd(HOOK_INPUT, {
    env: {},
    homedir: home,
    warn: (message) => warnings.push(message),
  });
  assert.deepEqual(output, {});
  assert.ok(!fs.existsSync(path.join(home, ".brain")), "does not create ~/.brain");
  assert.deepEqual(warnings, [], "a skipped save is not an error");
});

test("malformed contexts.json: recovers to a valid array with the new entry", (t) => {
  const home = makeFakeHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(path.join(home, ".brain", "contexts.json"), "{corrupt!!", "utf8");

  handleSessionEnd(HOOK_INPUT, { env: {}, homedir: home, warn: () => {} });
  const entries = readContexts(home);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].project, "my-proj");
});

test("wrapped {sessions: []} shape is preserved", (t) => {
  const home = makeFakeHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(home, ".brain", "contexts.json"),
    JSON.stringify({ schema: 2, sessions: [{ session_id: "old" }] }),
    "utf8",
  );

  handleSessionEnd(HOOK_INPUT, { env: {}, homedir: home, warn: () => {} });
  const parsed = readContexts(home);
  assert.equal(parsed.schema, 2, "wrapper fields preserved");
  assert.equal(parsed.sessions.length, 2);
  assert.equal(parsed.sessions[0].session_id, "old");
});

test("BRAIN_DIR override is honored", (t) => {
  const home = makeFakeHome({ withBrain: false });
  const brainDir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-copilot-dir-"));
  t.after(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(brainDir, { recursive: true, force: true });
  });

  handleSessionEnd(HOOK_INPUT, { env: { BRAIN_DIR: brainDir }, homedir: home, warn: () => {} });
  const entries = JSON.parse(fs.readFileSync(path.join(brainDir, "contexts.json"), "utf8"));
  assert.equal(entries.length, 1);
});

test("missing timestamp falls back to the injected clock", (t) => {
  const home = makeFakeHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const now = new Date("2026-07-02T10:00:00.000Z");

  handleSessionEnd({ sessionId: "s", cwd: "/x/proj" }, { env: {}, homedir: home, now, warn: () => {} });
  const [entry] = readContexts(home);
  assert.equal(entry.ended, now.toISOString());
  assert.equal(entry.started, now.toISOString());
});
