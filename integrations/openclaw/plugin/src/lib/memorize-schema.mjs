/**
 * memorize-schema — JSON Schema and validation for the `brain_memorize` tool.
 *
 * Mirrors the stdin contract of `brain memorize` (bin/memorize.js): the model
 * decides WHAT to remember and how to classify it; the CLI handles all file
 * plumbing. Validation here exists to give the model actionable error
 * messages before we shell out, and to keep obviously malformed paths from
 * ever reaching the filesystem layer.
 */

export const MEMORY_TYPES = [
  "decision",
  "insight",
  "goal",
  "experience",
  "learning",
  "relationship",
  "preference",
  "observation",
];

export const COGNITIVE_TYPES = ["episodic", "semantic", "procedural"];

/** JSON Schema for the brain_memorize tool parameters. */
export const MEMORIZE_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["memories"],
  properties: {
    memories: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "type", "path", "content"],
        properties: {
          title: { type: "string", description: "Short descriptive title" },
          type: {
            type: "string",
            enum: MEMORY_TYPES,
            description: "Memory type — sets base strength and decay",
          },
          path: {
            type: "string",
            description:
              'Relative path under ~/.brain, organized by life domain, e.g. "personal/health/sleep-routine.md" or "professional/projects/foo/decision.md"',
          },
          content: { type: "string", description: "Markdown body of the memory" },
          cognitive_type: { type: "string", enum: COGNITIVE_TYPES },
          salience: { type: "number", minimum: 0, maximum: 1 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          strength_adjustment: { type: "number", minimum: -0.15, maximum: 0.15 },
          tags: { type: "array", items: { type: "string" } },
          related: { type: "array", items: { type: "string" }, description: "Related memory IDs" },
          source: { type: "string" },
          encoding_context: {
            type: "object",
            additionalProperties: false,
            properties: {
              project: { type: "string" },
              topics: { type: "array", items: { type: "string" } },
              task_type: { type: "string" },
            },
          },
          pinned: { type: "boolean", description: "Always inject at session start (decay-exempt)" },
          pin_scope: { type: "string", description: 'e.g. "global" or "project:<name>"' },
          pin_priority: { type: "integer" },
        },
      },
    },
  },
};

/**
 * Validate + normalize a brain_memorize tool call payload.
 *
 * @param {unknown} input
 * @returns {{ok: true, payload: {memories: object[]}} | {ok: false, errors: string[]}}
 */
export function validateMemorizePayload(input) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["payload must be an object with a `memories` array"] };
  }
  const memories = /** @type {Record<string, any>} */ (input).memories;
  if (!Array.isArray(memories) || memories.length === 0) {
    return { ok: false, errors: ["`memories` must be a non-empty array"] };
  }

  const normalized = [];
  memories.forEach((memory, index) => {
    const label = `memories[${index}]`;
    if (!memory || typeof memory !== "object" || Array.isArray(memory)) {
      errors.push(`${label}: must be an object`);
      return;
    }
    const mem = /** @type {Record<string, any>} */ (memory);
    for (const field of ["title", "type", "path", "content"]) {
      if (typeof mem[field] !== "string" || mem[field].trim().length === 0) {
        errors.push(`${label}.${field}: required non-empty string`);
      }
    }
    if (typeof mem.type === "string" && !MEMORY_TYPES.includes(mem.type)) {
      errors.push(`${label}.type: must be one of ${MEMORY_TYPES.join("|")}`);
    }
    if (mem.cognitive_type !== undefined && !COGNITIVE_TYPES.includes(mem.cognitive_type)) {
      errors.push(`${label}.cognitive_type: must be one of ${COGNITIVE_TYPES.join("|")}`);
    }
    if (typeof mem.path === "string") {
      const pathError = validateMemoryPath(mem.path);
      if (pathError) errors.push(`${label}.path: ${pathError}`);
    }
    for (const field of ["salience", "confidence"]) {
      if (mem[field] !== undefined && !(typeof mem[field] === "number" && mem[field] >= 0 && mem[field] <= 1)) {
        errors.push(`${label}.${field}: must be a number between 0 and 1`);
      }
    }
    if (
      mem.strength_adjustment !== undefined &&
      !(typeof mem.strength_adjustment === "number" && Math.abs(mem.strength_adjustment) <= 0.15)
    ) {
      errors.push(`${label}.strength_adjustment: must be a number between -0.15 and 0.15`);
    }
    for (const field of ["tags", "related"]) {
      if (mem[field] !== undefined && !Array.isArray(mem[field])) {
        errors.push(`${label}.${field}: must be an array of strings`);
      }
    }
    normalized.push(mem);
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, payload: { memories: normalized } };
}

/**
 * Reject paths that could escape the brain directory. The brain CLI performs
 * its own validation too (validateBrainPath) — this is defense in depth with
 * model-friendly messaging.
 *
 * @param {string} value
 * @returns {string | null} error message or null when valid
 */
export function validateMemoryPath(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return "must be relative to ~/.brain (no absolute paths)";
  }
  if (trimmed.startsWith("~")) return "must be relative to ~/.brain (no ~ expansion)";
  const segments = trimmed.split(/[\\/]+/);
  if (segments.some((segment) => segment === "..")) return "must not contain '..' segments";
  if (!trimmed.endsWith(".md")) return "must end with .md";
  return null;
}
