import { writeFileSync } from "fs";
import { join } from "path";
import {
  docPages,
  categoryOrder,
  SITE_URL,
} from "../src/lib/docs-data.mjs";
import { extractContent, mdxPathForPage, publicDir } from "./mdx-extract.mjs";

const SUMMARY =
  "A hierarchical, file-system-based memory system for AI coding agents, inspired by human neuroscience — memories decay on an Ebbinghaus curve, strengthen through recall, connect via associative networks, and consolidate during a sleep cycle. A deterministic recall engine gives identical scoring across Claude Code, Gemini CLI, OpenAI Codex CLI, and OpenCode: one brain, any model, every agent.";

const INTRO =
  "Brain Memory stores every memory as a human-readable Markdown file with YAML frontmatter in a single global `~/.brain/` directory — no database, no server. It is free and open source (npm package: `brain-memory`).";

/** Sort pages by category order, then page order. */
function sortedPages() {
  return [...docPages].sort((a, b) => {
    const ca = categoryOrder[a.category] ?? 99;
    const cb = categoryOrder[b.category] ?? 99;
    return ca !== cb ? ca - cb : a.order - b.order;
  });
}

/** Group sorted pages by category, preserving category order. */
function groupByCategory() {
  /** @type {Map<string, typeof docPages>} */
  const groups = new Map();
  for (const page of sortedPages()) {
    const arr = groups.get(page.category) ?? [];
    arr.push(page);
    groups.set(page.category, arr);
  }
  return groups;
}

/** Build the curated llms.txt index (Markdown link lists per the spec). */
function buildLlmsTxt() {
  const lines = [];
  lines.push("# Brain Memory");
  lines.push("");
  lines.push(`> ${SUMMARY}`);
  lines.push("");
  lines.push(INTRO);
  lines.push("");

  for (const [category, pages] of groupByCategory()) {
    lines.push(`## ${category}`);
    lines.push("");
    for (const page of pages) {
      lines.push(`- [${page.title}](${SITE_URL}${page.href}): ${page.description}`);
    }
    lines.push("");
  }

  lines.push("## Optional");
  lines.push("");
  lines.push("- [GitHub repository](https://github.com/omelas-tech/brain): source code and issues");
  lines.push("- [npm package](https://www.npmjs.com/package/brain-memory): install with `npm install -g brain-memory`");
  lines.push("- [Full documentation corpus](" + SITE_URL + "/llms-full.txt): every page concatenated as plain text");
  lines.push("");

  return lines.join("\n");
}

/** Build llms-full.txt: every doc page's full text in one file. */
function buildLlmsFullTxt() {
  const sections = [];
  sections.push("# Brain Memory — Full Documentation");
  sections.push("");
  sections.push(`> ${SUMMARY}`);
  sections.push("");
  sections.push("Source: " + SITE_URL);
  sections.push("");

  for (const page of sortedPages()) {
    const headline = page.title.replace(/\s*[—-]\s*Brain Memory\s*$/, "");
    const body = extractContent(mdxPathForPage(page), 0);
    sections.push("---");
    sections.push("");
    sections.push(`# ${headline}`);
    sections.push("");
    sections.push(`URL: ${SITE_URL}${page.href}`);
    sections.push(`Category: ${page.category}`);
    sections.push("");
    sections.push(body || page.description);
    sections.push("");
  }

  return sections.join("\n");
}

const llmsTxt = buildLlmsTxt();
const llmsFullTxt = buildLlmsFullTxt();

writeFileSync(join(publicDir, "llms.txt"), llmsTxt, "utf-8");
writeFileSync(join(publicDir, "llms-full.txt"), llmsFullTxt, "utf-8");

console.log(
  `llms.txt built: ${docPages.length} links → public/llms.txt (${llmsTxt.length} bytes)`
);
console.log(
  `llms-full.txt built: full corpus → public/llms-full.txt (${llmsFullTxt.length} bytes)`
);
