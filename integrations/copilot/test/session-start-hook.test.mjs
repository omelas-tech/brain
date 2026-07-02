/**
 * sessionStart hook behavior with a mocked execFile: payload construction,
 * additionalContext output shape, fail-soft on missing binary (warn once),
 * timeout handling, and the no-brain fast path. No copilot binary and no
 * real ~/.brain required.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { resetUnavailableWarnings } from "../plugin/hooks/lib/brain-exec.mjs";
import {
  handleSessionStart,
  parseHookInput,
  projectFromInput,
} from "../plugin/hooks/session-start.mjs";

/** Build an execFile mock that records calls and replies per `respond`. */
function makeExecFileMock(respond) {
  const calls = [];
  const impl = (file, args, opts, callback) => {
    calls.push({ file, args, opts });
    process.nextTick(() => respond(callback, { file, args, opts }));
    return { stdin: { on() {}, write() {}, end() {} } };
  };
  return { calls, impl };
}

const AGGREGATOR_PAYLOAD = {
  memory_count: 12,
  pinned: [{ id: "mem-1", title: "Ship on main", content: "No PRs; commit directly to main." }],
  skills_index: [{ name: "release-flow", description: "How releases are cut" }],
  context_recall: [
    { id: "mem-2", title: "API pagination decision", path: "professional/projects/foo/api.md", type: "decision", score: 0.81 },
  ],
  due_for_review: 2,
  low_confidence_alerts: [],
  budget: { max_injection_tokens: 1200 },
};

const FAKE_FS_WITH_BRAIN = { existsSync: () => true };
const HOOK_INPUT = { sessionId: "s-123", timestamp: 1751400000000, cwd: "/home/u/code/my-proj", source: "startup" };

test("happy path: runs the aggregator and emits additionalContext", async () => {
  resetUnavailableWarnings();
  const { calls, impl } = makeExecFileMock((callback) =>
    callback(null, JSON.stringify(AGGREGATOR_PAYLOAD), ""),
  );
  const warnings = [];
  const output = await handleSessionStart(HOOK_INPUT, {
    env: { BRAIN_AGENT: undefined },
    homedir: "/fake/home",
    fsImpl: FAKE_FS_WITH_BRAIN,
    execFileImpl: impl,
    warn: (message) => warnings.push(message),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "brain");
  assert.deepEqual(calls[0].args, ["session-start", "--project", "my-proj"]);
  assert.equal(calls[0].opts.env.BRAIN_AGENT, "copilot-cli");
  assert.equal(typeof calls[0].opts.timeout, "number");

  assert.equal(typeof output.additionalContext, "string");
  assert.ok(output.additionalContext.includes("Ship on main"), "pinned fact injected");
  assert.ok(output.additionalContext.includes("API pagination decision"), "context recall injected");
  assert.ok(output.additionalContext.includes("12 memories"), "status line present");
  assert.ok(output.additionalContext.includes("due for review"), "review alert present");
  assert.deepEqual(warnings, []);
});

test("BRAIN_BIN overrides the binary; explicit BRAIN_AGENT wins", async () => {
  resetUnavailableWarnings();
  const { calls, impl } = makeExecFileMock((callback) =>
    callback(null, JSON.stringify(AGGREGATOR_PAYLOAD), ""),
  );
  await handleSessionStart(HOOK_INPUT, {
    env: { BRAIN_BIN: "/opt/brain/bin/brain", BRAIN_AGENT: "copilot-custom" },
    homedir: "/fake/home",
    fsImpl: FAKE_FS_WITH_BRAIN,
    execFileImpl: impl,
    warn: () => {},
  });
  assert.equal(calls[0].file, "/opt/brain/bin/brain");
  assert.equal(calls[0].opts.env.BRAIN_AGENT, "copilot-custom");
});

test("no ~/.brain/index.json: returns {} without spawning anything", async () => {
  resetUnavailableWarnings();
  const { calls, impl } = makeExecFileMock((callback) => callback(null, "{}", ""));
  const checked = [];
  const output = await handleSessionStart(HOOK_INPUT, {
    env: { BRAIN_AGENT: undefined },
    homedir: "/fake/home",
    fsImpl: {
      existsSync: (p) => {
        checked.push(p);
        return false;
      },
    },
    execFileImpl: impl,
    warn: () => {},
  });
  assert.deepEqual(output, {});
  assert.equal(calls.length, 0, "brain CLI never spawned");
  assert.ok(checked.some((p) => p.replaceAll("\\", "/").endsWith("/fake/home/.brain/index.json")));
});

test("missing brain binary: fail-soft {} and exactly one warning", async () => {
  resetUnavailableWarnings();
  const { impl } = makeExecFileMock((callback) => {
    const error = new Error("spawn brain ENOENT");
    error.code = "ENOENT";
    callback(error, "", "");
  });
  const warnings = [];
  const options = {
    env: { BRAIN_AGENT: undefined },
    homedir: "/fake/home",
    fsImpl: FAKE_FS_WITH_BRAIN,
    execFileImpl: impl,
    warn: (message) => warnings.push(message),
  };

  const first = await handleSessionStart(HOOK_INPUT, options);
  const second = await handleSessionStart(HOOK_INPUT, options);
  assert.deepEqual(first, {});
  assert.deepEqual(second, {});
  assert.equal(warnings.length, 1, "warned exactly once per process");
  assert.match(warnings[0], /npm install -g brain-memory/);
});

test("timeout: fail-soft {} with a timeout warning", async () => {
  resetUnavailableWarnings();
  const { impl } = makeExecFileMock((callback) => {
    const error = new Error("killed");
    error.killed = true;
    error.signal = "SIGTERM";
    callback(error, "", "");
  });
  const warnings = [];
  const output = await handleSessionStart(HOOK_INPUT, {
    env: { BRAIN_AGENT: undefined },
    homedir: "/fake/home",
    fsImpl: FAKE_FS_WITH_BRAIN,
    execFileImpl: impl,
    warn: (message) => warnings.push(message),
  });
  assert.deepEqual(output, {});
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /timeout/);
});

test("non-JSON aggregator output: fail-soft {}", async () => {
  resetUnavailableWarnings();
  const { impl } = makeExecFileMock((callback) => callback(null, "not json at all", ""));
  const output = await handleSessionStart(HOOK_INPUT, {
    env: { BRAIN_AGENT: undefined },
    homedir: "/fake/home",
    fsImpl: FAKE_FS_WITH_BRAIN,
    execFileImpl: impl,
    warn: () => {},
  });
  assert.deepEqual(output, {});
});

test("empty aggregator payload: returns {} (nothing worth injecting)", async () => {
  resetUnavailableWarnings();
  const empty = { memory_count: 0, pinned: [], skills_index: [], context_recall: [] };
  const { impl } = makeExecFileMock((callback) => callback(null, JSON.stringify(empty), ""));
  const output = await handleSessionStart(HOOK_INPUT, {
    env: { BRAIN_AGENT: undefined },
    homedir: "/fake/home",
    fsImpl: FAKE_FS_WITH_BRAIN,
    execFileImpl: impl,
    warn: () => {},
  });
  assert.deepEqual(output, {});
});

test("thrown execFile (sync failure): fail-soft {}", async () => {
  resetUnavailableWarnings();
  const output = await handleSessionStart(HOOK_INPUT, {
    env: { BRAIN_AGENT: undefined },
    homedir: "/fake/home",
    fsImpl: FAKE_FS_WITH_BRAIN,
    execFileImpl: () => {
      throw new Error("boom");
    },
    warn: () => {},
  });
  assert.deepEqual(output, {});
});

test("projectFromInput derives the project from the payload cwd", () => {
  assert.equal(projectFromInput({ cwd: "/home/u/code/my-proj" }), "my-proj");
  assert.equal(projectFromInput({ cwd: "/home/u/code/my-proj/" }), "my-proj");
  assert.equal(projectFromInput({ cwd: "" }, "/fallback/other-proj"), "other-proj");
  assert.equal(projectFromInput(null, "/fallback/other-proj"), "other-proj");
});

test("parseHookInput tolerates empty and malformed stdin", () => {
  assert.deepEqual(parseHookInput(""), {});
  assert.deepEqual(parseHookInput("   "), {});
  assert.deepEqual(parseHookInput("{broken"), {});
  assert.deepEqual(parseHookInput('{"cwd":"/x"}'), { cwd: "/x" });
});
