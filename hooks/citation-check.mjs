#!/usr/bin/env node
/**
 * Stop hook (Claude Code + Codex plugin hosts) — the citation lock.
 *
 * Reads the agent's final reply, finds its `◉ memory:` receipt lines, and
 * checks each against what brain surfaced to this session (src/surfaced.js).
 * A receipt for a memory brain never showed is a fabricated citation: it is
 * logged as a `citation_violation` audit event and queued so prompt-recall
 * tells the agent on its next turn.
 *
 * Advisory, never blocking: the hook prints `{}`, so the reply is delivered
 * unchanged. Blocking a Stop would make the agent keep talking, which is a
 * worse failure than a flagged receipt.
 */

import fs from "node:fs";

import { brainDir, hasBrain, isMain, loadModule, runHook, sessionOf } from "./lib.mjs";

// The transcript can be long; only its tail holds the final reply.
const TAIL_BYTES = 256 * 1024;

/** Text of a transcript message's content (string or content blocks). */
function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
}

/** A user turn the human typed, as opposed to a tool result fed back. */
function isHumanTurn(entry) {
  if (!entry || entry.type !== "user" || !entry.message) return false;
  const content = entry.message.content;
  if (typeof content === "string") return true;
  return Array.isArray(content) && content.some((b) => b && b.type === "text");
}

/**
 * The assistant text since the last human turn, from a JSONL transcript.
 * Returns "" when the file is missing or unreadable.
 */
export function lastReplyFromTranscript(transcriptPath) {
  let raw;
  try {
    const fd = fs.openSync(transcriptPath, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      raw = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
  const entries = raw.split("\n").map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const parts = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (isHumanTurn(e)) break;
    if (e.type === "assistant" && e.message) parts.unshift(textOf(e.message.content));
  }
  return parts.filter(Boolean).join("\n");
}

export async function handleStop(input, options = {}) {
  if (!hasBrain()) return {};
  const record = input && typeof input === "object" ? input : {};
  const text = typeof record.last_assistant_message === "string"
    ? record.last_assistant_message
    : (typeof record.transcript_path === "string" ? lastReplyFromTranscript(record.transcript_path) : "");
  if (!text.includes("◉ memory:")) return {};

  const session = sessionOf(record);
  const surfaced = options.surfaced || loadModule("src/surfaced.js");
  const { unsurfaced } = surfaced.checkCitations(brainDir(), { session, text });
  if (!unsurfaced.length) return {};

  surfaced.recordViolation(brainDir(), { session, titles: unsurfaced });
  const { appendAudit } = options.audit || loadModule("src/audit.js");
  appendAudit(brainDir(), {
    ts: new Date().toISOString(),
    event: "citation_violation",
    session,
    titles: unsurfaced,
  });
  return {};
}

if (isMain(import.meta.url)) runHook("Stop", handleStop);
