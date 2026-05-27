const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getBrainDir, writeIndex, readConfig, writeConfig, DEFAULT_CONFIG } = require('../src/index-manager');
const { createSearchIndex, addDocument, writeSearchIndex } = require('../src/tfidf');
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
