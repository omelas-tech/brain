#!/usr/bin/env node

/**
 * brain session-start — budget-aware working-memory payload (CoALA Phase 0).
 *
 * One deterministic call returning everything the agent should internalize at
 * session start, bounded by the working-memory token budget in config.json so
 * Brain can never bloat the host's context window.
 *
 * Usage:
 *   brain session-start [--project P] [--topics a,b] [--task T] [--top N] [--budget TOKENS]
 *
 * --budget lowers the working-memory cap for this call only (never raises it):
 * hosts with a smaller injection window than config.json assumes — Codex caps
 * hook context at ~2,500 tokens — pass the room they actually have.
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
  bm25Search,
  rebuildIndex,
  isSearchIndexStale,
} = require('../src/tfidf');

const {
  readIndex,
  readAssociations,
  readReviewQueue,
  readConfig,
  getBrainDir,
} = require('../src/index-manager');

const { rankMemories } = require('../src/scorer');
const { advertisedSummaries } = require('../src/skills');
const { receiptFor } = require('../src/receipt');
const { temporalState } = require('../src/temporal');
const { DEFAULT_ORIGIN, isLowTrust } = require('../src/provenance');
const { isSensitiveHidden } = require('../src/sensitivity');

function parseArgs(argv) {
  const args = { project: null, topics: null, task: null, top: 5, budget: null };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--project': args.project = argv[++i]; break;
      case '--topics': args.topics = argv[++i]; break;
      case '--task': args.task = argv[++i]; break;
      case '--top': args.top = parseInt(argv[++i], 10) || 5; break;
      case '--budget': args.budget = parseInt(argv[++i], 10) || null; break;
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

/** chars/4 token estimate for a minted receipt line (counted against budgets). */
function receiptTokens(receipt) {
  return receipt ? Math.ceil(receipt.length / 4) : 0;
}

/**
 * Tier B §10.4 — reorder an importance-sorted list so the top items land at the
 * edges (start + end), where models attend best, leaving the middle for lower
 * ranks. Deterministic. e.g. [1,2,3,4,5] → [1,3,5,4,2].
 */
function edgeOrder(arr) {
  const front = [];
  const back = [];
  arr.forEach((item, i) => { if (i % 2 === 0) front.push(item); else back.unshift(item); });
  return front.concat(back);
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
 * @param {Object} [args] - { project, topics, task, top, budget }
 * @returns {Object} The session-start payload
 */
function computeSessionStart(projectRoot, args = {}) {
  const top = args.top || 5;
  const brainDir = getBrainDir(projectRoot);
  const config = readConfig(projectRoot);
  // A caller-supplied budget can only tighten the configured cap.
  const cap = args.budget > 0
    ? Math.min(config.working_memory_budget_tokens, args.budget)
    : config.working_memory_budget_tokens;

  const empty = {
    memory_count: 0,
    pinned: [],          // Phase 1: always-present semantic tier
    skills_index: [],    // Phase 2: procedural skill summaries
    context_recall: [],
    due_for_review: 0,
    pending_verification: 0,
    pending_verification_items: [],
    low_confidence_alerts: [],
    budget: { cap, recall_cap: config.recall_budget_tokens, used: 0, included: 0, excluded: 0 },
  };

  if (!fs.existsSync(path.join(brainDir, 'index.json'))) return empty;

  const index = readIndex(projectRoot);
  if (!index || !index.memories) return empty;

  // Note: we proceed even with zero memories — pins and skills are independent
  // of episodic memory and should still be surfaced.
  const memoryCount = Object.keys(index.memories).length;

  // --- Context recall (deterministic, reuses the recall engine) ---
  // Rebuild when ABSENT *or* STALE — session-start is the first thing a session
  // runs (e.g. right after a `sync pull`), so it is the most likely path to hit
  // a search index that has drifted out of sync with index.json. A present-but-
  // stale index silently zeroes every relevance score (matches recall.js).
  let searchIndex = null;
  try { searchIndex = readSearchIndex(brainDir); } catch (_) { searchIndex = null; }
  if (isSearchIndexStale(searchIndex, index)) {
    searchIndex = rebuildIndex(brainDir, index);
    writeSearchIndex(brainDir, searchIndex);
  }

  const tfidfScores = bm25Search(searchIndex, buildContextQuery(args));
  // Enforce-mode quarantine: pending-verification memories are excluded from
  // the ranked pool entirely (flag mode includes them, marked). The pending
  // COUNT below always scans the full index, so the agent still learns that
  // items are waiting even when they are hidden.
  const quarantineMode = config.quarantine_mode || 'flag';
  const memories = Object.entries(index.memories)
    .filter(([, entry]) => quarantineMode !== 'enforce' || !entry.quarantined)
    // Consent: sensitive-topic memories stay out of working memory until the
    // user opts in or approves them one by one.
    .filter(([, entry]) => !isSensitiveHidden(entry, config))
    .map(([id, entry]) => ({ id, ...entry }));

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
  const nowMs = Date.now();
  let expiredPins = 0;
  for (const [id, entry] of Object.entries(index.memories)) {
    if (!entry.pinned) continue;
    // Defensive: pinning a quarantined memory is refused, but state synced
    // from another device could carry both flags — never load it every session.
    if (entry.quarantined && quarantineMode !== 'off') continue;
    if (isSensitiveHidden(entry, config)) continue;
    // Bitemporal: the pinned tier is presented to the agent as always-apply
    // active constraints, and a fact whose validity window has closed is not a
    // constraint any more. Drop it here rather than asserting it every session
    // — it stays reachable through ordinary recall, demoted and ⌛-marked, and
    // the count below tells the user to update or unpin it.
    if (temporalState(entry, nowMs) === 'expired') { expiredPins++; continue; }
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
    const receipt = receiptFor(c.entry);
    const est = estimateTokens(c.entry) + receiptTokens(receipt);
    if (pinnedTokens + est > pinCap && pinned.length > 0) { pinnedExcluded++; continue; }
    pinned.push({
      id: c.id,
      title: c.entry.title,
      content: readMemoryBody(brainDir, c.entry.path),
      scope: c.scope,
      priority: c.priority,
      tokens: est,
      receipt,
    });
    pinnedTokens += est;
  }

  // --- Skills index (CoALA Phase 2): advertise name + description only (L0) ---
  const skills_index = [];
  let skillsTokens = 0;
  let skillsExcluded = 0;
  const skillsCap = Math.min(config.skills_index_budget_tokens, Math.max(0, cap - pinnedTokens));
  for (const s of advertisedSummaries(projectRoot)) {
    const est = Math.ceil(((s.name || '').length + (s.description || '').length + 8) / 4);
    if (skillsTokens + est > skillsCap && skills_index.length > 0) { skillsExcluded++; continue; }
    skills_index.push({ name: s.name, description: s.description });
    skillsTokens += est;
  }

  // --- Budget-bound the recall set with whatever the pin/skills tiers leave ---
  const recallCap = Math.max(0, Math.min(config.recall_budget_tokens, cap - pinnedTokens - skillsTokens));
  const pinnedIds = new Set(pinned.map((p) => p.id));

  const context_recall = [];
  let used = 0;
  let excluded = 0;
  for (const mem of ranked.slice(0, top)) {
    if (pinnedIds.has(mem.id)) continue; // already presented in the pinned tier
    const title = mem.title || path.basename(mem.path || '', '.md');
    const receipt = receiptFor({ ...mem, title });
    const est = estimateTokens(mem) + receiptTokens(receipt);
    if (used + est > recallCap && context_recall.length > 0) {
      excluded++;
      continue;
    }
    const origin = mem.origin || DEFAULT_ORIGIN;
    context_recall.push({
      id: mem.id,
      title,
      path: mem.path,
      type: mem.type,
      score: mem.score,
      origin,
      ...(isLowTrust(origin) ? { low_trust: true } : {}),
      ...(mem.quarantined ? { quarantine_pending: true } : {}),
      // Bitemporal: surfaced but no longer true — the agent must frame it as
      // "that was the case until <valid_until>", never as current.
      ...(mem.temporal_state === 'expired' ? { expired: true, valid_until: mem.valid_until } : {}),
      token_estimate: est,
      receipt,
    });
    used += est;
  }

  // --- Due for review (matches the existing "has items" heuristic) ---
  let dueForReview = 0;
  try {
    const queue = readReviewQueue(projectRoot);
    if (queue && Array.isArray(queue.items)) dueForReview = queue.items.length;
  } catch (_) { dueForReview = 0; }

  // --- Pending verification (ASI06 quarantine) — count over the FULL index ---
  // Cheapest possible surface: a count plus up to five {id, title, origin}
  // stubs, so the agent can say "N memories are awaiting review" and route the
  // user to `brain verify list` without spending budget on bodies.
  const pendingAll = [];
  for (const [id, entry] of Object.entries(index.memories)) {
    if (entry.quarantined) pendingAll.push({ id, title: entry.title, origin: entry.origin });
  }

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
    skills_index,
    context_recall: edgeOrder(context_recall), // Tier B §10.4: top ranks at the edges
    due_for_review: dueForReview,
    // Pins whose validity window has closed — held out of the always-apply
    // tier above, and worth telling the user so they can update or unpin.
    expired_pins: expiredPins,
    pending_verification: pendingAll.length,
    pending_verification_items: pendingAll.slice(0, 5),
    low_confidence_alerts,
    budget: {
      cap,
      pin_cap: pinCap,
      skills_cap: skillsCap,
      recall_cap: recallCap,
      used: pinnedTokens + skillsTokens + used,
      pinned_tokens: pinnedTokens,
      skills_tokens: skillsTokens,
      recall_used: used,
      included: context_recall.length,
      excluded,
      pinned_excluded: pinnedExcluded,
      skills_excluded: skillsExcluded,
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

module.exports = { main, computeSessionStart, estimateTokens, parseArgs, edgeOrder };
