/**
 * Brain Memory — Quarantine (OWASP ASI06: memory poisoning)
 *
 * Pending-verification state for writes the brain shouldn't fully trust yet:
 * low-trust origins (tool-output, external) and lint-flagged content. State
 * lives in the index entry + memory frontmatter — the same conditional-field
 * pattern as pinned/stable — so it syncs and restores with the memory itself
 * (no sidecar file, no cache drift).
 *
 * Naming: the SM-2 spaced-repetition queue owns "review" (review-queue.json,
 * due_for_review). This subsystem is quarantine / verify / pending_verification.
 *
 * Modes (config.json `quarantine_mode`, default 'flag'):
 *   off      Nothing is flagged; existing flags persist inertly.
 *   flag     Flagged memories stay recallable, marked (⊘ unverified receipts,
 *            quarantine_pending in results, session-start count).
 *   enforce  Flagged memories are excluded from recall/session-start until
 *            approved. Evaluated at read time, so flipping the knob
 *            retroactively hides/reveals already-pending items.
 *
 * Approval clears the flag only — origin, write-time clamps, and the recall
 * trust factor all stay. `vetted: true` records that a human/agent looked, and
 * stops `brain audit` from re-proposing the memory.
 */

const { isLowTrust } = require('./provenance');
const { setFrontmatterFields } = require('./pinning');
const { SENSITIVE_OPT_OUT_REASON } = require('./sensitivity');

/**
 * Decide whether a write should be quarantined.
 *
 * - tool-output / external origins: always flagged (`origin:<o>`).
 * - agent-inferred: flagged only on injection-severity lint — the default
 *   agent write path stays friction-free.
 * - user: never auto-flagged (lint is still recorded in the audit trail).
 *
 * @param {Object} opts - { origin, lintResult, config }
 * @returns {{ quarantined: boolean, reasons: string[] }}
 */
function quarantineDecision({ origin, lintResult, config }) {
  const mode = (config && config.quarantine_mode) || 'flag';
  if (mode === 'off') return { quarantined: false, reasons: [] };

  const reasons = [];
  if (isLowTrust(origin)) reasons.push(`origin:${origin}`);

  const flags = (lintResult && lintResult.flags) || [];
  if (origin !== 'user') {
    for (const f of flags) {
      if (f.severity === 'injection') reasons.push(`lint:${f.rule}`);
      // Suspect findings only add reasons on top of an already-flagged
      // low-trust origin — they explain *why* beyond the origin itself.
      else if (f.severity === 'suspect' && isLowTrust(origin)) reasons.push(`lint:${f.rule}`);
    }
  }

  return { quarantined: reasons.length > 0, reasons };
}

/** All index entries currently pending verification. */
function listPending(index) {
  const out = [];
  for (const [id, entry] of Object.entries((index && index.memories) || {})) {
    if (entry.quarantined) out.push({ id, entry });
  }
  return out;
}

/**
 * Flag an existing memory (used by `brain audit --apply`). Sets the fields on
 * the index entry and mirrors them into the memory file's frontmatter.
 * Caller writes the index.
 */
function applyQuarantine(brainDir, index, id, reasons, now) {
  const entry = index.memories[id];
  if (!entry) return { error: `Memory not found: ${id}` };
  entry.quarantined = true;
  entry.quarantine_reasons = reasons;
  entry.quarantine_flagged = now;
  setFrontmatterFields(brainDir, entry.path, {
    quarantined: true,
    quarantine_reasons: `[${reasons.map((r) => `"${r}"`).join(', ')}]`,
    quarantine_flagged: now,
  }, { raw: ['quarantine_reasons'] });
  return { id, quarantined: true, reasons };
}

/**
 * Approve a pending memory: strip the quarantine fields, set vetted/vetted_at.
 * Caller writes the index.
 */
function approveQuarantine(brainDir, index, id, now) {
  const entry = index.memories[id];
  if (!entry) return { error: `Memory not found: ${id}` };
  if (!entry.quarantined) return { error: `Memory is not pending verification: ${id}` };
  delete entry.quarantined;
  delete entry.quarantine_reasons;
  delete entry.quarantine_flagged;
  entry.vetted = true;
  entry.vetted_at = now;
  setFrontmatterFields(brainDir, entry.path, {
    quarantined: null,
    quarantine_reasons: null,
    quarantine_flagged: null,
    vetted: true,
    vetted_at: now,
  });
  return { id, vetted: true };
}

/**
 * Put an approved memory back into pending verification — the undo for a
 * mistaken approve. Re-flags it and strips vetted/vetted_at, so `brain audit`
 * is free to propose it again. Approval dropped the original reasons, so they
 * are rebuilt: the origin reason (when low-trust), the consent reason (when the
 * memory is sensitive and the user has not opted in), plus `requeued`.
 *
 * Clearing `vetted` is also what withdraws per-item consent: a sensitive
 * memory goes back to hidden, because isSensitiveHidden() keys on it.
 *
 * A pinned memory is refused rather than silently unpinned: pending memories
 * can never be pinned, and dropping an always-apply constraint is the user's
 * call. A supersession the approval released is NOT reverted — the caller
 * surfaces it. Caller writes the index.
 */
function requeueQuarantine(brainDir, index, id, now, config) {
  const entry = index.memories[id];
  if (!entry) return { error: `Memory not found: ${id}` };
  if (entry.quarantined) return { error: `Memory is already pending verification: ${id}` };
  if (entry.pinned) return { error: `Memory is pinned — unpin it first (a pending memory can never be pinned): ${id}` };
  const optedOut = entry.sensitivity === 'sensitive' && !(config && config.sensitive_topics === true);
  const reasons = [
    ...(isLowTrust(entry.origin) ? [`origin:${entry.origin}`] : []),
    ...(optedOut ? [SENSITIVE_OPT_OUT_REASON] : []),
    'requeued',
  ];
  delete entry.vetted;
  delete entry.vetted_at;
  setFrontmatterFields(brainDir, entry.path, { vetted: null, vetted_at: null });
  return applyQuarantine(brainDir, index, id, reasons, now);
}

module.exports = { quarantineDecision, listPending, applyQuarantine, approveQuarantine, requeueQuarantine };
