#!/usr/bin/env node
/**
 * sessionEnd hook for GitHub Copilot CLI.
 *
 * Copilot invokes this command when a session terminates, piping the event
 * payload as JSON on stdin (camelCase: sessionId, timestamp, cwd, reason —
 * per the GitHub Copilot hooks reference,
 * https://docs.github.com/en/copilot/reference/hooks-reference).
 *
 * The hook appends a session-boundary entry to `~/.brain/contexts.json`
 * (keeping the newest 20), which feeds context-dependent recall in future
 * sessions. A hook process only knows the boundary facts (session id,
 * project, timestamps) — the richer fields (topics, memories created and
 * recalled, notable unsaved items) are written by the model itself when the
 * agent-side instructions detect a wrap-up.
 *
 * sessionEnd hook output has no documented effect on the session, so this
 * script always prints `{}` and exits 0. It never creates `~/.brain` — if no
 * brain exists there is nothing to track.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { appendContextEntryToFile, buildContextEntry, resolveBrainDir } from "./lib/contexts.mjs";
import { parseHookInput, projectFromInput, readStdin } from "./session-start.mjs";

/**
 * Core hook logic, fully injectable for tests. Never throws.
 *
 * @param {unknown} input  Parsed hook stdin payload.
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   homedir?: string,
 *   fsImpl?: typeof fs,
 *   now?: Date,
 *   warn?: (message: string) => void,
 * }} [options]
 * @returns {{}} the (empty) hook output object.
 */
export function handleSessionEnd(input, options = {}) {
  const env = options.env || process.env;
  const homedir = options.homedir || os.homedir();
  const warn = options.warn || ((message) => console.error(message));

  try {
    const record = typeof input === "object" && input !== null ? /** @type {any} */ (input) : {};
    const ended =
      typeof record.timestamp === "number" && Number.isFinite(record.timestamp)
        ? new Date(record.timestamp).toISOString()
        : undefined;

    const entry = buildContextEntry({
      sessionKey: typeof record.sessionId === "string" ? record.sessionId : undefined,
      ended,
      project: projectFromInput(input),
      now: options.now,
    });

    const result = appendContextEntryToFile(entry, {
      brainDir: resolveBrainDir(env, homedir),
      fsImpl: options.fsImpl,
    });
    if (!result.ok && !result.skipped) {
      warn(`brain-memory: session-end context save failed: ${result.error}`);
    }
  } catch (err) {
    warn(`brain-memory: session-end hook error: ${String(err).slice(0, 300)}`);
  }
  return {};
}

async function main() {
  const input = parseHookInput(await readStdin());
  const output = handleSessionEnd(input);
  process.stdout.write(JSON.stringify(output));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stdout.write("{}");
    process.exitCode = 0;
  });
}
