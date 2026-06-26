const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getBrainDir, writeIndex, readConfig, writeConfig, DEFAULT_CONFIG } = require('../src/index-manager');
const { createSearchIndex, addDocument, writeSearchIndex, readSearchIndex } = require('../src/tfidf');
const { computeSessionStart, estimateTokens, edgeOrder } = require('../bin/session-start');

let tmpDir;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-ss-'));
  fs.mkdirSync(path.join(tmpDir, '.brain'), { recursive: true });
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function makeIndex(memories = {}) {
  return {
    version: '2.0',
    memory_count: Object.keys(memories).length,
    memories,
    last_updated: new Date().toISOString(),
  };
}

function entry(overrides = {}) {
  return {
    title: 'Memory',
    path: 'professional/m.md',
    type: 'learning',
    cognitive_type: 'semantic',
    created: new Date().toISOString(),
    last_accessed: new Date().toISOString(),
    access_count: 0,
    strength: 0.7,
    decay_rate: 0.99,
    salience: 0.5,
    confidence: 0.8,
    tags: [],
    related: [],
    encoding_context: {},
    token_estimate: 25,
    ...overrides,
  };
}

/** Seed a temp brain with an index + matching search index. */
function seed(memories) {
  writeIndex(makeIndex(memories), tmpDir);
  const brainDir = getBrainDir(tmpDir);
  const si = createSearchIndex();
  for (const [id, e] of Object.entries(memories)) {
    addDocument(si, id, { title: e.title, body: e.title, tags: e.tags || [] });
  }
  writeSearchIndex(brainDir, si);
}

describe('config helpers', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('readConfig returns defaults when no config.json exists', () => {
    assert.deepEqual(readConfig(tmpDir), DEFAULT_CONFIG);
  });

  it('readConfig merges on-disk values over defaults', () => {
    writeConfig({ recall_budget_tokens: 42 }, tmpDir);
    const cfg = readConfig(tmpDir);
    assert.equal(cfg.recall_budget_tokens, 42);
    assert.equal(cfg.working_memory_budget_tokens, DEFAULT_CONFIG.working_memory_budget_tokens);
  });

  it('readConfig falls back to defaults on corrupt config (never throws)', () => {
    fs.writeFileSync(path.join(tmpDir, '.brain', 'config.json'), '{ not valid json');
    assert.deepEqual(readConfig(tmpDir), DEFAULT_CONFIG);
  });
});

describe('edgeOrder (Tier B §10.4)', () => {
  it('places top ranks at the edges', () => {
    assert.deepEqual(edgeOrder([1, 2, 3, 4, 5]), [1, 3, 5, 4, 2]);
  });
  it('is a no-op for 0/1/2 items', () => {
    assert.deepEqual(edgeOrder([]), []);
    assert.deepEqual(edgeOrder(['a']), ['a']);
    assert.deepEqual(edgeOrder(['a', 'b']), ['a', 'b']);
  });
});

describe('estimateTokens', () => {
  it('uses token_estimate when present', () => {
    assert.equal(estimateTokens({ token_estimate: 17 }), 17);
  });
  it('falls back to a title-based estimate when absent', () => {
    assert.ok(estimateTokens({ title: 'abcd' }) > 0);
  });
});

describe('computeSessionStart', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('returns an empty payload when no brain exists', () => {
    const p = computeSessionStart(tmpDir, {});
    assert.equal(p.memory_count, 0);
    assert.deepEqual(p.context_recall, []);
    assert.deepEqual(p.pinned, []);
    assert.deepEqual(p.skills_index, []);
    assert.equal(p.budget.cap, DEFAULT_CONFIG.working_memory_budget_tokens);
  });

  it('returns memory count and budget-bounded recall', () => {
    seed({
      mem_a: entry({ title: 'Database pooling', path: 'a.md' }),
      mem_b: entry({ title: 'JWT auth', path: 'b.md' }),
    });
    const p = computeSessionStart(tmpDir, { top: 5 });
    assert.equal(p.memory_count, 2);
    assert.ok(p.context_recall.length > 0);
    assert.ok(p.budget.used <= p.budget.cap, 'never exceeds working-memory cap');
    assert.ok(p.budget.used <= p.budget.recall_cap, 'recall stays within recall cap');
  });

  it('rebuilds a STALE search index (drift), not just an absent one', () => {
    // index.json has two memories…
    writeIndex(makeIndex({
      mem_a: entry({ title: 'Database pooling', path: 'a.md' }),
      mem_b: entry({ title: 'Terraform modules', path: 'b.md' }),
    }), tmpDir);
    // …but the persisted search index only knows about one (drifted, e.g. after
    // a sync pull / consolidate that added mem_b outside addDocument's path).
    const brainDir = getBrainDir(tmpDir);
    const si = createSearchIndex();
    addDocument(si, 'mem_a', { title: 'Database pooling', body: 'Database pooling', tags: [] });
    writeSearchIndex(brainDir, si);

    const p = computeSessionStart(tmpDir, { topics: 'terraform', top: 5 });

    // Before the fix, session-start saw a present index and skipped the rebuild,
    // so mem_b scored relevance 0. Now the drift is detected and rebuilt.
    const rebuilt = readSearchIndex(brainDir);
    assert.ok(rebuilt && rebuilt.documents.mem_b, 'mem_b must be in the rebuilt search index');
    assert.equal(p.memory_count, 2);
  });

  it('enforces the recall token budget and reports overflow', () => {
    // recall_cap = 30, each memory ~25 tokens → first fits, rest excluded
    writeConfig({ recall_budget_tokens: 30 }, tmpDir);
    seed({
      mem_a: entry({ title: 'A', path: 'a.md', token_estimate: 25 }),
      mem_b: entry({ title: 'B', path: 'b.md', token_estimate: 25 }),
      mem_c: entry({ title: 'C', path: 'c.md', token_estimate: 25 }),
    });
    const p = computeSessionStart(tmpDir, { top: 5 });
    assert.equal(p.budget.included, 1);
    assert.equal(p.budget.excluded, 2);
    assert.ok(p.budget.used <= 30, `used ${p.budget.used} must be <= recall cap 30`);
  });

  it('flags low-confidence, frequently-used memories', () => {
    seed({
      mem_lo: entry({ title: 'Shaky fact', path: 'lo.md', access_count: 5, confidence: 0.3 }),
      mem_ok: entry({ title: 'Solid fact', path: 'ok.md', access_count: 5, confidence: 0.9 }),
    });
    const p = computeSessionStart(tmpDir, {});
    assert.equal(p.low_confidence_alerts.length, 1);
    assert.equal(p.low_confidence_alerts[0].id, 'mem_lo');
  });
});

// ===========================================================================
// parseArgs (exported, previously only exercised indirectly)
// ===========================================================================
const { parseArgs } = require('../bin/session-start');

describe('parseArgs', () => {
  it('returns sensible defaults for no args', () => {
    assert.deepEqual(parseArgs([]), { project: null, topics: null, task: null, top: 5 });
  });
  it('parses every recognized flag', () => {
    const a = parseArgs(['--project', 'app', '--topics', 'x,y', '--task', 'impl', '--top', '3']);
    assert.equal(a.project, 'app');
    assert.equal(a.topics, 'x,y');
    assert.equal(a.task, 'impl');
    assert.equal(a.top, 3);
  });
  it('falls back to top=5 when --top is not a number', () => {
    assert.equal(parseArgs(['--top', 'abc']).top, 5);
  });
  it('ignores unknown flags and tolerates a trailing valueless flag', () => {
    const a = parseArgs(['--bogus', 'val', '--project']);
    assert.equal(a.project, undefined); // argv[++i] runs off the end
    assert.equal(a.top, 5);
  });
});

// ===========================================================================
// Pinned tier: scope filtering, priority ordering, missing-body tolerance
// ===========================================================================
describe('computeSessionStart pinned tier', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('includes global pins always but project pins only for the matching project', () => {
    seed({
      g: entry({ title: 'Global', pinned: true, pin_scope: 'global', path: 'g.md' }),
      mine: entry({ title: 'Mine', pinned: true, pin_scope: 'project:myapp', path: 'mine.md' }),
      other: entry({ title: 'Other', pinned: true, pin_scope: 'project:other', path: 'other.md' }),
    });
    const ids = computeSessionStart(tmpDir, { project: 'myapp' }).pinned.map((p) => p.id);
    assert.ok(ids.includes('g'));
    assert.ok(ids.includes('mine'));
    assert.ok(!ids.includes('other'), 'out-of-project pin excluded');
  });

  it('drops all project-scoped pins when no project is supplied', () => {
    seed({ mine: entry({ pinned: true, pin_scope: 'project:myapp', path: 'mine.md' }) });
    assert.equal(computeSessionStart(tmpDir, {}).pinned.length, 0);
  });

  it('orders pins by descending priority', () => {
    seed({
      lo: entry({ title: 'Lo', pinned: true, pin_scope: 'global', pin_priority: 1, path: 'lo.md' }),
      hi: entry({ title: 'Hi', pinned: true, pin_scope: 'global', pin_priority: 9, path: 'hi.md' }),
    });
    const pinned = computeSessionStart(tmpDir, {}).pinned;
    assert.equal(pinned[0].id, 'hi');
    assert.equal(pinned[1].id, 'lo');
  });

  it('reads a pinned body from disk and tolerates a pin whose file is missing', () => {
    seed({
      present: entry({ title: 'Present', pinned: true, pin_scope: 'global', path: 'present.md' }),
      gone: entry({ title: 'Gone', pinned: true, pin_scope: 'global', path: 'gone.md' }),
    });
    fs.writeFileSync(path.join(getBrainDir(tmpDir), 'present.md'), '---\nid: present\n---\nVISIBLE BODY\n');
    const pinned = computeSessionStart(tmpDir, {}).pinned;
    assert.equal(pinned.find((p) => p.id === 'present').content, 'VISIBLE BODY');
    assert.equal(pinned.find((p) => p.id === 'gone').content, '', 'missing file → empty body, no throw');
  });
});
