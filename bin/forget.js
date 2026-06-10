#!/usr/bin/env node

/**
 * brain forget <id> — archive a memory (recoverable). Deterministic helper used
 * by the connector's `brain_forget` tool. Honors BRAIN_DIR.
 *
 * Archive (default): move the memory file into `_archived/`, record it in
 * `_archived/index.json`, and remove it from the live index, associations,
 * review queue, and search index — so it stops surfacing in recall but stays
 * recoverable. Deep / forensic erasure remains the agent-driven `/brain:forget
 * --deep` path; this primitive only archives.
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
  readSearchIndex, writeSearchIndex,
} = require('../src/index-manager');
const { removeDocument } = require('../src/tfidf');

function main(argv) {
  const id = (argv || process.argv.slice(2)).find((a) => a && !a.startsWith('--'));
  if (!id) {
    console.error(JSON.stringify({ error: 'Usage: brain forget <id>' }));
    process.exit(1);
  }

  const brainDir = getBrainDir();
  const index = readIndex();
  if (!index) {
    console.error(JSON.stringify({ error: 'Brain not initialized.' }));
    process.exit(1);
  }
  const entry = index.memories[id];
  if (!entry) {
    console.error(JSON.stringify({ error: `Memory not found: ${id}` }));
    process.exit(1);
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
    confidence: entry.confidence, tags: entry.tags || [], archived_date: now, archived_reason: 'forget',
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

  console.log(JSON.stringify({ archived: true, id, title: entry.title, memory_count: index.memory_count }));
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main };
