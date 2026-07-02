import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MEMORIZE_TOOL_SCHEMA,
  MEMORY_TYPES,
  validateMemorizePayload,
  validateMemoryPath,
} from "../plugin/src/lib/memorize-schema.mjs";

const validMemory = {
  title: "Prefers morning workouts",
  type: "preference",
  cognitive_type: "semantic",
  path: "personal/health/workout-preference.md",
  content: "# Morning Workouts\n\nTrain before 8am.\n",
  tags: ["health"],
  salience: 0.6,
  confidence: 0.9,
  encoding_context: { project: "openclaw", topics: ["fitness"], task_type: "conversation" },
};

test("valid payload passes and is returned normalized", () => {
  const result = validateMemorizePayload({ memories: [validMemory] });
  assert.equal(result.ok, true);
  assert.equal(result.payload.memories.length, 1);
  assert.equal(result.payload.memories[0].title, validMemory.title);
});

test("missing required fields are all reported", () => {
  const result = validateMemorizePayload({ memories: [{ title: "x" }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes(".type")));
  assert.ok(result.errors.some((e) => e.includes(".path")));
  assert.ok(result.errors.some((e) => e.includes(".content")));
});

test("unknown memory type is rejected", () => {
  const result = validateMemorizePayload({ memories: [{ ...validMemory, type: "vibe" }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("must be one of")));
});

test("bad cognitive_type, salience, and strength_adjustment are rejected", () => {
  const result = validateMemorizePayload({
    memories: [
      { ...validMemory, cognitive_type: "kinetic", salience: 1.5, strength_adjustment: 0.5 },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("cognitive_type")));
  assert.ok(result.errors.some((e) => e.includes("salience")));
  assert.ok(result.errors.some((e) => e.includes("strength_adjustment")));
});

test("non-array or empty memories rejected", () => {
  assert.equal(validateMemorizePayload({}).ok, false);
  assert.equal(validateMemorizePayload({ memories: [] }).ok, false);
  assert.equal(validateMemorizePayload(null).ok, false);
  assert.equal(validateMemorizePayload("x").ok, false);
});

test("path traversal and absolute paths are rejected", () => {
  assert.ok(validateMemoryPath("../escape.md"));
  assert.ok(validateMemoryPath("personal/../../escape.md"));
  assert.ok(validateMemoryPath("/etc/passwd.md"));
  assert.ok(validateMemoryPath("~/oops.md"));
  assert.ok(validateMemoryPath("C:\\windows\\oops.md"));
  assert.ok(validateMemoryPath("personal/notes.txt")); // must be .md
  assert.equal(validateMemoryPath("personal/health/sleep.md"), null);
  assert.equal(validateMemoryPath("family/events/2026-trip.md"), null);

  const result = validateMemorizePayload({
    memories: [{ ...validMemory, path: "../../etc/cron.md" }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes(".path")));
});

test("tool JSON schema mirrors the stdin contract", () => {
  assert.equal(MEMORIZE_TOOL_SCHEMA.type, "object");
  assert.deepEqual(MEMORIZE_TOOL_SCHEMA.required, ["memories"]);
  const item = MEMORIZE_TOOL_SCHEMA.properties.memories.items;
  assert.deepEqual(item.required, ["title", "type", "path", "content"]);
  assert.deepEqual(item.properties.type.enum, MEMORY_TYPES);
  for (const field of [
    "cognitive_type",
    "salience",
    "confidence",
    "tags",
    "related",
    "source",
    "encoding_context",
    "pinned",
    "pin_scope",
    "pin_priority",
  ]) {
    assert.ok(field in item.properties, `schema missing ${field}`);
  }
  // The whole schema must be JSON-serializable (it is sent to providers).
  assert.ok(JSON.parse(JSON.stringify(MEMORIZE_TOOL_SCHEMA)));
});
