import assert from "node:assert/strict";
import { test } from "node:test";
import { mapRecallResults } from "../plugin/src/lib/recall-map.mjs";

const rows = [
  {
    id: "mem-1",
    title: "API auth decision",
    path: "professional/projects/api/auth-decision.md",
    type: "decision",
    score: 0.82,
    relevance: 0.7,
    decayed_strength: 0.88,
    context_match: 0.4,
    spreading_bonus: 0.1,
    confidence: 0.9,
    tags: ["api", "auth"],
  },
  {
    id: "mem-2",
    title: "Half-remembered hunch",
    path: "personal/notes/hunch.md",
    type: "observation",
    score: 0.41,
    relevance: 0.3,
    decayed_strength: 0.2,
    context_match: 0,
    spreading_bonus: 0,
    confidence: 0.3,
    tags: [],
  },
  {
    id: "mem-3",
    title: "Weak match",
    path: "social/friends/weak.md",
    type: "relationship",
    score: 0.12,
    confidence: 0.8,
  },
];

test("maps brain recall rows onto memory_search result shape", () => {
  const { results, ids } = mapRecallResults(rows);
  assert.equal(results.length, 3);
  assert.deepEqual(ids, ["mem-1", "mem-2", "mem-3"]);
  const first = results[0];
  assert.equal(first.corpus, "brain");
  assert.equal(first.path, "professional/projects/api/auth-decision.md");
  assert.equal(first.title, "API auth decision");
  assert.equal(first.kind, "decision");
  assert.equal(first.score, 0.82);
  assert.match(first.snippet, /decision/);
  assert.match(first.snippet, /relevance 0\.70/);
  assert.match(first.snippet, /strength 0\.88/);
  assert.match(first.snippet, /memory_get path="professional\/projects\/api\/auth-decision\.md"/);
  assert.deepEqual(first.tags, ["api", "auth"]);
});

test("minScore filters and maxResults caps", () => {
  const { results } = mapRecallResults(rows, { minScore: 0.4 });
  assert.deepEqual(results.map((r) => r.id), ["mem-1", "mem-2"]);
  const capped = mapRecallResults(rows, { maxResults: 1 });
  assert.deepEqual(capped.results.map((r) => r.id), ["mem-1"]);
});

test("low-confidence memories are flagged", () => {
  const { results, lowConfidenceIds } = mapRecallResults(rows);
  assert.deepEqual(lowConfidenceIds, ["mem-2"]);
  assert.match(results[1].snippet, /LOW CONFIDENCE 0\.30/);
});

test("non-array and junk rows are tolerated", () => {
  assert.deepEqual(mapRecallResults(null).results, []);
  assert.deepEqual(mapRecallResults({ error: "x" }).results, []);
  const { results } = mapRecallResults([null, "junk", { id: "ok", title: "t", path: "p.md", score: 0.5 }]);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "ok");
});
