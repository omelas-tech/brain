#!/usr/bin/env node
/**
 * SessionStart hook (Claude Code + Codex plugin hosts).
 *
 * Injects the budget-bounded `brain session-start` payload as
 * `additionalContext`, together with the ambient rules the prompt-based
 * install would otherwise carry in CLAUDE.md / AGENTS.md. This is the
 * deterministic form of the session-start behaviour: the host injects it,
 * the model does not have to remember to run anything.
 *
 * The payload is computed in-process from ../bin/session-start.js and is
 * already capped by `working_memory_budget_tokens` in ~/.brain/config.json.
 */

import { contextOutput, detectHost, hasBrain, isMain, loadModule, projectFromInput, runHook } from "./lib.mjs";

const COMMANDS = {
  "claude-code":
    "Commands: /brain:remember, /brain:memorize, /brain:status, /brain:pin, /brain:forget, " +
    "/brain:verify, /brain:sync, /brain:skills, /brain:import, /brain:sleep.",
  codex:
    "Skills: brain-remember, brain-memorize, brain-status, brain-pin, brain-forget, " +
    "brain-verify, brain-sync, brain-skills, brain-import, brain-sleep (or the `brain` CLI directly).",
  unknown: "Use the `brain` CLI (`brain recall`, `brain memorize`, `brain session-start`).",
};

/**
 * Render the injection block. Exported for tests.
 *
 * @param {object} payload   `brain session-start` payload
 * @param {{project: string, host: string}} options
 * @returns {string}
 */
export function buildContext(payload, { project, host }) {
  const count = typeof payload.memory_count === "number" ? payload.memory_count : 0;
  const recall = Array.isArray(payload.context_recall) ? payload.context_recall.length : 0;
  const extras = [];
  if (payload.due_for_review > 0) extras.push(`📋 ${payload.due_for_review} due for review`);
  if (payload.expired_pins > 0) extras.push(`⌛ ${payload.expired_pins} pinned memories expired`);
  if (payload.pending_verification > 0) {
    extras.push(`⊘ ${payload.pending_verification} pending verification — /brain:verify`);
  }
  if (Array.isArray(payload.low_confidence_alerts) && payload.low_confidence_alerts.length > 0) {
    extras.push(`⚠️ ${payload.low_confidence_alerts.length} low-confidence memories used frequently`);
  }
  const statusLine = `◉ Brain active — ${count} memories (${recall} in project context)`;

  return [
    "<brain-session-context>",
    `## Brain Memory — session context (project: ${project})`,
    "Deterministic, budget-bounded payload from `brain session-start`. Internalize it silently; do not recite it.",
    `Begin your first reply with this status line exactly: \`${statusLine}\`` +
      (extras.length ? ` and, on following lines, ${extras.map((e) => `\`${e}\``).join(", ")}.` : "."),
    "- `pinned` entries are active constraints. `context_recall` is relevant past context. " +
      "`skills_index` lists procedural skills — load one only when a task matches it.",
    "- When a memory here materially shapes an answer, end that response with its `receipt` line " +
      "copied verbatim (max 3, at the very end). No memory used → no receipt. Never invent one.",
    "- Store memories with `brain memorize` only when *you* judge something worth remembering " +
      "(decisions, learnings, insights, preferences); never dump transcripts. Recall more with `brain recall \"<query>\"`.",
    "- Every ~10 substantive interactions, if notable decisions or learnings accumulated, append one line " +
      "`◉ Notable <types> this session — /brain:memorize when ready` to a reply. Do not memorize without consent.",
    "- When the session is wrapping up, save a summary entry to `~/.brain/contexts.json` (topics, task type, " +
      "memories created/recalled, notable unsaved items; keep the last 20) and suggest memorizing if warranted.",
    `- ${COMMANDS[host] || COMMANDS.unknown}`,
    "```json",
    JSON.stringify(payload),
    "```",
    "</brain-session-context>",
  ].join("\n");
}

export async function handleSessionStart(input, options = {}) {
  const env = options.env || process.env;
  if (!hasBrain()) return {};
  const { computeSessionStart } = options.sessionStart || loadModule("bin/session-start.js");
  const project = projectFromInput(input);
  const payload = computeSessionStart(undefined, { project, topics: null, task: null, top: 5 });
  const context = buildContext(payload, { project, host: detectHost(env) });
  return contextOutput("SessionStart", context);
}

if (isMain(import.meta.url)) runHook("SessionStart", handleSessionStart);
