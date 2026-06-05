// Engine bridge — runs the *real* brain-memory recall engine per user.
//
// Phase 1 reuses the deterministic engine verbatim instead of reimplementing
// scoring: we invoke the repo's `bin/recall.js` with BRAIN_DIR pointed at the
// user's brain working copy (the same BRAIN_DIR override the CLI honors). This
// guarantees the connector's recall is byte-for-byte identical to the CLI's.
//
// (A later optimization can import scorer.js in-process; the subprocess keeps
// Phase 1 honest and trivially correct.)

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", ".."); // brain/connector/src -> brain/
const RECALL_BIN = path.join(REPO_ROOT, "bin", "recall.js");

export interface RecallHit {
  id: string;
  title?: string;
  path?: string;
  score?: number;
  [k: string]: unknown;
}

/** Run deterministic recall over a user's brain directory. */
export async function recall(
  brainDir: string,
  query: string,
  opts: { project?: string; task?: string; top?: number } = {},
): Promise<RecallHit[]> {
  const args = [RECALL_BIN, query, "--top", String(opts.top ?? 10)];
  if (opts.project) args.push("--project", opts.project);
  if (opts.task) args.push("--task", opts.task);

  const { stdout } = await execFileAsync(process.execPath, args, {
    env: { ...process.env, BRAIN_DIR: brainDir },
    maxBuffer: 8 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout || "[]");
  if (parsed && parsed.error) throw new Error(parsed.error);
  return Array.isArray(parsed) ? parsed : (parsed.results ?? []);
}

/** Lightweight brain health summary read straight from index.json. */
export function status(brainDir: string): {
  initialized: boolean;
  memory_count: number;
  last_updated?: string;
  version?: number;
} {
  const indexPath = path.join(brainDir, "index.json");
  if (!existsSync(indexPath)) return { initialized: false, memory_count: 0 };
  const idx = JSON.parse(readFileSync(indexPath, "utf-8"));
  return {
    initialized: true,
    memory_count: idx.memory_count ?? Object.keys(idx.memories ?? {}).length,
    last_updated: idx.last_updated,
    version: idx.version,
  };
}
