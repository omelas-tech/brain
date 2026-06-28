#!/usr/bin/env node

/**
 * brain memorize — Store memories from AI agent input
 *
 * Accepts a JSON payload via stdin with memory definitions.
 * Handles all plumbing: ID generation, directory creation, file writing,
 * index updates, association edges, search index, and optional sync.
 *
 * Usage:
 *   brain memorize [--sync] <<'EOF'
 *   { "memories": [{ "title": "...", "type": "learning", ... }] }
 *   EOF
 *
 * The AI agent decides WHAT to remember. This CLI handles HOW to write it.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  getBrainDir,
  readIndex,
  writeIndex,
  addMemory,
  generateId,
  readMeta,
  writeMeta,
  readAssociations,
  writeAssociations,
  reinforceEdge,
  readPinned,
  writePinned,
  atomicWriteSync,
  validateBrainPath,
} = require('../src/index-manager');
const { addDocument, createSearchIndex, readSearchIndex, writeSearchIndex } = require('../src/tfidf');

// Best-effort detection of the host AI agent, recorded on each memory's
// encoding_context for "where your brain is used" analytics. An explicit
// BRAIN_AGENT env var always wins (a per-agent install can set it); otherwise we
// sniff known markers. Unrecognized hosts record "unknown" (the cloud tolerates
// it). The non-Claude markers are best-effort.
function detectAgent() {
  const e = process.env;
  if (e.BRAIN_AGENT) return e.BRAIN_AGENT;
  if (e.CLAUDECODE || e.CLAUDE_CODE_ENTRYPOINT) return 'claude-code';
  if (e.GEMINI_CLI || e.GEMINI_CLI_VERSION) return 'gemini-cli';
  if (e.CODEX_HOME || e.CODEX_SANDBOX) return 'codex';
  if (e.OPENCODE || e.OPENCODE_BIN) return 'opencode';
  return 'unknown';
}
const HOST_AGENT = detectAgent();

// --- Type defaults ---

const TYPE_DEFAULTS = {
  decision:     { strength: 0.85, decay_rate: 0.995 },
  insight:      { strength: 0.90, decay_rate: 0.997 },
  goal:         { strength: 0.80, decay_rate: 0.993 },
  experience:   { strength: 0.75, decay_rate: 0.985 },
  learning:     { strength: 0.70, decay_rate: 0.990 },
  relationship: { strength: 0.70, decay_rate: 0.997 },
  preference:   { strength: 0.60, decay_rate: 0.998 },
  observation:  { strength: 0.40, decay_rate: 0.950 },
};

const COGNITIVE_ADJUSTMENTS = {
  episodic:   { strength_delta: +0.10, decay_multiplier: 0.995 },
  semantic:   { strength_delta: 0,     decay_multiplier: 1.0 },
  procedural: { strength_delta: -0.10, decay_multiplier: 1.003 },
};

// --- Args ---

function parseArgs(argv) {
  const args = { sync: false };
  for (const arg of argv) {
    if (arg === '--sync') args.sync = true;
  }
  return args;
}

// --- Helpers ---

function computeStrengthAndDecay(type, cognitiveType, strengthAdjustment = 0) {
  const typeDefaults = TYPE_DEFAULTS[type] || TYPE_DEFAULTS.observation;
  const cogAdj = COGNITIVE_ADJUSTMENTS[cognitiveType] || COGNITIVE_ADJUSTMENTS.semantic;

  const strength = Math.max(0, Math.min(1.0,
    typeDefaults.strength + cogAdj.strength_delta + strengthAdjustment
  ));
  // Cap strictly below 1.0. Procedural memories are meant to decay *slowly*, but
  // a multiplier that pushed decay_rate >= 1.0 would make effective strength GROW
  // over time (strength * decay_rate^days) — inverted decay. 0.9999/day is
  // "extremely slow" (a memory loses ~3% of its strength per year) without ever
  // inverting.
  const decay_rate = Math.min(0.9999, typeDefaults.decay_rate * cogAdj.decay_multiplier);

  return { strength: Math.round(strength * 100) / 100, decay_rate };
}

function buildMemoryFileContent(mem, id, now) {
  const { strength, decay_rate } = computeStrengthAndDecay(
    mem.type, mem.cognitive_type, mem.strength_adjustment
  );

  const fmLines = [
    '---',
    `id: ${id}`,
    `type: ${mem.type}`,
    `cognitive_type: ${mem.cognitive_type || 'semantic'}`,
    `created: "${now}"`,
    `last_accessed: "${now}"`,
    `access_count: 0`,
    `recall_history: []`,
    `strength: ${strength}`,
    `decay_rate: ${decay_rate}`,
    `salience: ${mem.salience ?? 0.5}`,
    `confidence: ${mem.confidence ?? 0.7}`,
  ];
  // CoALA Phase 1: pinned (always-loaded) and stable (decay-exempt) are emitted
  // only when set, so ordinary memories keep their existing frontmatter shape.
  if (mem.pinned) {
    fmLines.push('pinned: true');
    fmLines.push(`pin_scope: "${mem.pin_scope || 'global'}"`);
    fmLines.push(`pin_priority: ${mem.pin_priority || 0}`);
  }
  if (mem.stable) fmLines.push('stable: true');
  fmLines.push(
    `tags: [${(mem.tags || []).map(t => `"${t}"`).join(', ')}]`,
    `related: [${(mem.related || []).map(r => `"${r}"`).join(', ')}]`,
    `source: "${mem.source || ''}"`,
    `encoding_context:`,
    `  project: "${(mem.encoding_context && mem.encoding_context.project) || ''}"`,
    `  topics: [${((mem.encoding_context && mem.encoding_context.topics) || []).map(t => `"${t}"`).join(', ')}]`,
    `  task_type: "${(mem.encoding_context && mem.encoding_context.task_type) || ''}"`,
    `  agent: "${HOST_AGENT}"`,
    '---',
    '',
  );
  const frontmatter = fmLines.join('\n');

  return { fileContent: frontmatter + mem.content + '\n', strength, decay_rate };
}

function buildIndexEntry(mem, id, strength, decayRate, now) {
  const entry = {
    title: mem.title,
    path: mem.path,
    type: mem.type,
    cognitive_type: mem.cognitive_type || 'semantic',
    created: now,
    last_accessed: now,
    access_count: 0,
    strength,
    decay_rate: decayRate,
    salience: mem.salience ?? 0.5,
    confidence: mem.confidence ?? 0.7,
    tags: mem.tags || [],
    related: mem.related || [],
    encoding_context: { ...(mem.encoding_context || {}), agent: HOST_AGENT },
    // CoALA Phase 0: cheap chars/4 token estimate for working-memory budgeting.
    token_estimate: Math.ceil((mem.content || '').length / 4),
  };
  // CoALA Phase 1: only set when present — keeps existing index entries lean.
  if (mem.pinned) {
    entry.pinned = true;
    entry.pin_scope = mem.pin_scope || 'global';
    entry.pin_priority = mem.pin_priority || 0;
  }
  if (mem.stable) entry.stable = true;
  return entry;
}

function updateMetaFiles(brainDir, memPath) {
  const parts = memPath.split('/');
  // Walk up the directory chain, updating _meta.json at each level
  for (let i = 1; i <= parts.length - 1; i++) {
    const dirParts = parts.slice(0, i);
    const categoryPath = dirParts.join('/');
    const fullDir = path.join(brainDir, categoryPath);

    if (!fs.existsSync(fullDir)) continue;

    const metaPath = path.join(fullDir, '_meta.json');
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch {
      meta = { description: categoryPath, memory_count: 0, subcategories: [] };
    }

    meta.memory_count = (meta.memory_count || 0) + 1;

    // Add subcategory if this isn't the leaf directory
    if (i < parts.length - 1) {
      const subcat = parts[i];
      if (!meta.subcategories) meta.subcategories = [];
      if (!meta.subcategories.includes(subcat)) {
        meta.subcategories.push(subcat);
      }
    }

    atomicWriteSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
  }
}

function findTagOverlaps(index, newTags, newId, minOverlap = 2) {
  const overlaps = [];
  if (!newTags || newTags.length < minOverlap) return overlaps;

  const newTagSet = new Set(newTags);
  for (const [id, entry] of Object.entries(index.memories)) {
    if (id === newId) continue;
    const entryTags = entry.tags || [];
    const shared = entryTags.filter(t => newTagSet.has(t));
    if (shared.length >= minOverlap) {
      overlaps.push(id);
    }
  }
  return overlaps;
}

function trySync() {
  const brainDir = getBrainDir();

  // Try cloud sync first
  const cloudConfig = path.join(brainDir, '.cloud', 'config.json');
  if (fs.existsSync(cloudConfig)) {
    try {
      execSync('brain cloud push', { stdio: 'pipe', timeout: 30000 });
      return { method: 'cloud', success: true };
    } catch (err) {
      return { method: 'cloud', success: false, error: err.message };
    }
  }

  // Try git sync
  const gitConfig = path.join(brainDir, '.sync', 'config.json');
  if (fs.existsSync(gitConfig)) {
    try {
      // Use the git-sync module
      const gitSync = require('../src/git-sync');
      // Sync push is async, but we run sync for CLI simplicity
      execSync(`node -e "require('${path.join(__dirname, '..', 'src', 'git-sync.js')}').push('${brainDir}').then(() => process.exit(0)).catch(() => process.exit(1))"`, {
        stdio: 'pipe',
        timeout: 30000,
      });
      return { method: 'git', success: true };
    } catch (err) {
      return { method: 'git', success: false, error: err.message };
    }
  }

  return { method: 'none', success: false, error: 'No sync configured (cloud or git)' };
}

// --- Main ---

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Read JSON from stdin
  let inputData = '';
  if (process.stdin.isTTY) {
    console.error(JSON.stringify({ error: 'No input provided. Pipe JSON via stdin.' }));
    process.exit(1);
  }

  // Read from fd 0 rather than the '/dev/stdin' path: the path form fails with
  // ENXIO on Linux CI runners and doesn't exist on Windows, whereas fd 0 reads
  // piped stdin portably across Linux, macOS, and Windows.
  inputData = fs.readFileSync(0, 'utf-8');

  let input;
  try {
    input = JSON.parse(inputData);
  } catch (err) {
    console.error(JSON.stringify({ error: `Invalid JSON input: ${err.message}` }));
    process.exit(1);
  }

  if (!input.memories || !Array.isArray(input.memories) || input.memories.length === 0) {
    console.error(JSON.stringify({ error: 'Input must have a non-empty "memories" array' }));
    process.exit(1);
  }

  const brainDir = getBrainDir();

  // Validate brain exists
  if (!fs.existsSync(path.join(brainDir, 'index.json'))) {
    console.error(JSON.stringify({ error: `Brain not initialized. Run brain install first.` }));
    process.exit(1);
  }

  // Read current state
  let index;
  try {
    index = readIndex();
  } catch (err) {
    console.error(JSON.stringify({
      error: `Corrupt index.json in ~/.brain/ — ${err.message}. Fix the JSON manually or restore from sync/backup.`,
    }));
    process.exit(1);
  }

  let associations;
  try {
    associations = readAssociations() || { version: 1, edges: {} };
  } catch (err) {
    console.error(JSON.stringify({
      error: `Corrupt associations.json in ~/.brain/ — ${err.message}`,
    }));
    process.exit(1);
  }

  let searchIndex;
  try {
    searchIndex = readSearchIndex(brainDir) || createSearchIndex();
  } catch (err) {
    // Search index is non-critical — rebuild from scratch
    searchIndex = createSearchIndex();
  }

  const now = new Date().toISOString();
  const results = [];
  const newIds = [];
  const pinnedToAdd = [];

  for (const mem of input.memories) {
    // Validate required fields
    if (!mem.title || !mem.type || !mem.path || !mem.content) {
      console.error(JSON.stringify({
        error: `Memory missing required fields (title, type, path, content): ${JSON.stringify(mem.title || 'untitled')}`,
      }));
      process.exit(1);
    }

    if (!TYPE_DEFAULTS[mem.type]) {
      console.error(JSON.stringify({ error: `Unknown memory type: ${mem.type}` }));
      process.exit(1);
    }

    // Generate ID
    const id = generateId();
    newIds.push(id);

    // Compute strength/decay
    const { fileContent, strength, decay_rate } = buildMemoryFileContent(mem, id, now);

    // Create directories
    const fullPath = path.join(brainDir, mem.path);
    validateBrainPath(fullPath, brainDir);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    // Write memory file
    atomicWriteSync(fullPath, fileContent);

    // Update index
    const indexEntry = buildIndexEntry(mem, id, strength, decay_rate, now);
    addMemory(index, id, indexEntry);

    // CoALA Phase 1: register a born-pinned memory in the pinned manifest
    if (mem.pinned) {
      pinnedToAdd.push({
        id,
        scope: mem.pin_scope || 'global',
        priority: mem.pin_priority || 0,
        token_estimate: indexEntry.token_estimate,
      });
    }

    // Update associations — explicit related links
    for (const relatedId of (mem.related || [])) {
      if (index.memories[relatedId]) {
        reinforceEdge(associations, id, relatedId, 'manual', 0.20);
      }
    }

    // Update associations — tag overlaps
    const tagOverlaps = findTagOverlaps(index, mem.tags, id);
    for (const overlapId of tagOverlaps) {
      reinforceEdge(associations, id, overlapId, 'tag_overlap', 0.10);
    }

    // Tier B §10.2: surface potential contradictions with pinned/stable memories
    // (high tag overlap) so the agent can adjudicate — never auto-resolved here.
    const potentialConflicts = tagOverlaps
      .filter((oid) => {
        const e = index.memories[oid];
        return e && (e.pinned || e.stable);
      })
      .map((oid) => ({ id: oid, title: index.memories[oid].title }));

    // Update search index
    addDocument(searchIndex, id, {
      title: mem.title,
      tags: mem.tags,
      body: mem.content,
    });

    // Update _meta.json files
    updateMetaFiles(brainDir, mem.path);

    const edgesCreated = (mem.related || []).filter(r => index.memories[r]).length + tagOverlaps.length;

    results.push({
      id,
      title: mem.title,
      path: mem.path,
      type: mem.type,
      cognitive_type: mem.cognitive_type || 'semantic',
      strength,
      decay_rate,
      salience: mem.salience ?? 0.5,
      confidence: mem.confidence ?? 0.7,
      tags: mem.tags || [],
      edges_created: edgesCreated,
      ...(potentialConflicts.length ? { potential_conflicts: potentialConflicts } : {}),
    });
  }

  // Write all updated state
  writeIndex(index);
  writeAssociations(associations);
  writeSearchIndex(brainDir, searchIndex);

  // CoALA Phase 1: persist any born-pinned memories to the pinned manifest
  if (pinnedToAdd.length > 0) {
    const pinned = readPinned();
    for (const p of pinnedToAdd) {
      pinned.pins = pinned.pins.filter((x) => x.id !== p.id);
      pinned.pins.push(p);
    }
    writePinned(pinned);
  }

  // Build output
  const output = {
    stored: results,
    total: results.length,
    index_count: index.memory_count,
  };

  // Sync if requested
  if (args.sync || input.auto_sync) {
    const syncResult = trySync();
    output.sync = syncResult;
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
