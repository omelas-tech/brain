import { writeFileSync } from "fs";
import { join } from "path";
import { docPages } from "../src/lib/docs-data.mjs";
import { extractContent, mdxPathForPage, publicDir } from "./mdx-extract.mjs";

const outPath = join(publicDir, "search-index.json");

function buildIndex() {
  const index = docPages.map((page) => ({
    title: page.title,
    description: page.description,
    href: page.href,
    category: page.category,
    content: extractContent(mdxPathForPage(page)),
  }));

  writeFileSync(outPath, JSON.stringify(index, null, 2), "utf-8");
  console.log(
    `Search index built: ${index.length} pages → public/search-index.json`
  );
}

buildIndex();
