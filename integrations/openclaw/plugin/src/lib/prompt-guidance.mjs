/**
 * prompt-guidance — static instruction text for the brain-memory plugin.
 *
 * Ported from the brain plugin's ambient prompt (prompts/claude.md) and
 * trimmed for OpenClaw's personal-assistant context: life domains matter here
 * (personal, family, social, professional), not just coding sessions. Static
 * guidance is kept separate from the per-session payload so it can ride the
 * provider's prompt cache.
 */

/**
 * Memory prompt-section lines (registered via registerMemoryCapability's
 * promptBuilder). Mirrors memory-core's contract: return [] when none of our
 * tools are exposed to the agent.
 *
 * @param {{availableTools: Set<string>}} params
 * @returns {string[]}
 */
export function buildBrainPromptSection({ availableTools }) {
  const hasSearch = availableTools.has("memory_search");
  const hasGet = availableTools.has("memory_get");
  const hasMemorize = availableTools.has("brain_memorize");
  if (!hasSearch && !hasGet && !hasMemorize) return [];

  const lines = ["## Brain Memory"];
  lines.push(
    "You have a persistent, neuroscience-inspired memory (the user's brain in ~/.brain, shared across their AI agents). Memories strengthen when recalled and decay when ignored.",
  );
  if (hasSearch) {
    lines.push(
      "- Recall first: before answering anything about prior conversations, decisions, dates, people, preferences, routines, or todos, run memory_search. Scoring is deterministic (relevance + decayed strength + context match + spreading activation); recalled memories are automatically reinforced.",
    );
  }
  if (hasGet) {
    lines.push(
      "- memory_get <path> reads the full memory body — pull only the memories you actually need.",
    );
  }
  if (hasMemorize) {
    lines.push(
      "- Store as you go: when a durable decision, learning, insight, experience, goal, relationship, or preference emerges, call brain_memorize. Cover all life domains — personal/ (health, routines, finances), family/ (people, events), social/, professional/ — not just work.",
      "- Classify honestly: type sets strength/decay (decision 0.85, insight 0.90, goal 0.80, experience 0.75, learning 0.70, relationship 0.70, preference 0.60, observation 0.40); cognitive_type is episodic (events), semantic (facts), or procedural (skills).",
      "- Do not auto-store trivia, secrets, or credentials. Propose pinning (pinned: true) only for durable conventions the user confirms.",
    );
  }
  lines.push(
    "- Ambient awareness: internalize recalled context silently; never dump memory contents unless asked.",
    "",
  );
  return lines;
}

/** Silent-reply token used by OpenClaw's memory flush turns. */
export const SILENT_REPLY_TOKEN = "NO_REPLY";

/**
 * Pre-compaction flush prompt: instead of memory-core's "append to
 * memory/YYYY-MM-DD.md", we ask for a brain_memorize pass so memories land in
 * the brain with proper typing, strength, and associations.
 */
export function buildFlushPrompt() {
  return [
    "Pre-compaction memory flush.",
    "The session is close to auto-compaction. Review the conversation for durable decisions, learnings, insights, experiences, goals, relationships, and preferences that are NOT yet stored, and store them now with a single brain_memorize call (well-classified: type, cognitive_type, life-domain path, tags, salience).",
    "Skip trivia, transient state, secrets, and anything already memorized this session.",
    `If nothing is worth storing, reply with ${SILENT_REPLY_TOKEN}.`,
  ].join(" ");
}

export function buildFlushSystemPrompt() {
  return [
    "Pre-compaction memory flush turn for the brain-memory plugin.",
    "Capture durable memories via the brain_memorize tool before context is compacted.",
    "Do not edit workspace files; brain_memorize is the only storage mechanism for this flush.",
    `You may reply, but usually ${SILENT_REPLY_TOKEN} is correct.`,
  ].join(" ");
}
