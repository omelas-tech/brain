/**
 * chat.message injection behavior with a mocked execFile: argv construction,
 * one-injection-per-session, subagent exclusion, synthetic part shape,
 * fail-soft on missing binary (warn once), timeout, bad JSON, and the
 * no-brain fast path. No kilo runtime and no real ~/.brain required.
 */

import assert from "node:assert/strict";
import test from "node:test";

import descriptor from "../plugin/brain-memory.js";

const AGGREGATOR_PAYLOAD = {
  memory_count: 12,
  pinned: [{ id: "mem-1", title: "Ship on main", content: "No PRs; commit directly to main." }],
  skills_index: [{ name: "release-flow", description: "How releases are cut" }],
  context_recall: [
    {
      id: "mem-2",
      title: "API pagination decision",
      path: "professional/projects/foo/api.md",
      type: "decision",
      score: 0.81,
    },
  ],
  due_for_review: 2,
  low_confidence_alerts: [],
  budget: { max_injection_tokens: 1200 },
};

function makeExecFileMock(respond) {
  const calls = [];
  const impl = (file, args, opts, callback) => {
    calls.push({ file, args, opts });
    process.nextTick(() => respond(callback, { file, args, opts }));
    return { stdin: { on() {}, write() {}, end() {} } };
  };
  return { calls, impl };
}

async function makeHooks({ respond, fsExists = true, env = {}, warnings = [] } = {}) {
  const mock = makeExecFileMock(respond || ((callback) => callback(null, JSON.stringify(AGGREGATOR_PAYLOAD), "")));
  const hooks = await descriptor.server(
    { directory: "/home/u/code/my-proj", worktree: "/home/u/code/my-proj" },
    {
      env,
      homedir: "/fake/home",
      fsImpl: { existsSync: () => fsExists },
      execFileImpl: mock.impl,
      warn: (message) => warnings.push(message),
    },
  );
  return { hooks, calls: mock.calls, warnings };
}

function chatOutput(sessionID, messageID = "msg-1") {
  return { message: { id: messageID, sessionID, role: "user" }, parts: [] };
}

test("first message of a session: runs the aggregator and appends a synthetic part", async () => {
  const warnings = [];
  const { hooks, calls } = await makeHooks({ warnings });
  const output = chatOutput("ses-1");

  await hooks["chat.message"]({ sessionID: "ses-1" }, output);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "brain");
  assert.deepEqual(calls[0].args, ["session-start", "--project", "my-proj"]);
  assert.equal(calls[0].opts.env.BRAIN_AGENT, "kilo");

  assert.equal(output.parts.length, 1);
  const part = output.parts[0];
  assert.equal(part.type, "text");
  assert.equal(part.synthetic, true);
  assert.equal(part.sessionID, "ses-1");
  assert.equal(part.messageID, "msg-1");
  assert.match(part.id, /^prt_/);
  assert.ok(part.text.includes("Ship on main"), "pinned fact injected");
  assert.ok(part.text.includes("API pagination decision"), "context recall injected");
  assert.ok(part.text.includes("12 memories"), "status line present");
  assert.ok(part.text.includes("due for review"), "review alert present");
  assert.deepEqual(warnings, []);
});

test("second message of the same session: no re-injection, no spawn", async () => {
  const { hooks, calls } = await makeHooks({});
  await hooks["chat.message"]({ sessionID: "ses-1" }, chatOutput("ses-1"));
  const second = chatOutput("ses-1", "msg-2");
  await hooks["chat.message"]({ sessionID: "ses-1" }, second);
  assert.equal(calls.length, 1, "aggregator ran once");
  assert.equal(second.parts.length, 0);
});

test("a new session on the same plugin instance injects again", async () => {
  const { hooks, calls } = await makeHooks({});
  await hooks["chat.message"]({ sessionID: "ses-1" }, chatOutput("ses-1"));
  const other = chatOutput("ses-2");
  await hooks["chat.message"]({ sessionID: "ses-2" }, other);
  assert.equal(calls.length, 2);
  assert.equal(other.parts.length, 1);
});

test("subagent sessions announced via session.created are never injected", async () => {
  const { hooks, calls } = await makeHooks({});
  await hooks["event"]({
    event: { type: "session.created", properties: { info: { id: "child-1", parentID: "ses-1" } } },
  });
  const output = chatOutput("child-1");
  await hooks["chat.message"]({ sessionID: "child-1" }, output);
  assert.equal(calls.length, 0);
  assert.equal(output.parts.length, 0);
});

test("sessionID can come from output.message when the input lacks it", async () => {
  const { hooks } = await makeHooks({});
  const output = chatOutput("ses-9");
  await hooks["chat.message"]({}, output);
  assert.equal(output.parts.length, 1);
});

test("no ~/.brain/index.json: returns without spawning", async () => {
  const { hooks, calls } = await makeHooks({ fsExists: false });
  const output = chatOutput("ses-1");
  await hooks["chat.message"]({ sessionID: "ses-1" }, output);
  assert.equal(calls.length, 0);
  assert.equal(output.parts.length, 0);
});

test("missing brain binary: fail-soft, exactly one warning per plugin instance", async () => {
  const warnings = [];
  const { hooks } = await makeHooks({
    warnings,
    respond: (callback) => {
      const error = new Error("spawn brain ENOENT");
      error.code = "ENOENT";
      callback(error, "", "");
    },
  });
  const first = chatOutput("ses-1");
  const second = chatOutput("ses-2");
  await hooks["chat.message"]({ sessionID: "ses-1" }, first);
  await hooks["chat.message"]({ sessionID: "ses-2" }, second);
  assert.equal(first.parts.length, 0);
  assert.equal(second.parts.length, 0);
  assert.equal(warnings.length, 1, "warned exactly once");
  assert.match(warnings[0], /npm install -g brain-memory/);
});

test("timeout: fail-soft with a timeout warning", async () => {
  const warnings = [];
  const { hooks } = await makeHooks({
    warnings,
    respond: (callback) => {
      const error = new Error("killed");
      error.killed = true;
      error.signal = "SIGTERM";
      callback(error, "", "");
    },
  });
  const output = chatOutput("ses-1");
  await hooks["chat.message"]({ sessionID: "ses-1" }, output);
  assert.equal(output.parts.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /timeout/);
});

test("non-JSON aggregator output: fail-soft, no part", async () => {
  const { hooks } = await makeHooks({ respond: (callback) => callback(null, "not json", "") });
  const output = chatOutput("ses-1");
  await hooks["chat.message"]({ sessionID: "ses-1" }, output);
  assert.equal(output.parts.length, 0);
});

test("empty aggregator payload: nothing worth injecting", async () => {
  const empty = { memory_count: 0, pinned: [], skills_index: [], context_recall: [] };
  const { hooks } = await makeHooks({ respond: (callback) => callback(null, JSON.stringify(empty), "") });
  const output = chatOutput("ses-1");
  await hooks["chat.message"]({ sessionID: "ses-1" }, output);
  assert.equal(output.parts.length, 0);
});

test("BRAIN_BIN and explicit BRAIN_AGENT are honored", async () => {
  const { hooks, calls } = await makeHooks({
    env: { BRAIN_BIN: "/opt/brain/bin/brain", BRAIN_AGENT: "kilo-custom" },
  });
  await hooks["chat.message"]({ sessionID: "ses-1" }, chatOutput("ses-1"));
  assert.equal(calls[0].file, "/opt/brain/bin/brain");
  assert.equal(calls[0].opts.env.BRAIN_AGENT, "kilo-custom");
});

test("hook never throws on malformed hook payloads", async () => {
  const { hooks } = await makeHooks({});
  await hooks["chat.message"](null, null);
  await hooks["chat.message"](undefined, { message: null, parts: null });
  await hooks["event"]({});
  await hooks["event"]({ event: { type: 42 } });
});
