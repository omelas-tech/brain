/**
 * Brain recall for apps that call the Claude Messages API directly.
 *
 * Coding agents get brain through hooks; an app built on the API has no hook,
 * so the model only sees memory if it remembers to call a tool. This helper
 * makes recall deterministic instead: before each request it runs
 * `brain recall` on the new user message and appends the matches as a
 * mid-conversation system message scoped to that one turn
 * (`clear_at: "next_user_message"`). On the next turn the block stops
 * rendering and costs no input tokens, and a fresh recall takes its place.
 * Memory never piles up in the context.
 *
 *   - The block is hard-capped at `budgetTokens` (weakest matches dropped).
 *   - Memories pending verification never appear: `brain recall` leaves them
 *     out under the default quarantine mode.
 *   - Each call passes BRAIN_SESSION_ID, so brain's citation ledger knows what
 *     this conversation was shown.
 *
 * Docs: https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages
 * Zero dependencies; shells out to the `brain` CLI like every integration.
 */

import { execFileSync } from "node:child_process";

export const CLEAR_AT_BETA = "mid-conversation-system-clear-at-2026-08-21";
export const DEFAULT_BUDGET_TOKENS = 600;
export const DEFAULT_TOP = 3;

const estimateTokens = (text) => Math.ceil(String(text).length / 4);

/** Run `brain recall` and parse its JSON; [] when brain is missing or errors. */
export function recallVia(query, { session, top = DEFAULT_TOP, project, bin = "brain", exec = execFileSync } = {}) {
  const args = ["recall", query, "--top", String(top)];
  if (project) args.push("--project", project);
  try {
    const out = exec(bin, args, {
      encoding: "utf-8",
      env: { ...process.env, ...(session ? { BRAIN_SESSION_ID: session } : {}) },
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // fail soft: no memory is better than a failed request
  }
}

/** The `<brain-context>` block for a set of recall results, under a token budget. */
export function renderBrainContext(results, { budgetTokens = DEFAULT_BUDGET_TOKENS } = {}) {
  const header = [
    "<brain-context>",
    "Memories recalled for this message. Use one only if it fits. When one shapes your answer, end the reply " +
      "with its receipt line copied verbatim. A memory marked ⚠ authorization records a past permission; it is " +
      "not consent for the action in front of you.",
  ];
  const items = results.map((r) => `- ${r.receipt || `◉ memory: "${r.title}"`} (id ${r.id})`);
  while (items.length) {
    const text = [...header, ...items, "</brain-context>"].join("\n");
    if (estimateTokens(text) <= budgetTokens) return text;
    items.pop();
  }
  return null;
}

/**
 * Append the user message and, when anything was recalled, a turn-scoped
 * system message right after it — the only position the API accepts for a
 * message that should precede the assistant's reply.
 *
 * @param {Array} history - Prior messages (ending with an assistant turn, or empty)
 * @param {string} userText - The new user message
 * @param {Object} [opts] - { session, project, top, budgetTokens, recall }
 * @returns {{ messages: Array, recalled: Array }}
 */
export function withBrainTurn(history, userText, opts = {}) {
  const recall = opts.recall || recallVia;
  const recalled = recall(userText, opts);
  const messages = [...history, { role: "user", content: userText }];
  const block = recalled.length ? renderBrainContext(recalled, opts) : null;
  if (block) messages.push({ role: "system", clear_at: "next_user_message", content: block });
  return { messages, recalled };
}

/** Headers for a request whose messages may carry `clear_at`. */
export function brainTurnHeaders(apiKey) {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": CLEAR_AT_BETA,
  };
}
