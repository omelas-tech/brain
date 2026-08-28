#!/usr/bin/env node
// Codex SessionStart hook: inject the budget-bounded `brain session-start`
// payload as additionalContext — the same deterministic injection every other
// brain integration performs at its host's canonical injection point.
//
// Contract (Codex hooks, 0.148.0+): JSON event arrives on stdin ({cwd,
// session_id, source, ...}); stdout JSON may carry
// hookSpecificOutput.additionalContext. Exit 0 = continue.
// Fail soft: if the brain CLI is missing or errors, log once to stderr and no-op.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

let event = {};
try {
  event = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  // malformed or absent event payload — proceed with defaults
}

const project = path.basename(event.cwd || process.cwd());

let payload;
try {
  payload = execFileSync("brain", ["session-start", "--project", project], {
    encoding: "utf8",
    timeout: 15000,
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, BRAIN_AGENT: "codex" },
  });
  JSON.parse(payload); // validate before injecting
} catch (err) {
  process.stderr.write(`brain session-start unavailable (${err?.code || "error"}); skipping injection\n`);
  process.exit(0);
}

const context = [
  "## Brain memory — session context (deterministic, budget-bounded)",
  "Treat `pinned` entries as active constraints; `context_recall` is relevant past",
  "context; `skills_index` lists procedural skills (load one only when a task matches).",
  "To store a memory, run the structured CLI: `brain memorize` (you decide what is",
  'worth remembering — never dump transcripts). Recall more with `brain recall "<q>"`.',
  "```json",
  payload.trim(),
  "```",
].join("\n");

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
    suppressOutput: true,
  }),
);
