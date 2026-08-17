/**
 * Brain Memory — Bitemporal Validity (valid time vs record time)
 *
 * Two independent time axes per memory, the distinction the flat model can't
 * make:
 *
 *   record time — WHEN THE BRAIN LEARNED IT.  `created` (already on every
 *                 memory). Immutable; the audit axis.
 *   valid time  — WHEN THE FACT WAS TRUE.     `valid_from` / `valid_until`.
 *                 Optional, half-open [from, until): a memory is current at
 *                 instant t when from <= t < until. Either bound may be absent
 *                 (unbounded in that direction) — absent is the default, and a
 *                 memory with neither is simply "true as far as we know".
 *
 * Why it matters: "we deploy to Fly.io" recorded in June and "we deploy to
 * Render" recorded in August are not a contradiction to resolve — they are one
 * fact with a boundary. Without valid time, recall can only rank them; with it,
 * recall can answer "what was true in July" exactly, and say when a fact
 * stopped being true rather than quietly serving a stale one.
 *
 * Relationship to supersession: `supersedes`/`superseded_by` is the *pointer*
 * (this fact replaced that one); valid time is the *interval* it implies. When
 * B supersedes A, A's `valid_until` is stamped with B's start — see
 * applySupersession — so the existing corpus gains real validity windows
 * without re-authoring a single memory. A stamp made this way is marked
 * `valid_until_auto` so it can be withdrawn if the successor is later archived,
 * while an interval the author set by hand is never touched.
 *
 * Recall (src/scorer.js) uses this three ways:
 *   - default:        expired memories are demoted, not dropped ("that was
 *                     true until August" stays answerable)
 *   - --as-of T:      valid-time travel — only facts whose window contains T
 *   - --as-known-of T: record-time travel — only memories created by T
 * Passing both reconstructs exactly what the brain believed, and when.
 */

const { setFrontmatterFields } = require('./pinning');

// Demotion applied to a memory whose validity window has elapsed. Matched to
// SUPERSEDED_PENALTY in src/scorer.js: both mean "no longer current", and a
// memory carrying both signals must not be demoted twice (the scorer takes the
// strongest single penalty, never the product).
const EXPIRED_PENALTY = 0.25;

/**
 * Parse a timestamp into epoch ms, tolerating the shapes that reach us from
 * frontmatter, JSON payloads, and CLI flags (ISO instants, plain YYYY-MM-DD).
 *
 * @param {string|number|Date} [value]
 * @returns {number|null} Epoch ms, or null when absent/unparseable
 */
function parseInstant(value) {
  if (value == null || value === '') return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * The validity window of a memory, as epoch ms bounds (null = unbounded).
 *
 * @param {Object} mem - Memory or index entry
 * @returns {{from: number|null, until: number|null}}
 */
function validityOf(mem) {
  return {
    from: parseInstant(mem && mem.valid_from),
    until: parseInstant(mem && mem.valid_until),
  };
}

/**
 * Where an instant falls relative to a memory's validity window.
 *
 * Half-open [from, until): a fact that stopped being true at 09:00 is not true
 * at 09:00. Memories with no window are always 'current'.
 *
 * @param {Object} mem - Memory or index entry
 * @param {number} at - Epoch ms
 * @returns {'future'|'current'|'expired'}
 */
function temporalState(mem, at) {
  const { from, until } = validityOf(mem);
  if (from != null && at < from) return 'future';
  if (until != null && at >= until) return 'expired';
  return 'current';
}

/** True when the memory's validity window contains `at`. */
function isValidAt(mem, at) {
  return temporalState(mem, at) === 'current';
}

/**
 * Validate an author-supplied validity window.
 *
 * An inverted or unparseable interval is rejected at write time rather than
 * silently stored: a bad window would make the memory invisible to every
 * as-of query, which is far harder to notice than a failed write.
 *
 * @param {Object} mem - Raw memory payload
 * @returns {{error: string}|null}
 */
function validateValidity(mem) {
  for (const field of ['valid_from', 'valid_until']) {
    if (mem[field] == null || mem[field] === '') continue;
    if (parseInstant(mem[field]) == null) {
      return { error: `Invalid ${field}: ${JSON.stringify(mem[field])} — expected an ISO date or timestamp` };
    }
  }
  const { from, until } = validityOf(mem);
  if (from != null && until != null && until <= from) {
    return { error: `valid_until (${mem.valid_until}) must be after valid_from (${mem.valid_from})` };
  }
  return null;
}

/**
 * The instant at which a successor takes over from what it replaces — its own
 * `valid_from` when the author gave one, else when it was recorded.
 *
 * @param {Object} successor - The superseding memory (needs valid_from/created)
 * @returns {string|null} ISO instant, or null when neither is parseable
 */
function supersessionInstant(successor) {
  for (const candidate of [successor && successor.valid_from, successor && successor.created]) {
    const t = parseInstant(candidate);
    if (t != null) return new Date(t).toISOString();
  }
  return null;
}

/**
 * Stamp supersession onto the memories a successor replaces: the
 * `superseded_by` back-pointer, plus the valid-time boundary it implies.
 *
 * `valid_until` is only stamped when the target has no window of its own — an
 * author-set interval always wins — and an automatic stamp is marked
 * `valid_until_auto` so clearSupersessionsBy can withdraw it later without
 * touching hand-authored data.
 *
 * Mutates `index` in place and mirrors into frontmatter; the caller writes the
 * index. Unknown target ids are skipped silently (they may have been forgotten).
 *
 * @param {string} brainDir
 * @param {Object} index - Live index (mutated)
 * @param {string} successorId
 * @param {string[]} targetIds
 * @param {Object} [opts] - { validUntil: ISO instant the successor starts at }
 * @returns {Array<{id: string, title: string}>} Targets actually stamped
 */
function applySupersession(brainDir, index, successorId, targetIds, opts = {}) {
  const { validUntil = null } = opts;
  const applied = [];

  for (const targetId of targetIds || []) {
    const target = index.memories[targetId];
    if (!target) continue;

    target.superseded_by = successorId;
    const fields = { superseded_by: successorId };

    // Valid-time edge: the predecessor stopped being true when its successor
    // started being true. Never overwrite an explicit window.
    if (validUntil && !target.valid_until) {
      target.valid_until = validUntil;
      target.valid_until_auto = true;
      fields.valid_until = validUntil;
      fields.valid_until_auto = true;
    }

    setFrontmatterFields(brainDir, target.path, fields);
    applied.push({ id: targetId, title: target.title });
  }

  return applied;
}

/**
 * Withdraw every supersession a memory imposed — used when that memory is
 * archived or rejected.
 *
 * Without this the victims stay demoted forever (0.25x at recall) behind a
 * back-pointer to an id that no longer exists, so rejecting a poisoned write
 * would leave its damage in place. Only auto-stamped validity is withdrawn;
 * an interval the author set by hand survives.
 *
 * Mutates `index` in place and mirrors into frontmatter; the caller writes the
 * index.
 *
 * @param {string} brainDir
 * @param {Object} index - Live index (mutated)
 * @param {string} successorId - The memory going away
 * @returns {string[]} Ids of memories released
 */
function clearSupersessionsBy(brainDir, index, successorId) {
  const cleared = [];

  for (const [id, entry] of Object.entries((index && index.memories) || {})) {
    if (entry.superseded_by !== successorId) continue;

    delete entry.superseded_by;
    const fields = { superseded_by: null };

    if (entry.valid_until_auto) {
      delete entry.valid_until;
      delete entry.valid_until_auto;
      fields.valid_until = null;
      fields.valid_until_auto = null;
    }

    if (entry.path) setFrontmatterFields(brainDir, entry.path, fields);
    cleared.push(id);
  }

  return cleared;
}

module.exports = {
  EXPIRED_PENALTY,
  parseInstant,
  validityOf,
  temporalState,
  isValidAt,
  validateValidity,
  supersessionInstant,
  applySupersession,
  clearSupersessionsBy,
};
