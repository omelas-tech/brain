#!/usr/bin/env node
/**
 * UserPromptSubmit hook (Claude Code + Codex plugin hosts).
 *
 * Runs the deterministic recall engine against the user's prompt and injects
 * the best matches as `additionalContext` — brain's memories arrive with the
 * prompt instead of waiting for the model to decide to call `brain recall`.
 *
 * Conservative by design, because it fires on every prompt:
 *   - explicit-query recall applies the relevance floor, so unrelated prompts
 *     inject nothing at all;
 *   - `prompt_recall_top` / `prompt_recall_budget_tokens` in ~/.brain/config.json
 *     bound the injection (defaults 3 memories, 600 tokens);
 *   - short prompts, bare slash commands and yes/no acknowledgements are skipped.
 *
 * Nothing is reinforced here: strength grows only when the model actually
 * uses a memory (`brain reinforce`), never because a hook surfaced it.
 * The block is wrapped in <brain-context> so `brain import` can strip it.
 */

import fs from "node:fs";
import path from "node:path";

import { brainDir, contextOutput, estimateTokens, hasBrain, isMain, loadModule, projectFromInput, runHook } from "./lib.mjs";

export const MIN_PROMPT_CHARS = 12;
export const MAX_QUERY_CHARS = 2000;
export const EXCERPT_CHARS = 240;

const SKIP_PROMPTS = [
  /^\s*\/[a-z0-9:_-]+\s*$/i, // a bare slash command
  /^\s*(y|n|yes|no|ok|okay|k|sure|thanks|thank you|ty|continue|go|go ahead|proceed|yep|yeah|nope)\b[.!]*\s*$/i,
];

/** Prompts worth a recall pass: long enough, and not a command or an ack. */
export function shouldRecall(prompt) {
  if (typeof prompt !== "string") return false;
  const text = prompt.trim();
  if (text.length < MIN_PROMPT_CHARS) return false;
  return !SKIP_PROMPTS.some((pattern) => pattern.test(text));
}

/** First EXCERPT_CHARS of a memory body (frontmatter removed), single-line. */
export function excerptOf(fileContent) {
  let body = String(fileContent || "");
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) body = body.slice(end + 4);
  }
  body = body.replace(/^#+\s.*$/m, "").replace(/\s+/g, " ").trim();
  if (body.length <= EXCERPT_CHARS) return body;
  const cut = body.slice(0, EXCERPT_CHARS);
  const space = cut.lastIndexOf(" ");
  return (space > EXCERPT_CHARS * 0.6 ? cut.slice(0, space) : cut).trimEnd() + "…";
}

function flagsOf(result) {
  const flags = [];
  if (result.low_trust) flags.push("⚠ low-trust");
  if (result.quarantine_pending) flags.push("⊘ unverified");
  if (result.expired) flags.push("⌛ expired");
  if (result.superseded_by) flags.push("↪ superseded");
  return flags.length ? ` [${flags.join(", ")}]` : "";
}

/**
 * Render the injection block under a token budget, dropping the weakest
 * matches first. Returns null when nothing fits.
 *
 * @param {Array<{receipt?: string, title?: string, excerpt?: string}>} entries
 * @param {{budget: number}} options
 */
export function buildContext(entries, { budget }) {
  const header = [
    "<brain-context>",
    "◉ Brain recall for this prompt (deterministic). Use a memory only if it fits; when one shapes your answer, " +
      "end the reply with its receipt line copied verbatim and run `brain reinforce <id>`.",
  ];
  const footer = ["</brain-context>"];
  const items = entries.map((entry) => {
    const label = entry.receipt || `◉ memory: "${entry.title || entry.id}"`;
    return `- ${label}${flagsOf(entry)}${entry.excerpt ? ` — ${entry.excerpt}` : ""} (id ${entry.id})`;
  });
  while (items.length > 0) {
    const text = [...header, ...items, ...footer].join("\n");
    if (estimateTokens(text) <= budget) return text;
    items.pop();
  }
  return null;
}

function readBody(memPath) {
  try {
    return fs.readFileSync(path.join(brainDir(), memPath), "utf-8");
  } catch {
    return "";
  }
}

export async function handlePrompt(input, options = {}) {
  if (!hasBrain()) return {};
  const record = input && typeof input === "object" ? input : {};
  if (!shouldRecall(record.prompt)) return {};

  const config = (options.indexManager || loadModule("src/index-manager.js")).readConfig();
  const top = Number(config.prompt_recall_top);
  const budget = Number(config.prompt_recall_budget_tokens);
  if (!(top > 0) || !(budget > 0)) return {};

  const { computeRecall } = options.recall || loadModule("bin/recall.js");
  const results = computeRecall({
    query: record.prompt.trim().slice(0, MAX_QUERY_CHARS),
    project: projectFromInput(record),
    top,
  });
  if (!results.length) return {};

  const entries = results.map((r) => ({ ...r, excerpt: excerptOf(readBody(r.path)) }));
  const context = buildContext(entries, { budget });
  return context ? contextOutput("UserPromptSubmit", context) : {};
}

if (isMain(import.meta.url)) runHook("UserPromptSubmit", handlePrompt);
