/**
 * plugin.json validity against the documented Copilot CLI plugin schema
 * (https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference):
 * required kebab-case `name` (max 64 chars), optional metadata limits, and
 * component path fields that must resolve inside the plugin directory.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PLUGIN_DIR = fileURLToPath(new URL("../plugin/", import.meta.url));
const manifestPath = path.join(PLUGIN_DIR, "plugin.json");

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

test("plugin.json exists and is valid JSON", () => {
  assert.ok(fs.existsSync(manifestPath));
  assert.doesNotThrow(readManifest);
});

test("name is required, kebab-case, max 64 chars", () => {
  const manifest = readManifest();
  assert.equal(typeof manifest.name, "string");
  assert.match(manifest.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(manifest.name.length <= 64);
});

test("optional metadata respects documented constraints", () => {
  const manifest = readManifest();
  assert.ok(manifest.description.length <= 1024, "description max 1024 chars");
  assert.match(manifest.version, /^\d+\.\d+\.\d+(-[\w.]+)?$/, "semantic version");
  assert.equal(typeof manifest.author.name, "string", "author.name is required when author present");
  assert.ok(Array.isArray(manifest.keywords));
});

test("skills path resolves and every skill directory has a SKILL.md", () => {
  const manifest = readManifest();
  const skillsDir = path.join(PLUGIN_DIR, manifest.skills);
  assert.ok(fs.existsSync(skillsDir), `skills dir ${manifest.skills} exists`);
  const entries = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());
  assert.ok(entries.length >= 3, "at least brain-remember, brain-memorize, brain-status");
  for (const entry of entries) {
    const skillFile = path.join(skillsDir, entry.name, "SKILL.md");
    assert.ok(fs.existsSync(skillFile), `${entry.name}/SKILL.md exists`);
  }
});

test("hooks path resolves to a parseable hooks config", () => {
  const manifest = readManifest();
  const hooksPath = path.join(PLUGIN_DIR, manifest.hooks);
  assert.ok(fs.existsSync(hooksPath), `hooks config ${manifest.hooks} exists`);
  const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  assert.equal(hooks.version, 1);
  assert.equal(typeof hooks.hooks, "object");
});

test("manifest does not bundle an MCP server (remote connector stays opt-in)", () => {
  const manifest = readManifest();
  assert.equal(manifest.mcpServers, undefined);
});
