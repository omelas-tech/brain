/**
 * contexts — session-context tracking for `~/.brain/contexts.json`.
 *
 * Ports the brain session-end contract: every session boundary appends one
 * summary entry and the file keeps only the most recent 20 entries. The pure
 * append/trim logic is separated from the fs read/write so it can be
 * unit-tested without touching a real brain directory.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MAX_CONTEXT_ENTRIES = 20;

/**
 * Resolve the brain directory, honoring the same BRAIN_DIR override the
 * brain CLI uses (`~` expansion included).
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [homedir]  Injectable for tests.
 * @returns {string}
 */
export function resolveBrainDir(env = process.env, homedir = os.homedir()) {
  const raw = env.BRAIN_DIR && env.BRAIN_DIR.trim();
  if (raw) {
    const expanded = raw === "~" || raw.startsWith("~/") ? path.join(homedir, raw.slice(1)) : raw;
    return path.resolve(expanded);
  }
  return path.join(homedir, ".brain");
}

/**
 * Build a session context entry matching the brain session-end schema.
 * A hook process only knows session boundaries (id, cwd, timestamps) — the
 * richer fields (topics, memories created/recalled) stay empty; the agent-side
 * instructions cover those when the model itself wraps up a session.
 *
 * @param {{
 *   sessionKey?: string,
 *   started?: string,
 *   ended?: string,
 *   project?: string,
 *   topics?: string[],
 *   taskType?: string,
 *   memoriesCreated?: string[],
 *   memoriesRecalled?: string[],
 *   notableUnsaved?: string[],
 *   now?: Date,
 * }} params
 */
export function buildContextEntry(params = {}) {
  const now = params.now instanceof Date ? params.now : new Date();
  const ended = params.ended || now.toISOString();
  const idStamp = ended.replace(/[-:.TZ]/g, "").slice(0, 14);
  const keyPart = params.sessionKey ? `-${String(params.sessionKey).replace(/[^\w.-]+/g, "_")}` : "";
  return {
    session_id: `${idStamp}${keyPart}`,
    started: params.started || ended,
    ended,
    project: params.project || "unknown",
    topics: dedupeStrings(params.topics),
    task_type: params.taskType || "unknown",
    memories_created: dedupeStrings(params.memoriesCreated),
    memories_recalled: dedupeStrings(params.memoriesRecalled),
    notable_unsaved: dedupeStrings(params.notableUnsaved),
  };
}

/** @param {string[] | undefined} values */
function dedupeStrings(values) {
  return [...new Set((values || []).filter((v) => typeof v === "string" && v.length > 0))];
}

/**
 * Pure append: parse the existing contexts.json content (tolerating missing
 * or malformed input), append the entry, and trim to the newest
 * MAX_CONTEXT_ENTRIES. Supports both raw arrays and `{sessions: [...]}`
 * wrappers, preserving whichever shape was found.
 *
 * @param {string | null | undefined} existingContent
 * @param {Record<string, unknown>} entry
 * @param {{max?: number}} [options]
 * @returns {string} new file content (pretty-printed JSON + trailing newline)
 */
export function appendContextEntry(existingContent, entry, options = {}) {
  const max = options.max ?? MAX_CONTEXT_ENTRIES;
  let parsed;
  try {
    parsed = existingContent ? JSON.parse(existingContent) : [];
  } catch {
    parsed = [];
  }
  let wrapped = false;
  let sessions;
  if (Array.isArray(parsed)) {
    sessions = parsed;
  } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.sessions)) {
    wrapped = true;
    sessions = parsed.sessions;
  } else {
    sessions = [];
  }
  sessions.push(entry);
  if (sessions.length > max) sessions = sessions.slice(sessions.length - max);
  const output = wrapped ? { ...parsed, sessions } : sessions;
  return JSON.stringify(output, null, 2) + "\n";
}

/**
 * Read-modify-write `<brainDir>/contexts.json`. Never throws; returns whether
 * the write succeeded. Skips silently when the brain directory does not exist
 * (no brain installed — nothing to track).
 *
 * @param {Record<string, unknown>} entry
 * @param {{brainDir?: string, fsImpl?: typeof fs}} [options]
 * @returns {{ok: boolean, path?: string, skipped?: boolean, error?: string}}
 */
export function appendContextEntryToFile(entry, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const brainDir = options.brainDir || resolveBrainDir();
  try {
    if (!fsImpl.existsSync(brainDir)) return { ok: false, skipped: true };
    const filePath = path.join(brainDir, "contexts.json");
    let existing = null;
    try {
      existing = fsImpl.readFileSync(filePath, "utf8");
    } catch {
      existing = null;
    }
    const next = appendContextEntry(existing, entry);
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fsImpl.writeFileSync(tmpPath, next, "utf8");
    fsImpl.renameSync(tmpPath, filePath);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300) };
  }
}
