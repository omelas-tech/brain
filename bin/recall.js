#!/usr/bin/env node

/**
 * Brain Memory — Deterministic Recall Engine
 *
 * CLI tool that replaces agent-driven scoring with deterministic computation.
 * The agent calls this instead of manually computing the v4 formula.
 *
 * Usage:
 *   brain recall "async race conditions"
 *   brain recall "database pooling" --project my-app --task implementing --top 5
 *   brain recall --context                     # Session-start mode: auto-detect context
 *   brain recall --reindex                     # Rebuild search index from all memories
 *
 * Output: JSON array of scored results, sorted by score descending.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  readSearchIndex,
  writeSearchIndex,
  search,
  rebuildIndex,
  createSearchIndex,
} = require('../src/tfidf');

const {
  readIndex,
  readAssociations,
  getBrainDir,
} = require('../src/index-manager');

const {
  rankMemories,
} = require('../src/scorer');

function main() {
  const args = parseArgs(process.argv.slice(2));

  const brainDir = getBrainDir();

  if (!fs.existsSync(path.join(brainDir, 'index.json'))) {
    console.error(JSON.stringify({ error: 'Brain not initialized. Reinstall with `npx brain-memory`, or run /brain:sync to create it.' }));
    process.exit(1);
  }

  // Reindex mode
  if (args.reindex) {
    return handleReindex(brainDir);
  }

  // Need a query for search
  if (!args.query && !args.context) {
    console.error(JSON.stringify({ error: 'Usage: brain recall "query" or brain recall --context' }));
    process.exit(1);
  }

  let index;
  try {
    index = readIndex();
  } catch (err) {
    console.error(JSON.stringify({
      error: `Corrupt index.json in ~/.brain/ — ${err.message}. Fix the JSON manually or restore from sync/backup.`,
    }));
    process.exit(1);
  }
  if (!index || !index.memories || Object.keys(index.memories).length === 0) {
    console.log(JSON.stringify([]));
    return;
  }

  // Ensure search index exists
  let searchIndex;
  try {
    searchIndex = readSearchIndex(brainDir);
  } catch (_) {
    searchIndex = null;
  }
  // Rebuild when ABSENT *or* STALE. The search index drifts out of sync with
  // index.json whenever memories change outside memorize's addDocument path
  // (forget, sleep/consolidate, sync pull, manual edit) — and a present-but-
  // empty index silently makes every relevance score 0. Compare the doc set,
  // not just presence.
  if (isSearchIndexStale(searchIndex, index)) {
    searchIndex = rebuildIndex(brainDir, index);
    writeSearchIndex(brainDir, searchIndex);
  }

  // Context mode: build query from project context
  const query = args.context
    ? buildContextQuery(args)
    : args.query;

  // Compute TF-IDF relevance scores
  const tfidfScores = search(searchIndex, query);

  // Build memory list from index
  const memories = Object.entries(index.memories).map(([id, entry]) => ({
    id,
    ...entry,
  }));

  // Load associations for spreading activation
  let associations;
  try {
    associations = readAssociations();
  } catch (_) {
    associations = null;
  }

  // Build recall context
  const recallContext = {};
  if (args.project) recallContext.project = args.project;
  if (args.task) recallContext.task_type = args.task;
  if (args.topics) recallContext.topics = args.topics.split(',');

  // Rank using scorer.js with TF-IDF as the relevance function
  const ranked = rankMemories(
    memories,
    (mem) => tfidfScores[mem.id] || 0,
    {
      associations: associations || undefined,
      recallContext: Object.keys(recallContext).length > 0 ? recallContext : undefined,
    }
  );

  // Return top N
  const top = args.top || 10;
  const results = ranked.slice(0, top).map((mem) => ({
    id: mem.id,
    title: mem.title || path.basename(mem.path, '.md'),
    path: mem.path,
    type: mem.type,
    score: mem.score,
    relevance: mem.relevance,
    decayed_strength: mem.decayed_strength,
    context_match: mem.context_match,
    spreading_bonus: mem.spreading_bonus,
    confidence: mem.confidence,
    tags: mem.tags,
  }));

  console.log(JSON.stringify(results, null, 2));
}

/**
 * The TF-IDF search index is stale if it is missing, has a different document
 * count than the live index, or is missing any indexed memory id. Catches the
 * empty-index and add/remove/rename drift cases (in-place same-id body edits
 * are not detected by count alone — acceptable until a version/mtime check).
 */
function isSearchIndexStale(searchIndex, index) {
  if (!searchIndex || !searchIndex.documents) return true;
  const memIds = Object.keys((index && index.memories) || {});
  const docCount = searchIndex.doc_count != null
    ? searchIndex.doc_count
    : Object.keys(searchIndex.documents).length;
  if (docCount !== memIds.length) return true;
  for (const id of memIds) if (!(id in searchIndex.documents)) return true;
  return false;
}

/**
 * Rebuild the search index from all memories.
 */
function handleReindex(brainDir) {
  let index;
  try {
    index = readIndex();
  } catch (err) {
    console.error(JSON.stringify({
      error: `Corrupt index.json in ~/.brain/ — ${err.message}. Fix the JSON manually or restore from sync/backup.`,
    }));
    process.exit(1);
  }
  if (!index) {
    console.error(JSON.stringify({ error: 'No index.json found.' }));
    process.exit(1);
  }

  const searchIndex = rebuildIndex(brainDir, index);
  writeSearchIndex(brainDir, searchIndex);

  console.log(JSON.stringify({
    reindexed: true,
    documents: searchIndex.doc_count,
    terms: Object.keys(searchIndex.df).length,
  }));
}

/**
 * Build a query from context when no explicit query is given.
 * Uses project name and topics as search terms.
 */
function buildContextQuery(args) {
  const parts = [];
  if (args.project) parts.push(args.project);
  if (args.topics) parts.push(args.topics);
  if (args.task) parts.push(args.task);

  // If still empty, use a broad query
  return parts.length > 0 ? parts.join(' ') : '*';
}

/**
 * Parse CLI arguments.
 */
function parseArgs(argv) {
  const args = {
    query: null,
    project: null,
    task: null,
    topics: null,
    top: 10,
    context: false,
    reindex: false,
  };

  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--project':
        args.project = argv[++i];
        break;
      case '--task':
        args.task = argv[++i];
        break;
      case '--topics':
        args.topics = argv[++i];
        break;
      case '--top':
        args.top = parseInt(argv[++i], 10);
        break;
      case '--context':
        args.context = true;
        break;
      case '--reindex':
        args.reindex = true;
        break;
      default:
        if (!argv[i].startsWith('--')) {
          positional.push(argv[i]);
        }
        break;
    }
  }

  if (positional.length > 0) {
    args.query = positional.join(' ');
  }

  return args;
}

main();
