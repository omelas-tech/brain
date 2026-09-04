#!/usr/bin/env node
// Keep the plugin manifests on the package version. Runs from the npm `version`
// lifecycle (after package.json is bumped, before the release commit), so
// `npm version` cannot leave .claude-plugin / .codex-plugin / the marketplace
// entry behind — test/plugin-manifests.test.js fails the build if they drift.
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

function rewrite(rel, update) {
  const file = join(root, rel);
  const data = JSON.parse(readFileSync(file, "utf8"));
  update(data);
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  console.log(`${rel} → ${version}`);
}

rewrite(".claude-plugin/plugin.json", (d) => { d.version = version; });
rewrite(".codex-plugin/plugin.json", (d) => { d.version = version; });
rewrite(".claude-plugin/marketplace.json", (d) => {
  for (const p of d.plugins) if (p.name === "brain") p.version = version;
});
