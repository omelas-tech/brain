#!/usr/bin/env node
// Codex Stop hook (async): record the finished turn so /brain:import and the
// sleep cycle know exactly which Codex transcripts are new — deterministic
// bookkeeping only. Deliberately does NOT memorize anything: capture is the
// model's decision via `brain memorize` (integrations/README.md, principle 1);
// a hook that dumps last_assistant_message into memory would be mechanical
// transcript dumping.
//
// Runs with `async = true`: fire-and-forget, cannot block the turn.
// Fail soft: any error logs once to stderr and exits 0.
import { appendFileSync, mkdirSync, readFileSync, statSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_QUEUE_BYTES = 1024 * 1024; // rotate at 1MB; the importer consumes and clears

try {
  const event = JSON.parse(readFileSync(0, "utf8") || "{}");
  const dir = path.join(os.homedir(), ".brain", "_import");
  const file = path.join(dir, "codex-turns.jsonl");
  mkdirSync(dir, { recursive: true });

  try {
    if (statSync(file).size > MAX_QUEUE_BYTES) renameSync(file, `${file}.1`);
  } catch {
    // first write — no file yet
  }

  const record = {
    ts: new Date().toISOString(),
    agent: "codex",
    session_id: event.session_id ?? null,
    turn_id: event.turn_id ?? null,
    transcript_path: event.transcript_path ?? null,
    cwd: event.cwd ?? null,
  };
  appendFileSync(file, JSON.stringify(record) + "\n");
} catch (err) {
  process.stderr.write(`brain codex stop-hook: ${err?.message || err}\n`);
}
process.exit(0);
