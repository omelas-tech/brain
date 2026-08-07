// Validates the committed portable Agent Skill (integrations/agentskills/…):
// its frontmatter must satisfy the agentskills.io shape so it loads unmodified
// across every compatible client.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, "..", "brain-memory", "SKILL.md");

function readFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error(`no frontmatter block in ${filePath}`);
  const fields = {};
  let metadata = null;
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key === "metadata") { metadata = JSON.parse(value); fields[key] = value; }
    else fields[key] = value.replace(/^["']|["']$/g, "").trim();
  }
  return { fields, metadata, body: content.slice(match[0].length) };
}

test("portable skill has required agentskills.io frontmatter", () => {
  const { fields } = readFrontmatter(SKILL);
  assert.equal(fields.name, "brain-memory", "name must match the folder");
  assert.ok(fields.description && fields.description.length > 20, "description present");
  assert.equal(fields.license, "MIT");
  assert.ok(fields.homepage?.startsWith("https://"), "homepage is an https URL");
});

test("metadata is single-line JSON declaring the brain CLI requirement", () => {
  const { metadata } = readFrontmatter(SKILL);
  assert.ok(metadata.requires?.bins?.includes("brain"), "declares the brain binary requirement");
  assert.ok(Array.isArray(metadata.install) && metadata.install.length > 0, "has an install descriptor");
  assert.equal(metadata.install[0].package, "brain-memory");
});

test("body documents recall, memorize, verify, and session-start", () => {
  const { body } = readFrontmatter(SKILL);
  for (const cmd of ["brain recall", "brain memorize", "brain verify", "brain session-start", "brain reinforce"]) {
    assert.ok(body.includes(cmd), `body should document \`${cmd}\``);
  }
  // the trust surface must be present — this is the point of the roadmap
  assert.ok(body.includes("quarantine_pending"), "documents the quarantine flag");
  assert.ok(body.includes("origin"), "documents provenance/origin");
});

test("session-start helper script exists and is dependency-free", () => {
  const script = path.join(HERE, "..", "brain-memory", "scripts", "session-start.mjs");
  const src = fs.readFileSync(script, "utf8");
  assert.ok(src.includes("session-start"), "wraps brain session-start");
  // zero third-party imports — only node: builtins
  const imports = [...src.matchAll(/^import .* from ["']([^"']+)["']/gm)].map((m) => m[1]);
  for (const spec of imports) {
    assert.ok(spec.startsWith("node:"), `only node builtins allowed, found: ${spec}`);
  }
});
