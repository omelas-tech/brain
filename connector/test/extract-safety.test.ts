// Security regression: the brain bundle extractor must NOT let a malicious
// archive escape the destination. The bundle round-trips through brain-cloud as
// an opaque blob, so a hostile user could plant a symlink member pointing at an
// absolute path outside their brain dir, then a follow-up entry that writes
// THROUGH it (the classic tar symlink-traversal). The connector runs co-located
// with brain-cloud, so an escape = cross-user tampering or stealing cloud secrets.
//
// extractBrainTar must: (a) extract normal files, (b) drop symlink/hardlink
// members entirely, (c) never create or write through an out-of-tree path.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";

import { extractBrainTar } from "../src/store.js";

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "bc-extract-"));
  const secret = path.join(work, "secret");          // OUTSIDE the brain dir
  fs.mkdirSync(secret, { recursive: true });
  fs.writeFileSync(path.join(secret, "keep.txt"), "do-not-touch");

  // Build a hostile archive (preservePaths keeps the absolute symlink target).
  const src = path.join(work, "src");
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, "note.md"), "# legit memory\n");
  fs.symlinkSync(secret, path.join(src, "escape"));  // escape -> /abs/secret
  const archive = path.join(work, "evil.tar.gz");
  await tar.c({ gzip: true, file: archive, cwd: src, preservePaths: true }, ["note.md", "escape"]);

  // Sanity: the archive really does contain the symlink member we want dropped.
  let sawSymlink = false;
  await tar.t({ file: archive, onentry: (e) => { if (e.type === "SymbolicLink") sawSymlink = true; } });
  assert.ok(sawSymlink, "test archive must contain a symlink member");

  // Extract through the hardened path.
  const dest = path.join(work, "brain");
  fs.mkdirSync(dest, { recursive: true });
  await extractBrainTar(archive, dest);

  // (a) the legit file landed
  assert.ok(fs.existsSync(path.join(dest, "note.md")), "normal file extracted");
  // (b) the symlink member was dropped — nothing named "escape" exists
  assert.ok(!fs.existsSync(path.join(dest, "escape")), "symlink member must be dropped");
  assert.ok(!fs.lstatSync(path.join(dest, "escape"), { throwIfNoEntry: false }), "no symlink left behind");
  // (c) the out-of-tree secret is untouched and intact
  assert.equal(fs.readFileSync(path.join(secret, "keep.txt"), "utf-8"), "do-not-touch", "out-of-tree dir untouched");

  fs.rmSync(work, { recursive: true, force: true });
  console.log("  extractBrainTar: legit file kept, symlink member dropped, no escape");
  console.log("\n✅ EXTRACT SAFETY: malicious symlink bundle cannot escape the brain dir.");
}

main().catch((e) => { console.error("\n❌ extract safety test failed:", e); process.exit(1); });
