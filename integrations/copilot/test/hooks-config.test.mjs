/**
 * hooks.json validity per the Copilot hooks reference
 * (https://docs.github.com/en/copilot/reference/hooks-reference):
 * versioned config, documented event names, command entries with a
 * bash/powershell/command body, bounded timeouts, and script paths that
 * resolve inside the plugin via ${PLUGIN_ROOT}.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PLUGIN_DIR = fileURLToPath(new URL("../plugin/", import.meta.url));
const hooksPath = path.join(PLUGIN_DIR, "hooks.json");

/** Documented hook event names (camelCase form). */
const DOCUMENTED_EVENTS = new Set([
  "sessionStart",
  "sessionEnd",
  "userPromptSubmitted",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "agentStop",
  "subagentStart",
  "subagentStop",
  "errorOccurred",
  "preCompact",
  "notification",
]);

function readHooksConfig() {
  return JSON.parse(fs.readFileSync(hooksPath, "utf8"));
}

test("hooks.json is valid JSON with version 1", () => {
  const config = readHooksConfig();
  assert.equal(config.version, 1);
  assert.equal(typeof config.hooks, "object");
});

test("only documented hook events are used", () => {
  const config = readHooksConfig();
  for (const event of Object.keys(config.hooks)) {
    assert.ok(DOCUMENTED_EVENTS.has(event), `${event} is a documented event`);
  }
});

test("the ambient loop registers sessionStart and sessionEnd", () => {
  const config = readHooksConfig();
  assert.ok(Array.isArray(config.hooks.sessionStart) && config.hooks.sessionStart.length === 1);
  assert.ok(Array.isArray(config.hooks.sessionEnd) && config.hooks.sessionEnd.length === 1);
});

test("every hook entry is a well-formed command hook", () => {
  const config = readHooksConfig();
  for (const [event, entries] of Object.entries(config.hooks)) {
    for (const entry of entries) {
      assert.equal(entry.type, "command", `${event}: command hook`);
      assert.ok(
        entry.bash || entry.powershell || entry.command,
        `${event}: one of bash/powershell/command is required`,
      );
      assert.ok(entry.bash && entry.powershell, `${event}: cross-platform (bash + powershell)`);
      assert.equal(typeof entry.timeoutSec, "number");
      assert.ok(entry.timeoutSec > 0 && entry.timeoutSec <= 30, `${event}: bounded timeout`);
      assert.equal(entry.timeoutSec, 15, `${event}: 15s hook timeout per the brain contract`);
    }
  }
});

test("hook commands are dependency-free node scripts that exist in the plugin", () => {
  const config = readHooksConfig();
  for (const [event, entries] of Object.entries(config.hooks)) {
    for (const entry of entries) {
      assert.match(entry.bash, /^node \.\/[\w-]+\.mjs$/, `${event}: plain node invocation`);
      assert.equal(entry.bash, entry.powershell, `${event}: identical invocation on both shells`);
      assert.equal(entry.cwd, "${PLUGIN_ROOT}/hooks", `${event}: cwd anchored to the plugin root`);
      // Resolve "node ./script.mjs" against the cwd (with ${PLUGIN_ROOT} → plugin dir).
      const script = entry.bash.replace(/^node \.\//, "");
      const resolved = path.join(PLUGIN_DIR, "hooks", script);
      assert.ok(fs.existsSync(resolved), `${event}: ${script} exists at ${resolved}`);
    }
  }
});

test("hook scripts avoid shell-string child processes (argv-array execFile only)", () => {
  const hooksDir = path.join(PLUGIN_DIR, "hooks");
  const sources = fs
    .readdirSync(hooksDir)
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => fs.readFileSync(path.join(hooksDir, name), "utf8"))
    .concat(
      fs
        .readdirSync(path.join(hooksDir, "lib"))
        .filter((name) => name.endsWith(".mjs"))
        .map((name) => fs.readFileSync(path.join(hooksDir, "lib", name), "utf8")),
    );
  for (const source of sources) {
    assert.ok(!/\bexec\s*\(/.test(source), "no child_process.exec (shell strings)");
    assert.ok(!/\bspawnSync?\s*\(.*shell\s*:\s*true/.test(source), "no shell: true spawns");
    assert.ok(!source.includes("require("), "pure ESM, no runtime deps");
    assert.ok(
      !/from\s+["'](?!node:|\.)/.test(source),
      "imports only node: builtins and local files",
    );
  }
});
