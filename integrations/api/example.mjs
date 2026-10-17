#!/usr/bin/env node
/**
 * A minimal chat loop over the Messages API with brain recall on every turn.
 *
 *   ANTHROPIC_API_KEY=… node integrations/api/example.mjs "what did we decide about the orders database?"
 *
 * Needs the `brain` CLI on PATH and a model that supports `clear_at`
 * (e.g. claude-sonnet-5-5, claude-opus-5-5, claude-haiku-5-5).
 */

import { brainTurnHeaders, withBrainTurn } from "./brain-turn.mjs";

const model = process.env.BRAIN_API_MODEL || "claude-sonnet-5-5";
const question = process.argv.slice(2).join(" ") || "What do you remember about this project?";
const session = `api-${Date.now()}`;

const { messages, recalled } = withBrainTurn([], question, { session });
console.error(`brain: ${recalled.length} memor${recalled.length === 1 ? "y" : "ies"} recalled`);

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: brainTurnHeaders(process.env.ANTHROPIC_API_KEY),
  body: JSON.stringify({ model, max_tokens: 1024, messages }),
});
const body = await res.json();
if (!res.ok) {
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}
console.log(body.content.filter((b) => b.type === "text").map((b) => b.text).join("\n"));
