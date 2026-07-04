/**
 * receipt — recall-receipt formatter, an ESM port of the brain package's
 * src/receipt.js (kept in lockstep by hand; the plugin is self-contained and
 * cannot require() the CommonJS original).
 *
 * The brain CLI mints a `receipt` field on every recall/session-start memory:
 *   ◉ memory: "<title>" (<type>, <age>)
 * Agents copy the line VERBATIM at the end of any response the memory
 * materially shaped. This local formatter exists only as a fallback for rows
 * produced by an older brain CLI that does not emit `receipt` yet.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30.44; // mean Gregorian month
const DAYS_PER_YEAR = 365.25;
const MAX_TITLE_CHARS = 80;

/**
 * Human age label for a timestamp, relative to `now`.
 *
 * @param {string|Date} timestamp  ISO timestamp (memory `created`).
 * @param {Date} now
 * @returns {string | null} Age label, or null when the timestamp is invalid.
 */
export function ageLabel(timestamp, now) {
  const then = new Date(timestamp);
  if (Number.isNaN(then.getTime())) return null;
  const days = Math.floor((now.getTime() - then.getTime()) / MS_PER_DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days <= 30) return `${days}d ago`;
  if (days <= 364) return `${Math.max(1, Math.round(days / DAYS_PER_MONTH))}mo ago`;
  return `${Math.max(1, Math.round(days / DAYS_PER_YEAR))}y ago`;
}

/**
 * Mint the receipt line for a memory-like object ({title, type, created,
 * last_accessed}). Title is used as-is (truncated at 77 chars + "…" only when
 * longer than 80); `created` falls back to `last_accessed`, and the age
 * segment is omitted when neither parses.
 *
 * @param {Record<string, any> | null | undefined} memoryLike
 * @param {() => Date} [nowFn]  Injectable clock for deterministic tests.
 * @returns {string}
 */
export function receiptFor(memoryLike, nowFn) {
  const mem = memoryLike || {};
  const now = (nowFn || (() => new Date()))();

  let title = typeof mem.title === "string" && mem.title ? mem.title : "memory";
  if (title.length > MAX_TITLE_CHARS) title = title.slice(0, 77) + "…";

  const type = typeof mem.type === "string" && mem.type ? mem.type : "memory";
  const age = ageLabel(mem.created ?? mem.last_accessed ?? NaN, now);

  return age
    ? `◉ memory: "${title}" (${type}, ${age})`
    : `◉ memory: "${title}" (${type})`;
}
