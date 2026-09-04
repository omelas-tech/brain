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
const { execSync, execFileSync } = require('child_process');
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
  readConfig,
  atomicWriteSync,
  validateBrainPath,
} = require('../src/index-manager');
const { addDocument, createSearchIndex, readSearchIndex, writeSearchIndex } = require('../src/tfidf');
const { appendAudit } = require('../src/audit');
const { lintMemoryContent } = require('../src/content-lint');
const { contentHash } = require('../src/integrity');
const { proposeSupersessions } = require('../src/contradiction');
const { quarantineDecision } = require('../src/quarantine');
const {
  validateValidity,
  supersessionInstant,
  applySupersession,
} = require('../src/temporal');

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

// --- Provenance (OWASP ASI06: memory poisoning) ---
//
// Where a memory came from decides how much it is allowed to entrench itself.
// The policy table lives in src/provenance.js (shared with the recall-side
// trust weighting in src/scorer.js). The pin/stable restriction is the part
// that holds regardless of caller honesty: entrenchment is simply not
// reachable from this path without an explicit user origin.
const { ORIGIN_POLICY, DEFAULT_ORIGIN } = require('../src/provenance');
const { sensitivityDecision, SENSITIVE_OPT_OUT_REASON } = require('../src/sensitivity');

// --- Args ---

function parseArgs(argv) {
  const args = { sync: false };
  for (const arg of argv) {
    if (arg === '--sync') args.sync = true;
  }
  return args;
}

// --- Helpers ---

/**
 * Resolve a memory's origin and clamp its trust-bearing fields to what that
 * origin is permitted to claim.
 *
 * Returns `{ origin, policy, mem, clamps }` where `mem` is a sanitized copy and
 * `clamps` lists every explicit over-ask the policy lowered — surfaced in the
 * CLI output so a downgrade is never silent. Returns `{ error }` for requests
 * that have no benign reading.
 */
function applyOriginPolicy(mem) {
  const origin = mem.origin || DEFAULT_ORIGIN;
  const policy = ORIGIN_POLICY[origin];
  if (!policy) {
    return { error: `Unknown origin "${origin}" (expected one of: ${Object.keys(ORIGIN_POLICY).join(', ')})` };
  }

  // Entrenchment — loading into every session, or exemption from decay — is a
  // capability, not a magnitude. Tool output and inbound email have no benign
  // reason to request it, so this is refused loudly rather than quietly capped.
  if (!policy.allow_entrench && (mem.pinned || mem.stable)) {
    const asked = [mem.pinned && 'pinned', mem.stable && 'stable'].filter(Boolean).join(' + ');
    return {
      error: `Origin "${origin}" may not set ${asked}. Entrenching a memory requires origin ` +
             `"user" — or pin it deliberately afterwards with \`brain pin <id>\`.`,
    };
  }

  const clamps = [];
  const clamp = (field, requested, fallback, max) => {
    const value = requested ?? fallback;
    if (value <= max) return value;
    // Only report a downgrade the caller actually asked for. A lowered default
    // is the policy working as designed, not a rejected claim.
    if (requested != null) clamps.push({ field, requested, allowed: max, origin });
    return max;
  };

  return {
    origin,
    policy,
    clamps,
    mem: {
      ...mem,
      salience: clamp('salience', mem.salience, 0.5, policy.max_salience),
      confidence: clamp('confidence', mem.confidence, 0.7, policy.max_confidence),
      // A non-user origin may lower a memory's base strength but never raise it.
      strength_adjustment: clamp(
        'strength_adjustment', mem.strength_adjustment, 0,
        policy.allow_entrench ? Infinity : 0
      ),
    },
  };
}

function computeStrengthAndDecay(type, cognitiveType, strengthAdjustment = 0, originDecayMultiplier = 1.0) {
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
  // The origin multiplier rides on top: memory sourced from untrusted content
  // fades faster, so a planted fact loses to a genuine one over time even if
  // nothing ever detects it as an attack.
  const decay_rate = Math.min(
    0.9999,
    typeDefaults.decay_rate * cogAdj.decay_multiplier * originDecayMultiplier
  );

  return { strength: Math.round(strength * 100) / 100, decay_rate };
}

function buildMemoryFileContent(mem, id, now, origin, originDecayMultiplier, quarantine) {
  const { strength, decay_rate } = computeStrengthAndDecay(
    mem.type, mem.cognitive_type, mem.strength_adjustment, originDecayMultiplier
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
  // ASI06 quarantine: pending-verification state travels with the memory —
  // same conditional-field pattern as pinned/stable, so it syncs and restores
  // with the file and syncs via the index entry.
  if (quarantine && quarantine.quarantined) {
    fmLines.push('quarantined: true');
    fmLines.push(`quarantine_reasons: [${quarantine.reasons.map((r) => `"${r}"`).join(', ')}]`);
    fmLines.push(`quarantine_flagged: "${now}"`);
  }
  // Temporal invalidation: record which memories this one replaces. The
  // reciprocal `superseded_by` is stamped on those targets in main().
  if (mem.supersedes && mem.supersedes.length) {
    fmLines.push(`supersedes: [${mem.supersedes.map((s) => `"${s}"`).join(', ')}]`);
  }
  // Bitemporal valid time — when the fact was true, as opposed to `created`
  // (when it was recorded). Emitted only when the author bounded it.
  if (mem.valid_from) fmLines.push(`valid_from: "${mem.valid_from}"`);
  if (mem.valid_until) fmLines.push(`valid_until: "${mem.valid_until}"`);
  // Consent tier (src/sensitivity.js) — only non-standard levels are written.
  if (mem.sensitivity && mem.sensitivity !== 'standard') fmLines.push(`sensitivity: "${mem.sensitivity}"`);
  fmLines.push(
    `tags: [${(mem.tags || []).map(t => `"${t}"`).join(', ')}]`,
    `related: [${(mem.related || []).map(r => `"${r}"`).join(', ')}]`,
    `origin: "${origin}"`,
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

function buildIndexEntry(mem, id, strength, decayRate, now, origin, quarantine) {
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
    // Provenance travels with the index entry so recall can weigh and flag it
    // without having to open every memory file.
    origin,
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
  if (quarantine && quarantine.quarantined) {
    entry.quarantined = true;
    entry.quarantine_reasons = quarantine.reasons;
    entry.quarantine_flagged = now;
  }
  if (mem.supersedes && mem.supersedes.length) entry.supersedes = mem.supersedes;
  if (mem.valid_from) entry.valid_from = mem.valid_from;
  if (mem.valid_until) entry.valid_until = mem.valid_until;
  if (mem.sensitivity && mem.sensitivity !== 'standard') entry.sensitivity = mem.sensitivity;
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
      // push() is async; run it in a child so this CLI can stay synchronous.
      // Paths travel as argv — never interpolated into a shell string, where a
      // quote in $BRAIN_DIR would break out of it.
      execFileSync(
        process.execPath,
        [
          '-e',
          "require(process.argv[1]).push(process.argv[2]).then(() => process.exit(0)).catch(() => process.exit(1))",
          path.join(__dirname, '..', 'src', 'git-sync.js'),
          brainDir,
        ],
        { stdio: 'pipe', timeout: 30000 }
      );
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
  // Quarantine mode ('off' | 'flag' | 'enforce', default 'flag') — read once;
  // readConfig tolerates a missing/corrupt config.json by falling back to defaults.
  const config = readConfig();
  const results = [];
  const newIds = [];
  const pinnedToAdd = [];
  const clampsReported = [];
  const auditErrors = [];

  for (const rawMem of input.memories) {
    // Validate required fields
    if (!rawMem.title || !rawMem.type || !rawMem.path || !rawMem.content) {
      console.error(JSON.stringify({
        error: `Memory missing required fields (title, type, path, content): ${JSON.stringify(rawMem.title || 'untitled')}`,
      }));
      process.exit(1);
    }

    if (!TYPE_DEFAULTS[rawMem.type]) {
      console.error(JSON.stringify({ error: `Unknown memory type: ${rawMem.type}` }));
      process.exit(1);
    }

    // Bitemporal window, if the author bounded one. Rejected at write time
    // rather than stored: an inverted window makes the memory invisible to
    // every as-of query, which is far harder to notice than a failed write.
    const validity = validateValidity(rawMem);
    if (validity) {
      console.error(JSON.stringify({ error: `${validity.error} — memory: ${JSON.stringify(rawMem.title)}` }));
      process.exit(1);
    }

    // Provenance gate (ASI06) — decide what this origin is allowed to claim
    // before anything reaches disk.
    const policy = applyOriginPolicy(rawMem);
    if (policy.error) {
      console.error(JSON.stringify({ error: `${policy.error} — memory: ${JSON.stringify(rawMem.title)}` }));
      process.exit(1);
    }
    const { origin } = policy;
    const mem = policy.mem;
    for (const c of policy.clamps) clampsReported.push({ ...c, title: rawMem.title });

    // ASI06 content lint + quarantine decision. Lint runs for every origin
    // (cheap, and the flags feed forensics even when nothing is quarantined);
    // the decision flags low-trust origins and injection-shaped content.
    const lint = lintMemoryContent(mem);
    const quarantine = quarantineDecision({ origin, lintResult: lint, config });

    // Sensitive-topic consent (src/sensitivity.js). `blocked` content is
    // refused outright; `sensitive` content is stored only after the user
    // opted in — otherwise it lands quarantined and hidden, and approving it
    // is the per-item consent. Evaluated after the origin gate so a refusal
    // names the real reason, and before anything reaches disk.
    const sensitivity = sensitivityDecision(mem, config);
    if (sensitivity.error) {
      console.error(JSON.stringify({ error: `${sensitivity.error} — memory: ${JSON.stringify(rawMem.title)}` }));
      process.exit(1);
    }
    if (sensitivity.action === 'refuse') {
      console.error(JSON.stringify({
        error: `Refused: content classified "blocked" (${sensitivity.categories.join(', ') || 'declared by caller'}) — ` +
               `identification numbers, criminal history and immigration status are never stored — memory: ${JSON.stringify(rawMem.title)}`,
        sensitivity: 'blocked',
        categories: sensitivity.categories,
      }));
      process.exit(1);
    }
    if (sensitivity.action === 'quarantine') {
      quarantine.quarantined = true;
      quarantine.reasons = [...quarantine.reasons, SENSITIVE_OPT_OUT_REASON];
    }
    mem.sensitivity = sensitivity.level;

    // Generate ID
    const id = generateId();
    newIds.push(id);

    // Compute strength/decay
    const { fileContent, strength, decay_rate } = buildMemoryFileContent(
      mem, id, now, origin, policy.policy.decay_multiplier, quarantine
    );

    // Create directories
    const fullPath = path.join(brainDir, mem.path);
    validateBrainPath(fullPath, brainDir);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    // Write memory file
    atomicWriteSync(fullPath, fileContent);

    // Record the write before reporting success. An audit failure is surfaced
    // rather than thrown: the memory is already on disk, and silently dropping
    // the trail would be the worse outcome of the two.
    try {
      appendAudit(brainDir, {
        ts: now,
        event: 'memorize',
        id,
        origin,
        agent: HOST_AGENT,
        type: mem.type,
        path: mem.path,
        title: mem.title,
        salience: mem.salience ?? 0.5,
        confidence: mem.confidence ?? 0.7,
        decay_rate,
        entrenched: Boolean(mem.pinned || mem.stable),
        clamped: policy.clamps.map((c) => c.field),
        ...(lint.flags.length ? { lint: lint.flags.map((f) => f.rule) } : {}),
        ...(quarantine.quarantined ? { quarantined: true, quarantine_reasons: quarantine.reasons } : {}),
        ...(mem.sensitivity !== 'standard' ? { sensitivity: mem.sensitivity, sensitivity_categories: sensitivity.categories } : {}),
      });
    } catch (err) {
      auditErrors.push({ id, error: err.message });
    }

    // Update index
    const indexEntry = buildIndexEntry(mem, id, strength, decay_rate, now, origin, quarantine);
    // Integrity baseline (OWASP ASI06, Store phase): record what this memory
    // said the moment the brain agreed with it, hashed from the exact bytes
    // just written. `brain audit` compares against this to catch edits that
    // never came through a write path — the one poisoning route every other
    // defense here is blind to. See src/integrity.js.
    indexEntry.content_hash = contentHash(fileContent);
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

    // Temporal invalidation: stamp `superseded_by` on each memory this one
    // replaces (index + frontmatter), plus the valid-time boundary the
    // replacement implies. The scorer strongly demotes a superseded memory so
    // the successor wins, without dropping it — "this was true until now"
    // stays answerable. Unknown target ids are skipped silently (they may have
    // been forgotten).
    //
    // ASI06: a quarantined write must NOT demote anything yet. Supersession is
    // a write against *existing, already-trusted* memory — a poisoned external
    // page claiming "the deploy target changed" would otherwise knock the real
    // memory down 4x at recall before any human looked at it, which is the
    // whole harm quarantine exists to prevent. The intent is recorded on the
    // pending memory and applied by `brain verify approve`.
    const targets = mem.supersedes || [];
    const deferSupersede = targets.length > 0 && quarantine.quarantined;
    let supersededNow = [];

    if (targets.length > 0 && !deferSupersede) {
      supersededNow = applySupersession(brainDir, index, id, targets, {
        validUntil: supersessionInstant({ valid_from: mem.valid_from, created: now }),
      });
      for (const t of supersededNow) reinforceEdge(associations, id, t.id, 'manual', 0.20);
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

    // Tier B §10.2: surface potential contradictions so the agent can
    // adjudicate — never auto-resolved here. Each proposal carries the
    // `valid_until` a supersede would stamp, so the agent can offer the
    // boundary ("shall I mark the old one as ended on <date>?") instead of
    // leaving two unbounded facts competing in every future recall.
    const potentialConflicts = proposeSupersessions(
      index,
      { ...mem, created: now },
      tagOverlaps,
      { now },
    );

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
      origin,
      salience: mem.salience ?? 0.5,
      confidence: mem.confidence ?? 0.7,
      tags: mem.tags || [],
      edges_created: edgesCreated,
      ...(potentialConflicts.length ? { potential_conflicts: potentialConflicts } : {}),
      // Surfaced so the agent can tell the user a write went to pending
      // verification (and why) — mirrors provenance_clamps reporting.
      ...(quarantine.quarantined
        ? { quarantine_pending: true, quarantine_reasons: quarantine.reasons }
        : {}),
      ...(lint.flags.length ? { lint_flags: lint.flags.map((f) => f.rule) } : {}),
      // Consent tier. `sensitive_opt_out` means the memory is stored but hidden
      // until the user opts in (config) or approves it (`brain verify approve`).
      ...(mem.sensitivity !== 'standard' ? { sensitivity: mem.sensitivity } : {}),
      ...(sensitivity.action === 'quarantine' ? { sensitive_opt_out: true } : {}),
      ...(supersededNow.length ? { superseded: supersededNow } : {}),
      // Held back until verification — surfaced so the agent can tell the user
      // the replacement it asked for has not taken effect yet.
      ...(deferSupersede ? { supersede_pending: targets } : {}),
      ...(mem.valid_from ? { valid_from: mem.valid_from } : {}),
      ...(mem.valid_until ? { valid_until: mem.valid_until } : {}),
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
    // Only present when the provenance policy actually lowered something, so
    // the agent can tell the user a claim was downgraded and why.
    ...(clampsReported.length ? { provenance_clamps: clampsReported } : {}),
    ...(auditErrors.length ? { audit_errors: auditErrors } : {}),
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
