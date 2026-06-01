import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { dirForPage } from "../src/lib/docs-data.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const docsDir = join(root, "src", "app", "docs");
export const publicDir = join(root, "public");

/**
 * Extract readable text from an MDX file: strips frontmatter, imports, the
 * metadata export (object literal or docMeta(...) call), JSX tags, and
 * Markdown syntax.
 * @param {string} filePath
 * @param {number} [maxLen] Truncation length; pass 0 for the full body.
 */
export function extractContent(filePath, maxLen = 2000) {
  if (!existsSync(filePath)) return "";

  let content = readFileSync(filePath, "utf-8");

  content = content.replace(/^---[\s\S]*?---\n?/, ""); // frontmatter
  content = content.replace(/^import\s+.*$/gm, ""); // imports
  // metadata export (multi-line object literal or docMeta(...) wrapper)
  content = content.replace(
    /^export\s+const\s+metadata\s*=\s*[\s\S]*?\n\}\)?;?\s*$/m,
    ""
  );
  content = content.replace(/^export\s+.*$/gm, ""); // remaining exports
  content = content.replace(/<[^>]+>/g, " "); // JSX tags
  content = content.replace(/^#{1,6}\s+/gm, ""); // heading markers
  content = content.replace(/```[\s\S]*?```/g, ""); // code fences
  content = content.replace(/`([^`]+)`/g, "$1"); // inline code
  content = content.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // links → text
  content = content.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1"); // bold/italic
  content = content.replace(/\s+/g, " ").trim(); // collapse whitespace

  return maxLen > 0 ? content.slice(0, maxLen) : content;
}

/**
 * Resolve the MDX file path for a doc page.
 * @param {{ href: string }} page
 */
export function mdxPathForPage(page) {
  const dir = dirForPage(page);
  return dir === ""
    ? join(docsDir, "page.mdx")
    : join(docsDir, dir, "page.mdx");
}
