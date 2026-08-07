/**
 * Brain Memory — Recall Receipts
 *
 * Mints the one-line attributable receipt attached to every memory the
 * engine returns (bin/recall.js results, bin/session-start.js context_recall
 * and pinned entries). Agents copy the line VERBATIM at the end of any
 * response a memory materially shaped — because the engine mints it, a
 * receipt can never be hallucinated.
 *
 * Format:  ◉ memory: "<title>" (<type>, <age>)
 *
 * Low-trust origins (tool-output, external — see src/provenance.js) carry a
 * trailing warning segment so a poisoned-source memory is visibly marked
 * wherever its receipt appears:  ◉ memory: "<title>" (<type>, <age>, ⚠ external)
 * User/agent-inferred receipts are byte-identical to the base format.
 *
 * Age is derived from the memory's `created` timestamp (falling back to
 * `last_accessed`; omitted entirely when neither parses):
 *   today | yesterday | <N>d ago (2-30 days) | <N>mo ago (31-364 days,
 *   nearest month, min 1) | <N>y ago (365+ days, nearest year, min 1)
 *
 * Deterministic: `now` is injectable for tests.
 */

const { isLowTrust } = require('./provenance');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30.44; // mean Gregorian month
const DAYS_PER_YEAR = 365.25;
const MAX_TITLE_CHARS = 80;

/**
 * Human age label for a timestamp, relative to `now`.
 *
 * @param {string|Date} timestamp - ISO timestamp (memory `created`)
 * @param {Date} now - Reference time
 * @returns {string|null} Age label, or null when the timestamp is invalid
 */
function ageLabel(timestamp, now) {
  const then = new Date(timestamp);
  if (Number.isNaN(then.getTime())) return null;
  const days = Math.floor((now.getTime() - then.getTime()) / MS_PER_DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days <= 30) return `${days}d ago`;
  if (days <= 364) return `${Math.max(1, Math.round(days / DAYS_PER_MONTH))}mo ago`;
  return `${Math.max(1, Math.round(days / DAYS_PER_YEAR))}y ago`;
}

/**
 * Mint the receipt line for a memory-like object ({title, type, created,
 * last_accessed}). Title is used as-is (truncated at 77 chars + "…" only
 * when longer than 80); `created` falls back to `last_accessed`, and the
 * age segment is omitted when neither parses.
 *
 * @param {Object} memoryLike - Object with title/type/created/last_accessed
 * @param {Function} [nowFn] - Injectable clock for deterministic tests
 * @returns {string} The receipt line
 */
function receiptFor(memoryLike, nowFn) {
  const mem = memoryLike || {};
  const now = (nowFn || (() => new Date()))();

  let title = typeof mem.title === 'string' && mem.title ? mem.title : 'memory';
  if (title.length > MAX_TITLE_CHARS) title = title.slice(0, 77) + '…';

  const type = typeof mem.type === 'string' && mem.type ? mem.type : 'memory';
  const age = ageLabel(mem.created ?? mem.last_accessed ?? NaN, now);
  const trust = isLowTrust(mem.origin) ? `, ⚠ ${mem.origin}` : '';

  return age
    ? `◉ memory: "${title}" (${type}, ${age}${trust})`
    : `◉ memory: "${title}" (${type}${trust})`;
}

module.exports = { receiptFor, ageLabel };
