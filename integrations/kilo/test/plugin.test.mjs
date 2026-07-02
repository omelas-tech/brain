/**
 * Plugin module shape per the Kilo plugin contract (and upstream
 * @opencode-ai/plugin PluginModule): a single default-exported descriptor
 * {id, server} — no stray named function exports that an export-iterating
 * loader could mistake for additional plugins.
 */

import assert from "node:assert/strict";
import test from "node:test";

import * as pluginModule from "../plugin/brain-memory.js";

test("module exports exactly one thing: the default descriptor", () => {
  assert.deepEqual(Object.keys(pluginModule), ["default"]);
});

test("descriptor matches the PluginModule shape {id, server}", () => {
  const descriptor = pluginModule.default;
  assert.equal(descriptor.id, "brain-memory");
  assert.equal(typeof descriptor.server, "function");
  assert.ok(!("tui" in descriptor), "tui must be absent per PluginModule");
});

test("server resolves to the hooks object with the three integration hooks", async () => {
  const hooks = await pluginModule.default.server(
    { directory: "/x/proj", worktree: "/x/proj" },
    { env: {}, homedir: "/fake/home", fsImpl: { existsSync: () => false }, warn: () => {} },
  );
  assert.equal(typeof hooks["chat.message"], "function");
  assert.equal(typeof hooks["event"], "function");
  assert.equal(typeof hooks["shell.env"], "function");
  // Only documented hook names — nothing an older runtime would choke on.
  assert.deepEqual(
    Object.keys(hooks).sort(),
    ["chat.message", "event", "shell.env"].sort(),
  );
});

test("server never throws, even with empty input and no options", async () => {
  const hooks = await pluginModule.default.server();
  assert.equal(typeof hooks["chat.message"], "function");
});

test("shell.env labels agent shell commands with BRAIN_AGENT=kilo", async () => {
  const hooks = await pluginModule.default.server(
    { worktree: "/x/proj" },
    { env: {}, homedir: "/fake/home", fsImpl: { existsSync: () => false }, warn: () => {} },
  );
  const output = { env: {} };
  await hooks["shell.env"]({ cwd: "/x/proj" }, output);
  assert.equal(output.env.BRAIN_AGENT, "kilo");

  const preset = { env: { BRAIN_AGENT: "custom-label" } };
  await hooks["shell.env"]({ cwd: "/x/proj" }, preset);
  assert.equal(preset.env.BRAIN_AGENT, "custom-label", "existing label is respected");

  await hooks["shell.env"]({ cwd: "/x/proj" }, {}); // no env — must not throw
});
