/**
 * Command (workflow) file validity per the Kilo workflows spec
 * (https://kilo.ai/docs/customize/workflows): markdown with optional YAML
 * frontmatter (description shown in the picker), filename = slash command
 * name. Bodies must carry the brain CLI contract and avoid undocumented
 * placeholders like $ARGUMENTS.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readFrontmatter } from "./helpers/frontmatter.mjs";

const COMMANDS_DIR = fileURLToPath(new URL("../commands/", import.meta.url));

const commandFiles = fs.readdirSync(COMMANDS_DIR).filter((name) => name.endsWith(".md"));

test("the core command set is present", () => {
  for (const expected of ["brain-remember.md", "brain-memorize.md", "brain-status.md"]) {
    assert.ok(commandFiles.includes(expected), `${expected} exists`);
  }
});

for (const file of commandFiles) {
  const filePath = path.join(COMMANDS_DIR, file);
  const commandName = file.replace(/\.md$/, "");

  test(`${file}: slash-command-safe filename`, () => {
    assert.match(commandName, /^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase-hyphen (invoked as /name)");
  });

  test(`${file}: frontmatter description for the command picker`, () => {
    const { fields } = readFrontmatter(filePath);
    assert.equal(typeof fields.description, "string");
    assert.ok(fields.description.length >= 20, "description is meaningful");
    assert.ok(fields.description.length <= 200, "description stays picker-sized");
  });

  test(`${file}: body carries real instructions without undocumented placeholders`, () => {
    const { body } = readFrontmatter(filePath);
    assert.ok(body.trim().length > 200, "body carries real instructions");
    assert.ok(!body.includes("$ARGUMENTS"), "no $ARGUMENTS (undocumented in Kilo)");
    assert.ok(!body.includes("/brain:"), "no Claude-style colon commands");
  });
}

test("brain-remember teaches the recall → reinforce loop", () => {
  const { body } = readFrontmatter(path.join(COMMANDS_DIR, "brain-remember.md"));
  assert.ok(body.includes("brain recall"));
  assert.ok(body.includes("brain reinforce"));
  assert.ok(body.includes("_archived"), "archive fallback documented");
});

test("brain-memorize example payload is valid JSON matching the contract", () => {
  const { body } = readFrontmatter(path.join(COMMANDS_DIR, "brain-memorize.md"));
  assert.ok(body.includes("brain memorize"));
  const match = body.match(/<<'EOF'\n([\s\S]*?)\nEOF/);
  assert.ok(match, "heredoc example present");
  const payload = JSON.parse(match[1]);
  assert.ok(Array.isArray(payload.memories));
  for (const required of ["title", "type", "path", "content"]) {
    assert.ok(payload.memories[0][required], `example memory has required field ${required}`);
  }
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

test("brain-status stays read-only", () => {
  const { body } = readFrontmatter(path.join(COMMANDS_DIR, "brain-status.md"));
  assert.ok(body.includes("index.json"));
  assert.match(body, /read-only/i);
});
