/**
 * Brain Memory — Audit Trail
 *
 * Single owner of the append-only provenance log (~/.brain/audit.log), one
 * JSON object per line, mode 0600. Written for every event that changes what
 * the brain believes (memorize, forget, restore, verify, quarantine), so a
 * fact that later turns out to be planted can be traced to the write that
 * introduced it — even if the memory file itself was since edited,
 * consolidated by a sleep cycle, or deleted.
 *
 * The log is deliberately carried forward through restores (src/git-sync.js,
 * src/cloud-sync.js) and never rolled back: forensics must survive recovery.
 */

const fs = require('fs');
const path = require('path');

const AUDIT_FILE = 'audit.log';

/**
 * Append one record to the audit log. Stamps `ts` (ISO) when absent.
 *
 * @param {string} brainDir - Path to ~/.brain/
 * @param {Object} record - Event record; `event` names the event type
 */
function appendAudit(brainDir, record) {
  const rec = record.ts ? record : { ts: new Date().toISOString(), ...record };
  fs.appendFileSync(
    path.join(brainDir, AUDIT_FILE),
    JSON.stringify(rec) + '\n',
    { mode: 0o600 }
  );
}

/**
 * Read audit records, oldest first. Tolerant by design: a missing log returns
 * [], and unparseable lines (a torn trailing line from a crash mid-append, or
 * hand-edited damage) are skipped rather than failing the whole read — the
 * log has to stay useful precisely when something already went wrong.
 *
 * @param {string} brainDir - Path to ~/.brain/
 * @param {Object} [opts] - { since?: ISO string|Date, events?: string[], limit?: number }
 *   `since` keeps records with ts >= since; `events` filters by event type;
 *   `limit` keeps the most recent N after filtering.
 * @returns {Object[]} Parsed records
 */
function readAudit(brainDir, opts = {}) {
  const { since, events, limit } = opts;
  let raw;
  try {
    raw = fs.readFileSync(path.join(brainDir, AUDIT_FILE), 'utf-8');
  } catch (_) {
    return [];
  }

  const sinceIso = since instanceof Date ? since.toISOString() : since;
  const eventSet = events ? new Set(events) : null;
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch (_) { continue; }
    if (eventSet && !eventSet.has(rec.event)) continue;
    if (sinceIso && (!rec.ts || rec.ts < sinceIso)) continue;
    out.push(rec);
  }
  if (limit && out.length > limit) return out.slice(out.length - limit);
  return out;
}

module.exports = { appendAudit, readAudit, AUDIT_FILE };
