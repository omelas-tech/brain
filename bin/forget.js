#!/usr/bin/env node

/**
 * brain forget <id> — archive a memory (recoverable). Deterministic helper used
 * by the connector's `brain_forget` tool and by `brain verify reject`. Honors
 * BRAIN_DIR.
 *
 * Archive (default): move the memory file into `_archived/`, record it in
 * `_archived/index.json`, and remove it from the live index, associations,
 * review queue, and search index — so it stops surfacing in recall but stays
 * recoverable. Deep / forensic erasure remains the agent-driven `/brain:forget
 * --deep` path; this primitive only archives.
 *
 * Every archival is recorded in audit.log (event: 'forget') — removal changes
 * what the brain believes just as much as a write does.
 *
 * Usage:
 *   BRAIN_DIR=/path/to/.brain node bin/forget.js mem_20260101_abc123
 *
 * Output: JSON describing the result.
 */

const fs = require('fs');
const path = require('path');

const {
  getBrainDir,
  readIndex, writeIndex, removeMemory,
  readAssociations, writeAssociations, removeEdgesForMemory,
  readReviewQueue, writeReviewQueue, removeFromReviewQueue,
  readArchiveIndex, writeArchiveIndex,
} = require('../src/index-manager');
// Search-index helpers take (brainDir) — the same signature memorize/recall use.
// (index-manager exports same-named helpers with a (projectRoot) signature that
// re-appends `.brain`, which would silently no-op the search-index update here.)
const { removeDocument, readSearchIndex, writeSearchIndex } = require('../src/tfidf');
const { appendAudit } = require('../src/audit');

// CoALA salience protection: high-salience memories are "never auto-pruned"
// (the documented guarantee). Enforced deterministically here — the only
// archival primitive — instead of relying on the agent to honor it.
const SALIENCE_FLOOR = 0.7;

/**
 * Archive one memory. The shared primitive behind `brain forget` and
 * `brain verify reject`.
 *
 * @param {string} brainDir - Path to ~/.brain/
 * @param {string} id - Memory ID
 * @param {Object} [opts] - { force = false, reason = 'forget' }
 * @returns {Object} { archived, id, title, memory_count } or { error, protected? }
 */
function archiveMemory(brainDir, id, opts = {}) {
  const { force = false, reason = 'forget' } = opts;

  const index = readIndex();
  if (!index) return { error: 'Brain not initialized.' };
  const entry = index.memories[id];
  if (!entry) return { error: `Memory not found: ${id}` };

  if (!force && typeof entry.salience === 'number' && entry.salience >= SALIENCE_FLOOR) {
    return {
      error: `Refusing to archive high-salience memory ${id} (salience ${entry.salience} >= ${SALIENCE_FLOOR}). Pass --force to override.`,
      protected: true,
    };
  }

  const now = new Date().toISOString();

  // 1. Move the memory file into _archived/ (recoverable).
  let archivedPath = null;
  if (entry.path) {
    const src = path.join(brainDir, entry.path);
    const dest = path.join(brainDir, '_archived', entry.path);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(src, dest);
      archivedPath = path.join('_archived', entry.path);
    }
  }

  // 2. Record in the archive index.
  const arch = readArchiveIndex() || { version: 1, archived_count: 0, memories: {} };
  arch.memories[id] = {
    path: entry.path, archived_path: archivedPath, title: entry.title, type: entry.type,
    cognitive_type: entry.cognitive_type, strength: entry.strength, salience: entry.salience,
    confidence: entry.confidence, tags: entry.tags || [], archived_date: now, archived_reason: reason,
  };
  arch.archived_count = Object.keys(arch.memories).length;
  writeArchiveIndex(arch);

  // 3. Remove from the live index.
  removeMemory(index, id);
  writeIndex(index);

  // 4. Remove association edges.
  const assoc = readAssociations() || { version: 1, edges: {} };
  removeEdgesForMemory(assoc, id);
  writeAssociations(assoc);

  // 5. Remove from the review queue.
  const queue = readReviewQueue();
  if (queue) {
    removeFromReviewQueue(queue, id);
    writeReviewQueue(queue);
  }

  // 6. Remove from the search index (so it stops being recalled).
  const searchIndex = readSearchIndex(brainDir);
  if (searchIndex) {
    removeDocument(searchIndex, id);
    writeSearchIndex(brainDir, searchIndex);
  }

  // 7. Audit trail. Best-effort: the archival already happened; losing the
  // trail is worse surfaced than thrown.
  let auditError = null;
  try {
    appendAudit(brainDir, {
      ts: now, event: 'forget', id, title: entry.title, path: entry.path,
      origin: entry.origin, salience: entry.salience, reason, forced: force,
    });
  } catch (err) {
    auditError = err.message;
  }

  return {
    archived: true, id, title: entry.title, memory_count: index.memory_count,
    ...(auditError ? { audit_error: auditError } : {}),
  };
}

function main(argv) {
  const args = argv || process.argv.slice(2);
  const id = args.find((a) => a && !a.startsWith('--'));
  const force = args.includes('--force');
  if (!id) {
    console.error(JSON.stringify({ error: 'Usage: brain forget <id> [--force]' }));
    process.exit(1);
  }

  const brainDir = getBrainDir();
  const result = archiveMemory(brainDir, id, { force });
  if (result.error) {
    console.error(JSON.stringify(result));
    process.exit(1);
  }
  console.log(JSON.stringify(result));
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, archiveMemory, SALIENCE_FLOOR };
