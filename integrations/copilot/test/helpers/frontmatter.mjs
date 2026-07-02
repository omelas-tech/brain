/**
 * Minimal frontmatter reader for tests: extracts the YAML frontmatter block
 * of a SKILL.md and returns simple `key: value` scalars.
 */

import fs from "node:fs";

/**
 * @param {string} filePath
 * @returns {{fields: Record<string, string>, raw: string, body: string}}
 */
export function readFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`no frontmatter block in ${filePath}`);
  const [, block, body] = match;

  const fields = {};
  for (const line of block.split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    fields[key] = stripQuotes(value.trim());
  }
  return { fields, raw: block, body };
}

/** @param {string} value */
function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
