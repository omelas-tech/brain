import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_MAX_INJECTION_TOKENS,
  estimateTokens,
  formatSessionStartBlock,
  resolveInjectionBudget,
} from "../plugin/src/lib/session-format.mjs";

const payload = {
  memory_count: 42,
  pinned: [
    { id: "mem-1", title: "Vegetarian", content: "Never suggest meat dishes.", scope: "global", priority: 1 },
    { id: "mem-2", title: "Timezone", content: "Europe/Istanbul.", scope: "global", priority: 2 },
  ],
  skills_index: [{ name: "weekly-review", description: "Runs the Sunday weekly review flow" }],
  context_recall: [
    { id: "mem-3", title: "Prefers concise answers", path: "personal/preferences/concise.md", type: "preference", score: 0.81 },
    { id: "mem-4", title: "Summer trip planning", path: "family/events/2026-summer-trip.md", type: "goal", score: 0.63 },
  ],
  due_for_review: 3,
  low_confidence_alerts: [{ id: "mem-9" }],
  budget: { max_injection_tokens: 900 },
};

test("renders status, pinned, recall, skills, and alerts", () => {
  const block = formatSessionStartBlock(payload, { project: "openclaw" });
  assert.ok(block, "expected a block");
  assert.match(block, /Brain memory — session context — project: openclaw/);
  assert.match(block, /42 memories/);
  assert.match(block, /Pinned \(always apply\)/);
  assert.match(block, /\*\*Vegetarian\*\*: Never suggest meat dishes\./);
  assert.match(block, /Prefers concise answers \(preference, score 0\.81\) — personal\/preferences\/concise\.md/);
  assert.match(block, /weekly-review — Runs the Sunday weekly review flow/);
  assert.match(block, /3 memories due for review/);
  assert.match(block, /1 frequently-used low-confidence/);
});

test("empty or absent payload yields null (nothing injected)", () => {
  assert.equal(formatSessionStartBlock(null), null);
  assert.equal(formatSessionStartBlock(undefined), null);
  assert.equal(formatSessionStartBlock("not-json"), null);
  assert.equal(
    formatSessionStartBlock({ memory_count: 0, pinned: [], skills_index: [], context_recall: [] }),
    null,
  );
});

test("budget resolution: option > payload budget > default", () => {
  assert.equal(resolveInjectionBudget(payload, { maxTokens: 50 }), 50);
  assert.equal(resolveInjectionBudget(payload), 900);
  assert.equal(resolveInjectionBudget({}), DEFAULT_MAX_INJECTION_TOKENS);
});

test("token budget is respected — long payloads get truncated", () => {
  const bloated = {
    ...payload,
    context_recall: Array.from({ length: 200 }, (_, index) => ({
      id: `mem-${index}`,
      title: `A fairly long recalled memory title number ${index} with plenty of words`,
      path: `professional/projects/thing-${index}/notes.md`,
      type: "learning",
      score: 0.5,
    })),
    skills_index: Array.from({ length: 50 }, (_, index) => ({
      name: `skill-${index}`,
      description: `Description for procedural skill number ${index}, moderately verbose`,
    })),
  };
  const maxTokens = 300;
  const block = formatSessionStartBlock(bloated, { maxTokens });
  assert.ok(block);
  assert.ok(
    estimateTokens(block) <= maxTokens,
    `expected <= ${maxTokens} tokens, got ${estimateTokens(block)}`,
  );
  // Pinned facts (highest priority) must survive truncation.
  assert.match(block, /\*\*Vegetarian\*\*/);
});

test("malformed rows are skipped without crashing", () => {
  const messy = {
    memory_count: 1,
    pinned: [null, 42, { title: "Real pin", content: "kept" }],
    skills_index: ["nope"],
    context_recall: [{ title: "ok", path: "p.md", type: "learning", score: "high" }],
  };
  const block = formatSessionStartBlock(messy);
  assert.ok(block);
  assert.match(block, /Real pin/);
  assert.match(block, /ok \(learning\)/);
});
