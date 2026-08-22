/**
 * Brain Memory — Contradiction Proposals (bitemporal boundary suggestions)
 *
 * A brain that only ever appends accumulates contradictions. "We deploy to
 * Fly.io" recorded in June and "we deploy to Render" recorded in August are not
 * two competing facts — they are one fact with a boundary. src/temporal.js can
 * already represent that (`valid_until`, stamped automatically when B
 * supersedes A). What was missing is anyone NOTICING that a new write implies
 * such a boundary.
 *
 * Until now the boundary was only drawn when the agent explicitly passed
 * `supersedes`. Nothing prompted it to. So the common path — user states a new
 * decision that quietly replaces an old one, without saying "this replaces X" —
 * left both memories live, unbounded, and equally recallable. That is exactly
 * the "memory staleness" failure competitors report as unsolved: a
 * high-relevance fact that is now confidently wrong.
 *
 * This module looks at the memories a new write overlaps and proposes which of
 * them it probably ended, and when.
 *
 * ── It proposes; it never applies ────────────────────────────────────────
 * Deciding that B replaces A is a semantic judgement this code cannot make —
 * "use Postgres for analytics" does not contradict "use Postgres for sessions"
 * however many tags they share. So the output is a SUGGESTION carried back to
 * the agent, which has the conversation and can ask. Auto-stamping
 * `valid_until` on a tag heuristic would silently expire correct memories,
 * which is a worse failure than leaving a stale one live.
 *
 * ── Why these filters ────────────────────────────────────────────────────
 * Tag overlap alone is a relatedness signal, not a contradiction signal. Three
 * additional filters cut the noise to something worth showing a user:
 *
 *   same type          A `decision` can end a `decision`. An `observation` that
 *                      shares tags with a decision is context, not a reversal.
 *   not already bounded A memory with an explicit `valid_until` has an author's
 *                      window; never second-guess it.
 *   not already superseded  Already resolved — proposing again is noise.
 *
 * Pinned and stable memories are surfaced regardless of type, preserving the
 * pre-existing behaviour: those carry the most authority, so a possible
 * conflict with one is worth a look even when the heuristic is unsure.
 */

const { supersessionInstant } = require('./temporal');

/**
 * Rank how much authority a memory carries, so the most consequential possible
 * contradiction is the first thing the agent reads.
 */
function authorityOf(entry) {
  if (entry.pinned) return 'pinned';
  if (entry.stable) return 'stable';
  return 'same-type';
}

const AUTHORITY_RANK = { pinned: 3, stable: 2, 'same-type': 1 };

/**
 * Propose which existing memories a new write may have ended, and when.
 *
 * @param {Object} index - Live brain index
 * @param {Object} newMem - The incoming memory (needs type, valid_from/created)
 * @param {string[]} overlapIds - Candidate ids (from findTagOverlaps)
 * @param {Object} [opts]
 * @param {string} [opts.now] - ISO instant the successor starts at, when the
 *   memory carries neither `valid_from` nor `created` yet
 * @returns {Array<Object>} proposals, highest authority first
 */
function proposeSupersessions(index, newMem, overlapIds, opts = {}) {
  const memories = (index && index.memories) || {};
  const newTags = new Set(newMem.tags || []);
  const boundary = supersessionInstant(newMem) || opts.now || null;

  const proposals = [];
  for (const id of overlapIds || []) {
    const entry = memories[id];
    if (!entry) continue;

    // Already resolved, or the author drew their own window — leave both alone.
    if (entry.superseded_by) continue;
    if (entry.valid_until) continue;

    const authority = authorityOf(entry);
    // Beyond pinned/stable, only a like-for-like memory is a plausible
    // reversal. An observation sharing tags with a decision is context.
    if (authority === 'same-type' && entry.type !== newMem.type) continue;

    proposals.push({
      id,
      title: entry.title,
      type: entry.type,
      authority,
      shared_tags: (entry.tags || []).filter((t) => newTags.has(t)),
      // What `brain memorize --supersedes <id>` would stamp if confirmed.
      proposed_valid_until: boundary,
    });
  }

  return proposals.sort(
    (a, b) => (AUTHORITY_RANK[b.authority] - AUTHORITY_RANK[a.authority])
      || (b.shared_tags.length - a.shared_tags.length)
      || (a.id < b.id ? -1 : 1),
  );
}

module.exports = { proposeSupersessions, AUTHORITY_RANK };
