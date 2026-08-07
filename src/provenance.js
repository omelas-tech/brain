/**
 * Brain Memory — Provenance Policy (OWASP ASI06: memory poisoning)
 *
 * Single source of truth for what a memory's origin allows it to claim — at
 * write time (bin/memorize.js clamps salience/confidence and refuses
 * entrenchment) and at recall time (src/scorer.js weighs trust into ranking,
 * bin/recall.js and bin/session-start.js flag low-trust results).
 *
 * The failure mode this defends against: content the agent *read* (an email, a
 * web page, a tool result) persuades it to write a fact, and that fact then
 * hardens — pinned into every session, exempt from decay, immune to pruning,
 * never flagged as uncertain, and boosted by its own planted neighbors at
 * recall. See MemGhost (arXiv:2607.05189).
 *
 * `origin` is asserted by the caller, so it does not defend against a fully
 * hostile agent — but the dominant real case is an *honest* agent relaying
 * poisoned content, and there it holds.
 */

const ORIGIN_POLICY = {
  // The user asked for this directly, in-session.
  user: { max_salience: 1.0, max_confidence: 1.0, allow_entrench: true, decay_multiplier: 1.0, trust_factor: 1.0 },
  // The agent inferred or summarized it from session context. Default.
  'agent-inferred': { max_salience: 0.6, max_confidence: 0.8, allow_entrench: false, decay_multiplier: 1.0, trust_factor: 0.95 },
  // Derived from tool output — file reads, command results, MCP responses.
  'tool-output': { max_salience: 0.5, max_confidence: 0.6, allow_entrench: false, decay_multiplier: 0.997, trust_factor: 0.85 },
  // Derived from untrusted external content — email, web pages, issue text.
  external: { max_salience: 0.4, max_confidence: 0.4, allow_entrench: false, decay_multiplier: 0.99, trust_factor: 0.75 },
};

// Absent origin means the agent didn't tell us — assume the weaker claim, never
// the stronger one. A memory that deserves `user` is one keystroke away.
const DEFAULT_ORIGIN = 'agent-inferred';

// Salience >= 0.7 is exempt from auto-pruning, so every non-user ceiling sits
// below it: an unattended poisoned memory must remain collectable.
const PRUNE_EXEMPT_SALIENCE = 0.7;

// Origins whose content came from outside the user/agent dialogue — surfaced
// with a low_trust flag at recall and a ⚠ marker on receipts.
const LOW_TRUST_ORIGINS = new Set(['tool-output', 'external']);

/**
 * Recall-time trust weight for an origin (0.75-1.0).
 *
 * Applied as a multiplier on the composite recall score and on spreading-
 * activation source strength. Trust bounds *entrenchment and volume*, not
 * relevance: a genuinely more relevant external memory can still rank first —
 * it just can't get there on bulk or clique self-amplification.
 *
 * Unknown/missing origins weigh as DEFAULT_ORIGIN: legacy memories (written
 * before origin existed) rank exactly as if memorize had stamped its default,
 * so their relative order is unchanged.
 *
 * @param {string} [origin] - Memory origin (frontmatter/index `origin` field)
 * @returns {number} Trust factor
 */
function trustFactor(origin) {
  const policy = ORIGIN_POLICY[origin] || ORIGIN_POLICY[DEFAULT_ORIGIN];
  return policy.trust_factor;
}

/**
 * Whether an origin is low-trust (content sourced outside the dialogue).
 *
 * @param {string} [origin] - Memory origin
 * @returns {boolean}
 */
function isLowTrust(origin) {
  return LOW_TRUST_ORIGINS.has(origin);
}

module.exports = {
  ORIGIN_POLICY,
  DEFAULT_ORIGIN,
  PRUNE_EXEMPT_SALIENCE,
  trustFactor,
  isLowTrust,
};
