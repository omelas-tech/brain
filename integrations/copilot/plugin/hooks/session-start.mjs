#!/usr/bin/env node
/**
 * sessionStart hook for GitHub Copilot CLI.
 *
 * Copilot invokes this command when a session starts or resumes, piping the
 * event payload as JSON on stdin (camelCase: sessionId, timestamp, cwd,
 * source, initialPrompt — per the GitHub Copilot hooks reference,
 * https://docs.github.com/en/copilot/reference/hooks-reference).
 *
 * The hook runs the budget-bounded `brain session-start` aggregator and, when
 * there is anything worth injecting, prints `{"additionalContext": "..."}` —
 * the documented sessionStart output field, injected into the session as a
 * user message.
 *
 * Fail-soft contract: every failure path (no ~/.brain, missing brain binary,
 * timeout, bad JSON) prints `{}` and exits 0. A missing binary is warned about
 * once on stderr; the session must never be blocked by brain-memory.
 *
 * // VERIFY: hooks.json anchors this script via `"cwd": "${PLUGIN_ROOT}/hooks"`.
 * The CLI plugin reference documents `${PLUGIN_ROOT}` ("reference paths within
 * the plugin directory") and documents `cwd` as "absolute or relative to the
 * configuration file. Supports ${PLUGIN_ROOT}" — but its worked examples are
 * LSP entries, not hook entries. If a Copilot release ever fails to expand the
 * token for hooks, the fallback is `"cwd": "hooks"` (relative to hooks.json,
 * i.e. the plugin root), which the same reference documents.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { DEFAULT_TIMEOUT_MS, runSessionStart, shouldWarnUnavailable } from "./lib/brain-exec.mjs";
import { resolveBrainDir } from "./lib/contexts.mjs";
import { formatSessionStartBlock } from "./lib/session-format.mjs";

/**
 * Derive the project label from the hook payload's cwd (basename), falling
 * back to the process cwd, then "unknown".
 *
 * @param {unknown} input   Parsed hook stdin payload.
 * @param {string} [fallbackCwd]
 * @returns {string}
 */
export function projectFromInput(input, fallbackCwd = process.cwd()) {
  const record = typeof input === "object" && input !== null ? /** @type {any} */ (input) : {};
  const cwd = typeof record.cwd === "string" && record.cwd.trim() ? record.cwd : fallbackCwd;
  const base = path.basename(String(cwd).replace(/[\\/]+$/, ""));
  return base || "unknown";
}

/**
 * Core hook logic, fully injectable for tests. Never throws.
 *
 * @param {unknown} input  Parsed hook stdin payload.
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   homedir?: string,
 *   fsImpl?: typeof fs,
 *   execFileImpl?: any,
 *   timeoutMs?: number,
 *   warn?: (message: string) => void,
 * }} [options]
 * @returns {Promise<{additionalContext?: string}>} the hook output object.
 */
export async function handleSessionStart(input, options = {}) {
  const env = options.env || process.env;
  const homedir = options.homedir || os.homedir();
  const fsImpl = options.fsImpl || fs;
  const warn = options.warn || ((message) => console.error(message));

  try {
    const brainDir = resolveBrainDir(env, homedir);
    // No index.json → no brain yet; skip the spawn entirely (the aggregator
    // would return an empty payload anyway).
    if (!fsImpl.existsSync(path.join(brainDir, "index.json"))) return {};

    const project = projectFromInput(input);
    const bin = env.BRAIN_BIN || "brain";
    const result = await runSessionStart({
      project,
      bin,
      env,
      execFileImpl: options.execFileImpl,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

    if (!result.ok) {
      if (result.code === "unavailable") {
        if (shouldWarnUnavailable(bin)) warn(`brain-memory: ${result.error}`);
      } else {
        warn(`brain-memory: session-start skipped (${result.code}): ${result.error}`);
      }
      return {};
    }

    const block = formatSessionStartBlock(result.value, { project });
    if (!block) return {};
    return { additionalContext: block };
  } catch (err) {
    warn(`brain-memory: session-start hook error: ${String(err).slice(0, 300)}`);
    return {};
  }
}

/**
 * Read all of stdin. Resolves "" immediately when stdin is a TTY (no piped
 * payload — should not happen under Copilot, but stay defensive).
 *
 * @param {NodeJS.ReadStream} [stream]
 * @returns {Promise<string>}
 */
export function readStdin(stream = process.stdin) {
  if (stream.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      data += chunk;
    });
    stream.on("end", () => resolve(data));
    stream.on("error", () => resolve(data));
  });
}

/** @param {string} raw */
export function parseHookInput(raw) {
  try {
    return raw && raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function main() {
  const input = parseHookInput(await readStdin());
  const output = await handleSessionStart(input);
  process.stdout.write(JSON.stringify(output));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Last-ditch fail-soft: emit an empty decision object and exit cleanly.
    process.stdout.write("{}");
    process.exitCode = 0;
  });
}
