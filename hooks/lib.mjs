/**
 * Shared helpers for the plugin hook scripts in this directory.
 *
 * These hooks run under Claude Code and OpenAI Codex plugin hosts. Both pipe
 * the event as JSON on stdin, both accept `hookSpecificOutput.additionalContext`
 * on stdout, and both export `CLAUDE_PLUGIN_ROOT` (Codex sets it for plugin
 * compatibility alongside its own `PLUGIN_ROOT`). The scripts therefore need no
 * host-specific branches beyond the command vocabulary shown to the model.
 *
 * The plugin root is this repository, so the brain engine is loaded in-process
 * from ../src and ../bin — no `brain` binary on PATH is required for hooks.
 *
 * Fail-soft contract: a hook must never break the host session. Every failure
 * path writes one line to stderr, prints `{}` and exits 0.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const require = createRequire(import.meta.url);

/** Load a CommonJS module from the plugin root (e.g. "bin/session-start.js"). */
export function loadModule(relativePath) {
  return require(path.join(PLUGIN_ROOT, relativePath));
}

/** Resolve the brain directory the same way the CLI does (honors BRAIN_DIR). */
export function brainDir() {
  return loadModule("src/index-manager.js").getBrainDir();
}

/** True when a brain exists — hooks do nothing at all before first init. */
export function hasBrain() {
  return fs.existsSync(path.join(brainDir(), "index.json"));
}

/**
 * Which host is running the hook. Codex exports PLUGIN_ROOT for plugin hooks;
 * Claude Code exports CLAUDECODE for every child process. Used only to pick
 * the command vocabulary shown to the model — the hook logic is identical.
 */
export function detectHost(env = process.env) {
  if (env.CODEX_HOME || env.CODEX_SANDBOX) return "codex";
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return "claude-code";
  if (env.PLUGIN_ROOT) return "codex";
  if (env.CLAUDE_PLUGIN_ROOT) return "claude-code";
  return "unknown";
}

/** Project label from the event's cwd (basename), falling back to process cwd. */
export function projectFromInput(input, fallbackCwd = process.cwd()) {
  const record = input && typeof input === "object" ? input : {};
  const cwd = typeof record.cwd === "string" && record.cwd.trim() ? record.cwd : fallbackCwd;
  return path.basename(String(cwd).replace(/[\\/]+$/, "")) || "unknown";
}

/** Read all of stdin; "" when nothing is piped. */
export function readStdin(stream = process.stdin) {
  if (stream.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => { data += chunk; });
    stream.on("end", () => resolve(data));
    stream.on("error", () => resolve(data));
  });
}

export function parseHookInput(raw) {
  try {
    return raw && raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** ~4 chars per token; used only to enforce injection ceilings. */
export function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

/** The structured hook output both hosts understand. */
export function contextOutput(hookEventName, additionalContext) {
  return {
    hookSpecificOutput: { hookEventName, additionalContext },
    suppressOutput: true,
  };
}

/**
 * Run a hook handler with the fail-soft contract: parse stdin, call the
 * handler, print its output (or `{}`), never throw, always exit 0.
 */
export async function runHook(hookEventName, handler) {
  let output = {};
  try {
    const input = parseHookInput(await readStdin());
    output = (await handler(input)) || {};
  } catch (err) {
    process.stderr.write(
      `brain-memory ${hookEventName} hook: ${String(err && err.message ? err.message : err).slice(0, 300)}\n`
    );
    output = {};
  }
  process.stdout.write(JSON.stringify(output));
  process.exitCode = 0;
}

/** True when this file is the process entry point (so tests can import it). */
export function isMain(metaUrl) {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(metaUrl);
}
