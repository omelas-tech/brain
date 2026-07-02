/**
 * brain-session-end hook handler.
 *
 * On `command:new` / `command:reset`, appends a session summary entry to
 * `~/.brain/contexts.json` (keeping the last 20, matching the brain plugin's
 * session-end contract) and — when the ending session had substance — pushes
 * a gentle "memorize?" nudge onto the command reply. Nothing is stored
 * automatically; the model/user decides what to remember.
 *
 * Self-contained: node builtins + the lib/ files shipped inside this hook
 * directory (byte-identical copies of the plugin's pure modules, kept in sync
 * by the integration test suite).
 */

import fs from "node:fs";
import {
  appendContextEntryToFile,
  buildContextEntry,
  resolveBrainDir,
} from "./lib/contexts.mjs";

// Local structural type for the OpenClaw internal hook contract
// (src/hooks/internal-hook-types.ts). Hook packs cannot import OpenClaw
// modules, so we mirror the shape here.
type InternalHookEvent = {
  type: string;
  action: string;
  sessionKey: string;
  context: Record<string, unknown>;
  timestamp: Date;
  messages: string[];
};

const HOOK_KEY = "brain-session-end";
const DEFAULT_MIN_TRANSCRIPT_BYTES = 4096;

function resolveHookConfig(cfg: unknown): Record<string, unknown> {
  if (!cfg || typeof cfg !== "object") return {};
  const hooks = (cfg as Record<string, any>).hooks;
  const entry = hooks?.internal?.entries?.[HOOK_KEY];
  return entry && typeof entry === "object" ? entry : {};
}

/** Best-effort transcript size of the session that just ended. */
function previousTranscriptBytes(context: Record<string, unknown>): number {
  const sessionEntry = (context.previousSessionEntry || context.sessionEntry) as
    | Record<string, unknown>
    | undefined;
  const sessionFile = sessionEntry?.sessionFile;
  if (typeof sessionFile !== "string" || sessionFile.length === 0) return 0;
  try {
    return fs.statSync(sessionFile).size;
  } catch {
    return 0;
  }
}

const brainSessionEndHook = (event: InternalHookEvent): void => {
  const isBoundary = event.type === "command" && (event.action === "new" || event.action === "reset");
  if (!isBoundary) return;

  try {
    const context = event.context ?? {};
    const hookConfig = resolveHookConfig(context.cfg);
    if (hookConfig.enabled === false) return;

    const brainDir = resolveBrainDir();
    if (!fs.existsSync(brainDir)) return; // no brain installed — nothing to track

    const project =
      typeof hookConfig.project === "string" && hookConfig.project.trim()
        ? hookConfig.project.trim()
        : "openclaw";

    // Step 1 — always save session context (cheap, valuable recall signal).
    const entry = buildContextEntry({
      sessionKey: event.sessionKey,
      ended:
        event.timestamp instanceof Date ? event.timestamp.toISOString() : new Date().toISOString(),
      project,
      taskType: "conversation",
    });
    const result = appendContextEntryToFile(entry, { brainDir });
    if (!result.ok && !result.skipped) {
      console.warn(`[brain-session-end] contexts.json append failed: ${result.error}`);
    }

    // Step 2 — suggest memorization only when the session had substance.
    const suggest = hookConfig.suggestMemorize !== false;
    const minBytes =
      typeof hookConfig.minTranscriptBytes === "number" && hookConfig.minTranscriptBytes >= 0
        ? hookConfig.minTranscriptBytes
        : DEFAULT_MIN_TRANSCRIPT_BYTES;
    if (suggest && previousTranscriptBytes(context) >= minBytes) {
      event.messages.push(
        "🧠 Session context saved to your brain. If this session had notable decisions, learnings, or preferences, ask me to memorize them before they fade.",
      );
    }
  } catch (err) {
    // Session boundaries must never fail because of memory housekeeping.
    console.warn(`[brain-session-end] failed: ${String(err).slice(0, 300)}`);
  }
};

export default brainSessionEndHook;
