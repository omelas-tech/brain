// Derive the website changelog feed from the repo's CHANGELOG.md.
//
// CHANGELOG.md (Keep a Changelog) is the single source of truth. This step
// parses it into public/data/changelog.json — a newest-first array of released
// versions — which the docs changelog page imports at build time. Deterministic;
// no network, no LLM. Runs in the website `build` chain, so the site can never
// drift from the committed changelog.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url)); // website/scripts
const repoRoot = join(here, "..", "..");
const changelogPath = join(repoRoot, "CHANGELOG.md");
const outDir = join(here, "..", "public", "data");
const outPath = join(outDir, "changelog.json");

/** Collapse a wrapped bullet (continuation lines) into one normalized string. */
function normalize(lines) {
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Parse Keep-a-Changelog markdown into structured, released-only entries.
 * Shape: { version, date, sections: [{ category, items[] }], note }
 * "Unreleased" and empty sections are dropped (only shipped content ships).
 */
export function parseChangelog(md) {
  const lines = md.split("\n");
  const entries = [];
  let entry = null;
  let section = null;
  let buffer = null; // { target: 'item'|'note', lines: [] }

  const flush = () => {
    if (!entry || !buffer) return;
    const text = normalize(buffer.lines);
    if (text) {
      if (buffer.target === "item" && section) section.items.push(text);
      else entry.note = entry.note ? `${entry.note} ${text}` : text;
    }
    buffer = null;
  };

  const pushEntry = () => {
    if (!entry) return;
    flush();
    entry.sections = entry.sections.filter((s) => s.items.length > 0);
    if (
      entry.version.toLowerCase() !== "unreleased" &&
      (entry.sections.length > 0 || entry.note)
    ) {
      entries.push(entry);
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");

    // ## [version] - date   (date optional; separator -, –, or —)
    const head = line.match(/^##\s+\[([^\]]+)\]\s*(?:[-–—]\s*(.+))?\s*$/);
    if (head) {
      pushEntry();
      entry = { version: head[1].trim(), date: (head[2] || "").trim() || null, sections: [], note: null };
      section = null;
      buffer = null;
      continue;
    }
    if (!entry) continue;

    // ### Category
    const cat = line.match(/^###\s+(.+?)\s*$/);
    if (cat) {
      flush();
      section = { category: cat[1].trim(), items: [] };
      entry.sections.push(section);
      continue;
    }

    // - bullet  (top-level; nested "  - " folds into the current bullet)
    const bullet = line.match(/^-\s+(.*)$/);
    if (bullet) {
      flush();
      buffer = { target: "item", lines: [bullet[1]] };
      continue;
    }

    if (line.trim() === "") {
      flush();
      continue;
    }

    // continuation / prose
    if (buffer) buffer.lines.push(line.trim());
    else buffer = { target: "note", lines: [line.trim()] };
  }
  pushEntry();
  return entries;
}

const md = readFileSync(changelogPath, "utf-8");
const entries = parseChangelog(md);
mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(entries, null, 2) + "\n", "utf-8");

const itemCount = entries.reduce(
  (n, e) => n + e.sections.reduce((m, s) => m + s.items.length, 0),
  0
);
console.log(
  `changelog.json built: ${entries.length} releases, ${itemCount} items → public/data/changelog.json`
);
