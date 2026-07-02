/**
 * SKILL.md validity per the Copilot agent-skills spec
 * (https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills):
 * required `name` (lowercase, hyphens, matching the directory by convention)
 * and required `description`; bodies must carry the brain CLI contract.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readFrontmatter } from "./helpers/frontmatter.mjs";

const SKILLS_DIR = fileURLToPath(new URL("../plugin/skills/", import.meta.url));

const skillDirs = fs
  .readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

test("the core skill set is present", () => {
  for (const expected of ["brain-remember", "brain-memorize", "brain-status"]) {
    assert.ok(skillDirs.includes(expected), `${expected} skill exists`);
  }
});

for (const dir of skillDirs) {
  const skillFile = path.join(SKILLS_DIR, dir, "SKILL.md");

  test(`${dir}: frontmatter has required name matching its directory`, () => {
    const { fields } = readFrontmatter(skillFile);
    assert.equal(fields.name, dir, "name matches the skill directory");
    assert.match(fields.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase, hyphens for spaces");
  });

  test(`${dir}: frontmatter has a required, non-trivial description`, () => {
    const { fields } = readFrontmatter(skillFile);
    assert.equal(typeof fields.description, "string");
    assert.ok(fields.description.length >= 40, "description is descriptive enough to route on");
    assert.match(fields.description, /use (this )?when/i, "description says when to use the skill");
  });

  test(`${dir}: body is substantial and free of slash-command placeholders`, () => {
    const { body } = readFrontmatter(skillFile);
    assert.ok(body.trim().length > 200, "body carries real instructions");
    assert.ok(!body.includes("$ARGUMENTS"), "no leftover slash-command placeholders");
    assert.ok(!body.includes("/brain:"), "no Claude-style slash command references");
  });
}

test("brain-remember teaches the recall → reinforce loop with the agent label", () => {
  const { body } = readFrontmatter(path.join(SKILLS_DIR, "brain-remember", "SKILL.md"));
  assert.ok(body.includes("brain recall"), "uses the deterministic recall engine");
  assert.ok(body.includes("brain reinforce"), "reinforces after presenting");
  assert.ok(body.includes("BRAIN_AGENT=copilot-cli"), "records the host agent");
});

test("brain-memorize teaches the stdin JSON contract", () => {
  const { body } = readFrontmatter(path.join(SKILLS_DIR, "brain-memorize", "SKILL.md"));
  assert.ok(body.includes("brain memorize"), "pipes to brain memorize");
  assert.ok(body.includes('"memories"'), "shows the stdin payload envelope");
  assert.ok(body.includes("encoding_context"), "includes encoding context");
  assert.ok(body.includes("--sync"), "documents the sync flag");
  // Every valid memory type from the brain contract is listed.
  for (const type of [
    "decision",
    "insight",
    "goal",
    "experience",
    "learning",
    "relationship",
    "preference",
    "observation",
  ]) {
    assert.ok(body.includes(`\`${type}\``), `documents memory type ${type}`);
  }
});

test("brain-memorize example payload is valid JSON matching the contract", () => {
  const { body } = readFrontmatter(path.join(SKILLS_DIR, "brain-memorize", "SKILL.md"));
  const match = body.match(/<<'EOF'\n([\s\S]*?)\nEOF/);
  assert.ok(match, "heredoc example present");
  const payload = JSON.parse(match[1]);
  assert.ok(Array.isArray(payload.memories));
  const memory = payload.memories[0];
  for (const required of ["title", "type", "path", "content"]) {
    assert.ok(memory[required], `example memory has required field ${required}`);
  }
});

test("brain-status stays read-only", () => {
  const { body } = readFrontmatter(path.join(SKILLS_DIR, "brain-status", "SKILL.md"));
  assert.ok(body.includes("index.json"), "reads the memory inventory");
  assert.match(body, /read-only/i, "declares itself read-only");
});
