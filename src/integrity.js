/**
 * Brain Memory — Content Integrity (OWASP ASI06: store-phase tamper detection)
 *
 * Every other poisoning defense in this codebase guards the *write path*:
 * provenance clamps what an origin may claim, content-lint inspects the payload
 * shape, quarantine holds low-trust writes for review, anomaly.js reads the
 * audit log for attack-shaped write patterns. All of them assume the attacker
 * arrives through `brain memorize`.
 *
 * They are all blind to an editor.
 *
 * `~/.brain/` is plain Markdown on disk — that is the product's best feature and
 * its widest attack surface. Anything with write access to the home directory
 * can rewrite the body of an already-trusted, already-vetted, already-pinned
 * memory without touching the index, the audit log, or any origin label. The
 * memory keeps its `user` origin and its 1.0 trust factor, and the new text
 * rides into every future session with full authority. No detector here fires,
 * because no *write event* ever happened.
 *
 * This module closes that gap the only way a file-based store can: record what
 * each memory said when the brain last agreed with it, and notice when the
 * bytes stop matching. That is the "cryptographic baseline" half of OWASP's
 * Agent Memory Guard guidance, and the Store phase of the memory lifecycle in
 * the LTM security survey (arXiv:2604.16548), which argues integrity cannot be
 * retrofitted at retrieval time alone.
 *
 * ── What a finding means ─────────────────────────────────────────────────
 * `content_hash` drift is EVIDENCE OF AN EDIT, not proof of an attack. Brain's
 * own maintenance rewrites memory bodies legitimately: `/brain:sleep` phases
 * (consolidation, crystallization, reorganize) are agent-driven and edit files
 * directly, and a user is entitled to fix a typo in their own memory with vim.
 * So this detector is deliberately ADVISORY — it never auto-quarantines, and
 * `runAudit`'s `--apply` path does not act on it.
 *
 * The signal is only meaningful against the baseline, so re-baseline after any
 * legitimate bulk rewrite: `brain audit --rebaseline`.
 *
 * ── Why not compare against the audit log? ───────────────────────────────
 * Tempting: every legitimate write appends to audit.log, so "changed without an
 * audit entry" would be a sharper signal. It does not hold — sleep is a prompt,
 * not a CLI path, so it edits files without writing audit events. Until every
 * mutation path routes through an audited helper, an audit-log-derived baseline
 * would produce false positives on every sleep cycle.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * SHA-256 of a memory's on-disk bytes, hex-encoded.
 *
 * Hashes the WHOLE file, frontmatter included. Frontmatter carries strength,
 * trust, pin state, and quarantine flags — fields an attacker would rather edit
 * than the prose, so excluding them would leave the most valuable target
 * unguarded. The cost is that ordinary recall (which bumps `last_accessed` and
 * `access_count`) also moves the hash, which is why re-baselining is a normal
 * part of the workflow rather than an alarm.
 *
 * @param {string} text - Raw file contents
 * @returns {string} 64-char hex digest
 */
function contentHash(text) {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

/**
 * Hash the memory file an index entry points at.
 *
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @param {string} relPath - Index entry's `path`
 * @returns {string|null} Digest, or null when the file is unreadable/missing
 */
function hashMemoryFile(brainDir, relPath) {
  try {
    return contentHash(fs.readFileSync(path.join(brainDir, relPath), 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Compare every indexed memory's current bytes against its recorded baseline.
 *
 * Three outcomes per memory:
 *   - no baseline recorded → not a finding (unbaselined, not tampered)
 *   - file missing/unreadable → `missing_file` finding
 *   - hash differs → `content_drift` finding
 *
 * Findings are ordered most-trusted-first: drift in a pinned, user-origin
 * memory is the one worth waking up for, because that memory carries the most
 * authority into future sessions.
 *
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @param {Object} index - Parsed index.json
 * @returns {Array<Object>} findings
 */
function detectContentDrift(brainDir, index) {
  const findings = [];
  for (const [id, entry] of Object.entries((index && index.memories) || {})) {
    if (!entry.content_hash) continue;              // never baselined — not a finding
    const actual = hashMemoryFile(brainDir, entry.path);
    if (actual === null) {
      findings.push({ kind: 'missing_file', id, path: entry.path, advisory: true });
      continue;
    }
    if (actual !== entry.content_hash) {
      findings.push({
        kind: 'content_drift',
        id,
        path: entry.path,
        origin: entry.origin || 'agent-inferred',
        pinned: Boolean(entry.pinned),
        vetted: Boolean(entry.vetted),
        expected: entry.content_hash.slice(0, 12),
        actual: actual.slice(0, 12),
        advisory: true,
      });
    }
  }

  // Authority-first: pinned outranks vetted outranks user-origin, so the most
  // load-bearing memory in the brain is the first line the user reads.
  const authority = (f) =>
    (f.pinned ? 4 : 0) + (f.vetted ? 2 : 0) + (f.origin === 'user' ? 1 : 0);
  return findings.sort((a, b) => authority(b) - authority(a) || (a.id < b.id ? -1 : 1));
}

/**
 * Stamp `content_hash` on index entries from the files' current bytes.
 *
 * Called after a legitimate rewrite (memorize, sleep, restore, sync pull) and
 * by `brain audit --rebaseline`. Mutates `index` in place; the caller writes it.
 *
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @param {Object} index - Parsed index.json (mutated)
 * @param {string[]} [ids] - Restrict to these IDs; omit to baseline everything
 * @returns {{ baselined: number, unreadable: string[] }}
 */
function rebaseline(brainDir, index, ids) {
  const entries = Object.entries((index && index.memories) || {});
  const targets = ids ? entries.filter(([id]) => ids.includes(id)) : entries;

  let baselined = 0;
  const unreadable = [];
  for (const [id, entry] of targets) {
    const h = hashMemoryFile(brainDir, entry.path);
    if (h === null) { unreadable.push(id); continue; }
    entry.content_hash = h;
    baselined++;
  }
  return { baselined, unreadable };
}

module.exports = { contentHash, hashMemoryFile, detectContentDrift, rebaseline };
