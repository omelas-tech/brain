/**
 * session-format — renders the `brain session-start` aggregator payload into
 * a compact prompt block for injection (system-prompt append or bootstrap
 * context). Deterministic, budget-bounded, and dependency-free so both the
 * plugin entry and copy-installed hook packs can share it.
 *
 * The payload shape (produced by the brain CLI, already budget-bounded on its
 * side):
 *   {
 *     memory_count, pinned: [{id,title,content,scope,priority,tokens}],
 *     skills_index: [{name,description}],
 *     context_recall: [{id,title,path,type,score,token_estimate}],
 *     due_for_review, low_confidence_alerts, budget
 *   }
 */

/** Rough token estimate (~4 chars/token). Used only for budget enforcement. */
export function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

export const DEFAULT_MAX_INJECTION_TOKENS = 1200;

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {any[]}
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Resolve the injection token budget: explicit option > payload budget > default.
 *
 * @param {Record<string, any>} payload
 * @param {{maxTokens?: number}} [options]
 */
export function resolveInjectionBudget(payload, options = {}) {
  if (options.maxTokens && options.maxTokens > 0) return options.maxTokens;
  const budget = isRecord(payload?.budget) ? payload.budget : {};
  const candidates = [budget.max_injection_tokens, budget.working_memory_tokens, budget.max_tokens];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && candidate > 0) return candidate;
  }
  return DEFAULT_MAX_INJECTION_TOKENS;
}

/**
 * Render the session-start payload into a markdown block, or return null when
 * there is nothing worth injecting (no brain, empty payload).
 *
 * Sections are added in priority order (status, pinned, recall, skills,
 * alerts); lower-priority lines are dropped first when the budget is tight.
 *
 * @param {unknown} rawPayload  Parsed JSON from `brain session-start`.
 * @param {{maxTokens?: number, project?: string}} [options]
 * @returns {string | null}
 */
export function formatSessionStartBlock(rawPayload, options = {}) {
  if (!isRecord(rawPayload)) return null;
  const payload = rawPayload;
  const memoryCount = typeof payload.memory_count === "number" ? payload.memory_count : 0;
  const pinned = asArray(payload.pinned);
  const skills = asArray(payload.skills_index);
  const recall = asArray(payload.context_recall);
  if (memoryCount === 0 && pinned.length === 0 && recall.length === 0 && skills.length === 0) {
    return null;
  }

  const maxTokens = resolveInjectionBudget(payload, options);
  const projectLabel = options.project ? ` — project: ${options.project}` : "";

  /**
   * Chunks in priority order. Each chunk is either kept whole or, for list
   * chunks, truncated item-by-item from the end.
   * @type {{priority: number, lines: string[], listStart?: number}[]}
   */
  const chunks = [];

  chunks.push({
    priority: 0,
    lines: [
      "## Brain memory — session context" + projectLabel,
      `Brain active: ${memoryCount} memories, ${recall.length} relevant to this context. ` +
        "Internalize the facts below silently — do not recite them to the user.",
      "",
    ],
  });

  if (pinned.length > 0) {
    const lines = ["### Pinned (always apply)"];
    for (const pin of pinned) {
      if (!isRecord(pin)) continue;
      const title = String(pin.title || pin.id || "pinned memory");
      const content = typeof pin.content === "string" ? pin.content.trim() : "";
      lines.push(content ? `- **${title}**: ${content}` : `- **${title}**`);
    }
    lines.push("");
    chunks.push({ priority: 1, lines, listStart: 1 });
  }

  if (recall.length > 0) {
    const lines = ["### Relevant memories (read with memory_get <path> when needed)"];
    for (const mem of recall) {
      if (!isRecord(mem)) continue;
      const title = String(mem.title || mem.id || "memory");
      const type = mem.type ? String(mem.type) : "memory";
      const score = typeof mem.score === "number" ? mem.score.toFixed(2) : undefined;
      const path = mem.path ? String(mem.path) : undefined;
      const scorePart = score ? `, score ${score}` : "";
      lines.push(`- ${title} (${type}${scorePart})${path ? ` — ${path}` : ""}`);
    }
    lines.push("");
    chunks.push({ priority: 2, lines, listStart: 1 });
  }

  if (skills.length > 0) {
    const lines = ["### Procedural skills on file (recall the skill before matching tasks)"];
    for (const skill of skills) {
      if (!isRecord(skill)) continue;
      const name = String(skill.name || "skill");
      const description = skill.description ? String(skill.description) : "";
      lines.push(description ? `- ${name} — ${description}` : `- ${name}`);
    }
    lines.push("");
    chunks.push({ priority: 3, lines, listStart: 1 });
  }

  const alerts = [];
  if (typeof payload.due_for_review === "number" && payload.due_for_review > 0) {
    alerts.push(`- ${payload.due_for_review} memories due for review (reinforced during brain sleep).`);
  }
  const lowConfidence = asArray(payload.low_confidence_alerts);
  if (lowConfidence.length > 0) {
    alerts.push(
      `- ${lowConfidence.length} frequently-used low-confidence memories — verify before relying on them.`,
    );
  }
  if (alerts.length > 0) {
    chunks.push({ priority: 4, lines: ["### Alerts", ...alerts, ""] });
  }

  // Assemble under budget: keep chunks in document order, but when over
  // budget, trim list items from the lowest-priority chunks first.
  const assemble = () => chunks.map((chunk) => chunk.lines.join("\n")).join("\n").trimEnd();
  let text = assemble();
  if (estimateTokens(text) > maxTokens) {
    const trimmable = [...chunks]
      .filter((chunk) => chunk.listStart !== undefined)
      .sort((a, b) => b.priority - a.priority);
    for (const chunk of trimmable) {
      while (
        estimateTokens(assemble()) > maxTokens &&
        chunk.lines.length > (chunk.listStart ?? 1) + 1
      ) {
        // Drop the last list item (keep header + trailing blank line).
        chunk.lines.splice(chunk.lines.length - 2, 1);
      }
      if (estimateTokens(assemble()) <= maxTokens) break;
    }
    text = assemble();
    // Last resort: hard character cut (should be rare — the CLI pre-bounds).
    const maxChars = maxTokens * 4;
    if (text.length > maxChars) text = text.slice(0, maxChars);
  }
  return text;
}
