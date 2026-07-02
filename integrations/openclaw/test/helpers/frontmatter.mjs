/**
 * Minimal frontmatter reader for tests: extracts the YAML frontmatter block
 * of a HOOK.md / SKILL.md, returns simple `key: value` scalars, and parses
 * the single-line JSON `metadata:` field the OpenClaw loaders rely on.
 */

import fs from "node:fs";

/**
 * @param {string} filePath
 * @returns {{fields: Record<string, string>, metadata: any, raw: string}}
 */
export function readFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error(`no frontmatter block in ${filePath}`);
  const block = match[1];

  const fields = {};
  let metadata = null;
  for (const line of block.split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key === "metadata") {
      // The metadata value must be single-line JSON so every parser
      // (YAML flow mapping OR plain JSON.parse) accepts it.
      metadata = JSON.parse(value);
      fields[key] = value;
    } else {
      fields[key] = stripQuotes(value.trim());
    }
  }
  return { fields, metadata, raw: block };
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
