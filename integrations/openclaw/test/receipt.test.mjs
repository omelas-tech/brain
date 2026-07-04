import assert from "node:assert/strict";
import { test } from "node:test";
import { ageLabel, receiptFor } from "../plugin/src/lib/receipt.mjs";

// Fixed reference clock so every age computation is deterministic. This is
// the ESM port of the brain package's src/receipt.js — the boundary matrix
// below must stay in lockstep with the core test/receipt.test.js.
const NOW = new Date("2026-07-04T12:00:00Z");
const nowFn = () => NOW;

function daysAgo(days) {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

test("ageLabel boundary matrix matches the core formatter", () => {
  const cases = [
    [0, "today"],
    [1, "yesterday"],
    [2, "2d ago"],
    [30, "30d ago"],
    [31, "1mo ago"],
    [335, "11mo ago"],
    [364, "12mo ago"],
    [365, "1y ago"],
    [730, "2y ago"],
  ];
  for (const [days, expected] of cases) {
    assert.equal(ageLabel(daysAgo(days), NOW), expected, `${days}d`);
  }
  assert.equal(ageLabel("not-a-date", NOW), null);
});

test("receiptFor mints the exact documented format", () => {
  assert.equal(
    receiptFor({ title: "Database pooling", type: "learning", created: daysAgo(3) }, nowFn),
    '◉ memory: "Database pooling" (learning, 3d ago)',
  );
});

test("title truncation at 77 chars + ellipsis for >80-char titles", () => {
  const receipt = receiptFor({ title: "b".repeat(81), type: "insight", created: daysAgo(1) }, nowFn);
  assert.equal(receipt, `◉ memory: "${"b".repeat(77)}…" (insight, yesterday)`);
});

test("created falls back to last_accessed; age omitted when neither parses", () => {
  assert.equal(
    receiptFor({ title: "Old habit", type: "preference", last_accessed: daysAgo(2) }, nowFn),
    '◉ memory: "Old habit" (preference, 2d ago)',
  );
  assert.equal(
    receiptFor({ title: "Ageless", type: "observation" }, nowFn),
    '◉ memory: "Ageless" (observation)',
  );
});
