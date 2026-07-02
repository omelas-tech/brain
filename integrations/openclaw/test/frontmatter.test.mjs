import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFrontmatter } from "./helpers/frontmatter.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("brain-session-start HOOK.md frontmatter is valid", () => {
  const { fields, metadata } = readFrontmatter(
    path.join(root, "hooks/brain-session-start/HOOK.md"),
  );
  assert.equal(fields.name, "brain-session-start");
  assert.ok(fields.description.length > 10);
  assert.deepEqual(metadata.openclaw.events, ["agent:bootstrap"]);
  assert.deepEqual(metadata.openclaw.requires.bins, ["brain"]);
  assert.equal(metadata.openclaw.install[0].package, "brain-memory");
});

test("brain-session-end HOOK.md frontmatter is valid", () => {
  const { fields, metadata } = readFrontmatter(path.join(root, "hooks/brain-session-end/HOOK.md"));
  assert.equal(fields.name, "brain-session-end");
  assert.deepEqual(metadata.openclaw.events, ["command:new", "command:reset"]);
  assert.deepEqual(metadata.openclaw.requires.bins, ["brain"]);
});

test("SKILL.md frontmatter is valid AgentSkills metadata", () => {
  const { fields, metadata } = readFrontmatter(path.join(root, "skill/brain-memory/SKILL.md"));
  assert.equal(fields.name, "brain-memory");
  assert.ok(fields.description.length > 20);
  assert.equal(metadata.openclaw.emoji, "🧠");
  assert.deepEqual(metadata.openclaw.requires.bins, ["brain"]);
  const install = metadata.openclaw.install[0];
  assert.equal(install.kind, "node");
  assert.equal(install.package, "brain-memory");
  assert.deepEqual(install.bins, ["brain"]);
});

test("metadata lines are single-line JSON (parse with plain JSON.parse)", () => {
  for (const file of [
    "hooks/brain-session-start/HOOK.md",
    "hooks/brain-session-end/HOOK.md",
    "skill/brain-memory/SKILL.md",
  ]) {
    const content = fs.readFileSync(path.join(root, file), "utf8");
    const line = content.split("\n").find((l) => l.startsWith("metadata:"));
    assert.ok(line, `${file}: metadata line missing`);
    const parsed = JSON.parse(line.slice("metadata:".length).trim());
    assert.ok(parsed.openclaw, `${file}: metadata.openclaw missing`);
  }
});

test("plugin manifest is valid and consistent with the entry", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "plugin/openclaw.plugin.json"), "utf8"),
  );
  assert.equal(manifest.id, "brain-memory");
  assert.equal(manifest.kind, "memory");
  assert.deepEqual(manifest.contracts.tools, ["memory_search", "memory_get", "brain_memorize"]);
  assert.equal(manifest.configSchema.type, "object");
  for (const key of ["brainBin", "project", "topRecall", "autoReinforce", "syncOnMemorize"]) {
    assert.ok(key in manifest.configSchema.properties, `configSchema missing ${key}`);
  }
  const entrySource = fs.readFileSync(path.join(root, "plugin/index.ts"), "utf8");
  assert.match(entrySource, /id:\s*"brain-memory"/);

  const pkg = JSON.parse(fs.readFileSync(path.join(root, "plugin/package.json"), "utf8"));
  assert.equal(pkg.name, "openclaw-brain-memory");
  assert.equal(pkg.license, "MIT");
  assert.deepEqual(pkg.openclaw.extensions, ["./index.ts"]);
});

test("hook-pack lib copies stay byte-identical to the plugin's canonical modules", () => {
  const pairs = [
    ["plugin/src/lib/brain-exec.mjs", "hooks/brain-session-start/lib/brain-exec.mjs"],
    ["plugin/src/lib/brain-exec.mjs", "hooks/brain-session-end/lib/brain-exec.mjs"],
    ["plugin/src/lib/session-format.mjs", "hooks/brain-session-start/lib/session-format.mjs"],
    ["plugin/src/lib/contexts.mjs", "hooks/brain-session-end/lib/contexts.mjs"],
  ];
  for (const [canonical, copy] of pairs) {
    const a = fs.readFileSync(path.join(root, canonical), "utf8");
    const b = fs.readFileSync(path.join(root, copy), "utf8");
    assert.equal(a, b, `${copy} drifted from ${canonical} — re-copy it`);
  }
});

test("nemoclaw policy file exists and allowlists the MCP endpoint", () => {
  const policy = fs.readFileSync(path.join(root, "nemoclaw/brainmemory-policy.yaml"), "utf8");
  assert.match(policy, /mcp\.brainmemory\.ai/);
  assert.match(policy, /port: 443/);
  assert.match(policy, /method: POST, path: "\/mcp"/);
});
