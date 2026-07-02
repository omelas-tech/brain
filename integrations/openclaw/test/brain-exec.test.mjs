import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import {
  detectAgent,
  resetUnavailableWarnings,
  runBrain,
  runMemorize,
  runRecall,
  runReinforce,
  runSessionStart,
  shouldWarnUnavailable,
} from "../plugin/src/lib/brain-exec.mjs";

/** Build a fake execFile implementation. */
function fakeExecFile({ error = null, stdout = "", stderr = "" } = {}, capture = {}) {
  return (bin, args, options, callback) => {
    capture.bin = bin;
    capture.args = args;
    capture.options = options;
    const stdinChunks = [];
    queueMicrotask(() => callback(error, stdout, stderr));
    return {
      stdin: {
        on: () => {},
        write: (chunk) => stdinChunks.push(String(chunk)),
        end: () => {
          capture.stdin = stdinChunks.join("");
        },
      },
    };
  };
}

beforeEach(() => resetUnavailableWarnings());

test("missing binary degrades gracefully (injected ENOENT)", async () => {
  const error = Object.assign(new Error("spawn brain ENOENT"), { code: "ENOENT" });
  const result = await runBrain(["session-start"], { execFileImpl: fakeExecFile({ error }) });
  assert.equal(result.ok, false);
  assert.equal(result.code, "unavailable");
  assert.match(result.error, /npm install -g brain-memory/);
});

test("missing binary degrades gracefully (real spawn of nonexistent bin)", async () => {
  const result = await runSessionStart({
    project: "openclaw",
    bin: "definitely-not-a-real-brain-binary-xyz",
    timeoutMs: 5000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "unavailable");
});

test("warn-once registry fires exactly once per binary", () => {
  assert.equal(shouldWarnUnavailable("brain"), true);
  assert.equal(shouldWarnUnavailable("brain"), false);
  assert.equal(shouldWarnUnavailable("/opt/brain"), true);
});

test("successful JSON call parses stdout", async () => {
  const capture = {};
  const result = await runBrain(["recall", "q"], {
    execFileImpl: fakeExecFile({ stdout: '[{"id":"mem-1"}]' }, capture),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, [{ id: "mem-1" }]);
  assert.equal(capture.bin, "brain");
});

test("non-JSON stdout reports bad-json without throwing", async () => {
  const result = await runBrain(["recall", "q"], {
    execFileImpl: fakeExecFile({ stdout: "garbage" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "bad-json");
});

test("timeouts are reported as timeout", async () => {
  const error = Object.assign(new Error("killed"), { killed: true, signal: "SIGTERM" });
  const result = await runBrain(["sleep"], { execFileImpl: fakeExecFile({ error }) });
  assert.equal(result.ok, false);
  assert.equal(result.code, "timeout");
});

test("recall builds the documented argv (no shell interpolation)", async () => {
  const capture = {};
  await runRecall({
    query: 'what about "quotes" and $HOME; rm -rf /',
    project: "openclaw",
    task: "conversation",
    top: 6,
    execFileImpl: fakeExecFile({ stdout: "[]" }, capture),
  });
  assert.deepEqual(capture.args, [
    "recall",
    'what about "quotes" and $HOME; rm -rf /',
    "--project",
    "openclaw",
    "--task",
    "conversation",
    "--top",
    "6",
  ]);
  assert.equal(capture.options.timeout, 15000);
});

test("memorize pipes the JSON payload via stdin and honors --sync", async () => {
  const capture = {};
  const payload = { memories: [{ title: "t", type: "learning", path: "a/b.md", content: "c" }] };
  const result = await runMemorize({
    payload,
    sync: true,
    execFileImpl: fakeExecFile({ stdout: '{"stored":[{"id":"mem-9"}]}' }, capture),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(capture.args, ["memorize", "--sync"]);
  assert.deepEqual(JSON.parse(capture.stdin), payload);
});

test("reinforce no-ops on empty ids and filters junk", async () => {
  const result = await runReinforce({ ids: [] });
  assert.equal(result.ok, true);
  const capture = {};
  await runReinforce({ ids: ["mem-1", "", "mem-2"], execFileImpl: fakeExecFile({ stdout: "{}" }, capture) });
  assert.deepEqual(capture.args, ["reinforce", "mem-1", "mem-2"]);
});

test("BRAIN_AGENT is set for the child (openclaw / nemoclaw / explicit)", async () => {
  const capture = {};
  await runBrain(["x"], { execFileImpl: fakeExecFile({ stdout: "{}" }, capture) });
  assert.ok(["openclaw", "nemoclaw", process.env.BRAIN_AGENT].includes(capture.options.env.BRAIN_AGENT));
  assert.equal(detectAgent({}), "openclaw");
  assert.equal(detectAgent({ NEMOCLAW: "1" }), "nemoclaw");
  assert.equal(detectAgent({ BRAIN_AGENT: "custom" }), "custom");

  const capture2 = {};
  await runBrain(["x"], {
    env: { BRAIN_AGENT: "nemoclaw" },
    execFileImpl: fakeExecFile({ stdout: "{}" }, capture2),
  });
  assert.equal(capture2.options.env.BRAIN_AGENT, "nemoclaw");
});
