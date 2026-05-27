#!/usr/bin/env node

/**
 * brain session-start — budget-aware working-memory payload (CoALA Phase 0).
 *
 * One deterministic call returning everything the agent should internalize at
 * session start, bounded by the working-memory token budget in config.json so
 * Brain can never bloat the host's context window.
 *
 * Usage:
 *   brain session-start [--project P] [--topics a,b] [--task T] [--top N]
 *
 * Output (JSON):
 *   {
 *     memory_count, pinned[], skills_index[], context_recall[],
 *     due_for_review, low_confidence_alerts[], budget{}
 *   }
 *
 * pinned[] (Phase 1) and skills_index[] (Phase 2) are present but empty here;
 * the budget framework already accounts for them so later phases just fill in.
 */

const fs = require('fs');
const path = require('path');

const {
  readSearchIndex,
  writeSearchIndex,
  search,
  rebuildIndex,
} = require('../src/tfidf');

const {
  readIndex,
  readAssociations,
  readReviewQueue,
  readConfig,
  getBrainDir,
} = require('../src/index-manager');

const { rankMemories } = require('../src/scorer');

function parseArgs(argv) {
  const args = { project: null, topics: null, task: null, top: 5 };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--project': args.project = argv[++i]; break;
      case '--topics': args.topics = argv[++i]; break;
      case '--task': args.task = argv[++i]; break;
      case '--top': args.top = parseInt(argv[++i], 10) || 5; break;
      default: break;
    }
  }
  return args;
}

/** chars/4 token estimate; falls back to the title line for pre-Phase-0 entries. */
function estimateTokens(entry) {
  if (typeof entry.token_estimate === 'number') return entry.token_estimate;
  return Math.ceil(((entry.title || '').length + 8) / 4);
}

/** Read a memory file's body (content after the frontmatter block). */
function readMemoryBody(brainDir, memPath) {
  try {
    const content = fs.readFileSync(path.join(brainDir, memPath), 'utf-8');
    const first = content.indexOf('---');
    const second = content.indexOf('---', first + 3);
    if (first !== -1 && second !== -1) return content.slice(second + 3).trim();
    return content.trim();
  } catch (_) {
    return '';
  }
}

function buildContextQuery(args) {
  const parts = [];
  if (args.project) parts.push(args.project);
  if (args.topics) parts.push(args.topics);
  if (args.task) parts.push(args.task);
  return parts.length > 0 ? parts.join(' ') : '*';
}

/**
 * Compute the session-start payload for the brain at `projectRoot` (undefined =
 * the real ~/.brain). Pure: performs no console output and never calls exit, so
 * it is directly unit-testable.
 *
 * @param {string} [projectRoot] - Filesystem root whose .brain/ to read
 * @param {Object} [args] - { project, topics, task, top }
 * @returns {Object} The session-start payload
 */
function computeSessionStart(projectRoot, args = {}) {
  const top = args.top || 5;
  const brainDir = getBrainDir(projectRoot);
  const config = readConfig(projectRoot);
  const cap = config.working_memory_budget_tokens;

  const empty = {
    memory_count: 0,
    pinned: [],          // Phase 1: always-present semantic tier
    skills_index: [],    // Phase 2: procedural skill summaries
    context_recall: [],
    due_for_review: 0,
    low_confidence_alerts: [],
    budget: { cap, recall_cap: config.recall_budget_tokens, used: 0, included: 0, excluded: 0 },
  };

  if (!fs.existsSync(path.join(brainDir, 'index.json'))) return empty;

  const index = readIndex(projectRoot);
  if (!index || !index.memories || Object.keys(index.memories).length === 0) return empty;

  const memoryCount = Object.keys(index.memories).length;

  // --- Context recall (deterministic, reuses the recall engine) ---
  let searchIndex = null;
  try { searchIndex = readSearchIndex(brainDir); } catch (_) { searchIndex = null; }
  if (!searchIndex) {
    searchIndex = rebuildIndex(brainDir, index);
    writeSearchIndex(brainDir, searchIndex);
  }

  const tfidfScores = search(searchIndex, buildContextQuery(args));
  const memories = Object.entries(index.memories).map(([id, entry]) => ({ id, ...entry }));

  let associations = null;
  try { associations = readAssociations(projectRoot); } catch (_) { associations = null; }

  const recallContext = {};
  if (args.project) recallContext.project = args.project;
  if (args.task) recallContext.task_type = args.task;
  if (args.topics) recallContext.topics = String(args.topics).split(',');

  const ranked = rankMemories(
    memories,
    (mem) => tfidfScores[mem.id] || 0,
    {
      associations: associations || undefined,
      recallContext: Object.keys(recallContext).length > 0 ? recallContext : undefined,
    }
  );

  // --- Pinned tier (CoALA Phase 1): always present, scope-filtered, budget-capped ---
  // The index entry is the source of truth (pinned.json is a maintained cache);
  // scanning the index here avoids manifest/index drift.
  const pinnedCandidates = [];
  for (const [id, entry] of Object.entries(index.memories)) {
    if (!entry.pinned) continue;
    const scope = entry.pin_scope || 'global';
    if (scope !== 'global') {
      const scopedProject = scope.startsWith('project:') ? scope.slice('project:'.length) : null;
      if (!args.project || scopedProject !== args.project) continue; // out-of-project pin
    }
    pinnedCandidates.push({ id, entry, scope, priority: entry.pin_priority || 0 });
  }
  pinnedCandidates.sort((a, b) =>
    (b.priority - a.priority) ||
    ((b.entry.strength || 0) - (a.entry.strength || 0)) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );

  const pinned = [];
  let pinnedTokens = 0;
  let pinnedExcluded = 0;
  const pinCap = Math.min(config.pin_budget_tokens, cap);
  for (const c of pinnedCandidates) {
    const est = estimateTokens(c.entry);
    if (pinnedTokens + est > pinCap && pinned.length > 0) { pinnedExcluded++; continue; }
    pinned.push({
      id: c.id,
      title: c.entry.title,
      content: readMemoryBody(brainDir, c.entry.path),
      scope: c.scope,
      priority: c.priority,
      tokens: est,
    });
    pinnedTokens += est;
  }

  // --- Budget-bound the recall set with whatever the pin/skills tiers leave ---
  const skillsTokens = 0; // Phase 2
  const recallCap = Math.max(0, Math.min(config.recall_budget_tokens, cap - pinnedTokens - skillsTokens));
  const pinnedIds = new Set(pinned.map((p) => p.id));

  const context_recall = [];
  let used = 0;
  let excluded = 0;
  for (const mem of ranked.slice(0, top)) {
    if (pinnedIds.has(mem.id)) continue; // already presented in the pinned tier
    const est = estimateTokens(mem);
    if (used + est > recallCap && context_recall.length > 0) {
      excluded++;
      continue;
    }
    context_recall.push({
      id: mem.id,
      title: mem.title || path.basename(mem.path || '', '.md'),
      path: mem.path,
      type: mem.type,
      score: mem.score,
      token_estimate: est,
    });
    used += est;
  }

  // --- Due for review (matches the existing "has items" heuristic) ---
  let dueForReview = 0;
  try {
    const queue = readReviewQueue(projectRoot);
    if (queue && Array.isArray(queue.items)) dueForReview = queue.items.length;
  } catch (_) { dueForReview = 0; }

  // --- Low-confidence-but-frequently-used alerts ---
  const low_confidence_alerts = [];
  for (const [id, entry] of Object.entries(index.memories)) {
    if ((entry.access_count || 0) >= 3 && (entry.confidence ?? 1) < 0.5) {
      low_confidence_alerts.push({
        id,
        title: entry.title,
        confidence: entry.confidence,
        access_count: entry.access_count,
      });
    }
  }

  return {
    memory_count: memoryCount,
    pinned,
    skills_index: [],
    context_recall,
    due_for_review: dueForReview,
    low_confidence_alerts,
    budget: {
      cap,
      pin_cap: pinCap,
      recall_cap: recallCap,
      used: pinnedTokens + skillsTokens + used,
      pinned_tokens: pinnedTokens,
      recall_used: used,
      included: context_recall.length,
      excluded,
      pinned_excluded: pinnedExcluded,
    },
  };
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  try {
    const payload = computeSessionStart(undefined, args);
    console.log(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, computeSessionStart, estimateTokens, parseArgs };
