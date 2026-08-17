#!/usr/bin/env node

/**
 * brain verify — the quarantine workflow for unverified writes (OWASP ASI06).
 *
 * Low-trust writes (origin tool-output/external, or lint-flagged content) land
 * with a pending-verification flag. This CLI is how they get resolved:
 *
 *   brain verify list                     Pending memories (JSON)
 *   brain verify show <id>                Full frontmatter + body for inspection
 *   brain verify approve <id> [...] [--force]
 *                                         Clear the flag, mark vetted (audited)
 *   brain verify reject <id> [...] [--force]
 *                                         Archive via the forget primitive (audited)
 *
 * Approval clears the flag only — origin, write-time clamps, and recall trust
 * weighting stay. --force on approve vets a non-pending id; on reject it
 * overrides the high-salience archival guard.
 *
 * Note: _archived/ is excluded from cloud sync, so a reject propagates the
 * index removal to other devices but may leave an orphaned .md file there —
 * harmless (recall reads only the index; reindex rebuilds from the index).
 *
 * Output: JSON. Honors BRAIN_DIR.
 */

const fs = require('fs');
const path = require('path');

const {
  getBrainDir, readIndex, writeIndex, readAssociations, writeAssociations, reinforceEdge,
} = require('../src/index-manager');
const { listPending, approveQuarantine } = require('../src/quarantine');
const { applySupersession, supersessionInstant } = require('../src/temporal');
const { appendAudit } = require('../src/audit');
const { archiveMemory } = require('./forget');

function fail(message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
}

function loadIndex() {
  let index;
  try {
    index = readIndex();
  } catch (err) {
    fail(`Corrupt index.json in ~/.brain/ — ${err.message}. Fix the JSON manually or restore from sync/backup.`);
  }
  if (!index) fail('Brain not initialized.');
  return index;
}

function pendingItem(id, entry) {
  return {
    id,
    title: entry.title,
    path: entry.path,
    type: entry.type,
    origin: entry.origin,
    reasons: entry.quarantine_reasons || [],
    flagged: entry.quarantine_flagged,
    tags: entry.tags || [],
  };
}

function main(argv) {
  const args = argv || process.argv.slice(2);
  const sub = args[0];
  const force = args.includes('--force');
  const ids = args.slice(1).filter((a) => a && !a.startsWith('--'));

  const brainDir = getBrainDir();

  if (sub === 'list' || sub === undefined) {
    const index = loadIndex();
    const pending = listPending(index).map(({ id, entry }) => pendingItem(id, entry));
    console.log(JSON.stringify({ pending, total: pending.length }, null, 2));
    return;
  }

  if (sub === 'show') {
    if (ids.length !== 1) fail('Usage: brain verify show <id>');
    const index = loadIndex();
    const entry = index.memories[ids[0]];
    if (!entry) fail(`Memory not found: ${ids[0]}`);
    let content = null;
    try { content = fs.readFileSync(path.join(brainDir, entry.path), 'utf-8'); } catch (_) { /* index is source of truth */ }
    console.log(JSON.stringify({ ...pendingItem(ids[0], entry), quarantined: !!entry.quarantined, content }, null, 2));
    return;
  }

  if (sub === 'approve') {
    if (ids.length === 0) fail('Usage: brain verify approve <id> [<id>...] [--force]');
    const index = loadIndex();
    const now = new Date().toISOString();
    const approved = [];
    const supersededOnApproval = [];
    const errors = [];
    for (const id of ids) {
      const entry = index.memories[id];
      if (!entry) { errors.push({ id, error: 'not found' }); continue; }
      if (!entry.quarantined && !force) {
        errors.push({ id, error: 'not pending verification (--force to vet anyway)' });
        continue;
      }
      if (entry.quarantined) {
        const r = approveQuarantine(brainDir, index, id, now);
        if (r.error) { errors.push({ id, error: r.error }); continue; }
      } else {
        entry.vetted = true;
        entry.vetted_at = now;
      }

      // Deferred supersession: memorize withholds the `superseded_by` stamp
      // when a write lands quarantined, so an unverified memory can never
      // demote a trusted one behind the user's back. Approval is the moment
      // that intent takes effect. Re-applying an already-stamped supersession
      // is a no-op, so the --force path is safe too.
      let superseded = [];
      if (entry.supersedes && entry.supersedes.length) {
        superseded = applySupersession(brainDir, index, id, entry.supersedes, {
          validUntil: supersessionInstant(entry),
        });
        if (superseded.length) {
          const assoc = readAssociations() || { version: 1, edges: {} };
          for (const t of superseded) reinforceEdge(assoc, id, t.id, 'manual', 0.20);
          writeAssociations(assoc);
        }
      }

      try {
        appendAudit(brainDir, {
          ts: now, event: 'verify_approve', id, title: entry.title, origin: entry.origin, forced: force,
          ...(superseded.length ? { superseded: superseded.map((t) => t.id) } : {}),
        });
      } catch (_) { /* approval already applied */ }
      approved.push(id);
      if (superseded.length) supersededOnApproval.push({ id, superseded });
    }
    if (approved.length > 0) writeIndex(index);
    const output = {
      approved,
      // Replacements the approval released — surfaced so the user sees that
      // approving also demoted something they already trusted.
      ...(supersededOnApproval.length ? { superseded: supersededOnApproval } : {}),
      ...(errors.length ? { errors } : {}),
    };
    if (errors.length && approved.length === 0) {
      console.error(JSON.stringify(output));
      process.exit(1);
    }
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (sub === 'reject') {
    if (ids.length === 0) fail('Usage: brain verify reject <id> [<id>...] [--force]');
    const now = new Date().toISOString();
    const rejected = [];
    const errors = [];
    for (const id of ids) {
      const result = archiveMemory(brainDir, id, { force, reason: 'verify_reject' });
      if (result.error) { errors.push({ id, error: result.error, ...(result.protected ? { protected: true } : {}) }); continue; }
      try {
        appendAudit(brainDir, { ts: now, event: 'verify_reject', id, title: result.title, forced: force });
      } catch (_) { /* archival already applied */ }
      rejected.push(id);
    }
    const output = { rejected, ...(errors.length ? { errors } : {}) };
    if (errors.length && rejected.length === 0) {
      console.error(JSON.stringify(output));
      process.exit(1);
    }
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  fail(`Unknown subcommand "${sub}". Usage: brain verify <list|show|approve|reject>`);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main };
