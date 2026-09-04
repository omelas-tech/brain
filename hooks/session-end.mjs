#!/usr/bin/env node
/**
 * SessionEnd hook (Claude Code + Codex plugin hosts).
 *
 * Appends a session-boundary entry to ~/.brain/contexts.json so
 * context-dependent recall has a signal even when the model never reached a
 * wrap-up. A hook process only knows the boundary facts (host session id,
 * project, end time); the richer fields (topics, memories created/recalled,
 * notable unsaved) are written by the model itself when it detects a wrap-up.
 *
 * Codex gives SessionEnd hooks one second by default, so this stays in-process
 * and does a single read-modify-write. Output has no effect on the session.
 */

import { hasBrain, isMain, loadModule, projectFromInput, runHook } from "./lib.mjs";

export const MAX_CONTEXT_ENTRIES = 20;

/** Build the entry in the shape the prompt-based session-end contract uses. */
export function buildContextEntry(input, now = new Date()) {
  const record = input && typeof input === "object" ? input : {};
  const ended = now.toISOString();
  const stamp = ended.replace(/[-:.TZ]/g, "").slice(0, 14);
  const key = typeof record.session_id === "string" && record.session_id
    ? `-${record.session_id.replace(/[^\w.-]+/g, "_")}`
    : "";
  return {
    session_id: `${stamp}${key}`,
    started: ended,
    ended,
    project: projectFromInput(record),
    topics: [],
    task_type: "unknown",
    memories_created: [],
    memories_recalled: [],
    notable_unsaved: [],
    source: "session-end-hook",
  };
}

/** Pure append + trim over either `{sessions: [...]}` or a bare array. */
export function appendContextEntry(contexts, entry, max = MAX_CONTEXT_ENTRIES) {
  let sessions;
  let wrapped = null;
  if (Array.isArray(contexts)) sessions = contexts.slice();
  else if (contexts && typeof contexts === "object" && Array.isArray(contexts.sessions)) {
    wrapped = contexts;
    sessions = contexts.sessions.slice();
  } else sessions = [];
  sessions.push(entry);
  if (sessions.length > max) sessions = sessions.slice(sessions.length - max);
  return wrapped ? { ...wrapped, sessions } : { version: 1, sessions };
}

export function handleSessionEnd(input, options = {}) {
  if (!hasBrain()) return {};
  const im = options.indexManager || loadModule("src/index-manager.js");
  const entry = buildContextEntry(input, options.now);
  im.writeContexts(appendContextEntry(im.readContexts(), entry));
  return {};
}

if (isMain(import.meta.url)) runHook("SessionEnd", handleSessionEnd);
