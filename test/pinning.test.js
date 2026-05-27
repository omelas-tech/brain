const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getBrainDir, writeIndex, readIndex, readPinned } = require('../src/index-manager');
const { pinMemory, unpinMemory } = require('../src/pinning');
const { computeDecayedStrength, rankMemories } = require('../src/scorer');
const { computeSessionStart } = require('../bin/session-start');
const { createSearchIndex, addDocument, writeSearchIndex } = require('../src/tfidf');

let tmpDir;
function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-pin-'));
  fs.mkdirSync(path.join(tmpDir, '.brain'), { recursive: true });
}
function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function seedMemory(id, opts = {}) {
  const {
    title = 'Use tabs',
    body = 'Always use tabs.',
    relPath = 'professional/conventions/tabs.md',
    extra = {},
  } = opts;
  const brainDir = getBrainDir(tmpDir);
  const full = path.join(brainDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    `---\nid: ${id}\ntype: preference\ncognitive_type: semantic\nstrength: 0.6\ndecay_rate: 0.998\n---\n${body}\n`
  );

  const index = readIndex(tmpDir) || {
    version: '2.0', memory_count: 0, memories: {}, last_updated: new Date().toISOString(),
  };
  index.memories[id] = {
    title, path: relPath, type: 'preference', cognitive_type: 'semantic',
    created: new Date().toISOString(),
    last_accessed: new Date(Date.now() - 365 * 864e5).toISOString(),
    access_count: 0, strength: 0.6, decay_rate: 0.998, salience: 0.5, confidence: 0.9,
    tags: [], related: [], encoding_context: {}, token_estimate: 5, ...extra,
  };
  index.memory_count = Object.keys(index.memories).length;
  writeIndex(index, tmpDir);

  const si = createSearchIndex();
  addDocument(si, id, { title, body, tags: [] });
  writeSearchIndex(brainDir, si);
}

describe('pinMemory / unpinMemory', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('pins: sets index entry, frontmatter, and pinned.json', () => {
    seedMemory('mem_1');
    const r = pinMemory(tmpDir, 'mem_1', { scope: 'global', priority: 2 });
    assert.equal(r.pinned, true);

    const idx = readIndex(tmpDir);
    assert.equal(idx.memories['mem_1'].pinned, true);
    assert.equal(idx.memories['mem_1'].pin_priority, 2);

    const fm = fs.readFileSync(path.join(getBrainDir(tmpDir), 'professional/conventions/tabs.md'), 'utf-8');
    assert.ok(fm.includes('pinned: true'), 'frontmatter records the pin');

    const pinned = readPinned(tmpDir);
    assert.equal(pinned.pins.length, 1);
    assert.equal(pinned.pins[0].id, 'mem_1');
  });

  it('errors on a missing memory', () => {
    assert.ok(pinMemory(tmpDir, 'nope').error);
    assert.ok(unpinMemory(tmpDir, 'nope').error);
  });

  it('unpins: clears the flag and removes it from the manifest', () => {
    seedMemory('mem_1');
    pinMemory(tmpDir, 'mem_1');
    const r = unpinMemory(tmpDir, 'mem_1');
    assert.equal(r.pinned, false);
    assert.equal(readIndex(tmpDir).memories['mem_1'].pinned, false);
    assert.equal(readPinned(tmpDir).pins.length, 0);
  });
});

describe('decay exemption', () => {
  it('exempt strength never fades', () => {
    const old = new Date(Date.now() - 1000 * 864e5).toISOString();
    assert.ok(computeDecayedStrength(0.6, 0.99, old) < 0.6, 'decays normally');
    assert.equal(computeDecayedStrength(0.6, 0.99, old, true), 0.6, 'exempt → unchanged');
  });

  it('rankMemories treats pinned/stable as decay-exempt', () => {
    const old = new Date(Date.now() - 1000 * 864e5).toISOString();
    const ranked = rankMemories(
      [
        { id: 'a', strength: 0.6, decay_rate: 0.99, last_accessed: old, stable: true },
        { id: 'b', strength: 0.6, decay_rate: 0.99, last_accessed: old },
      ],
      () => 0
    );
    assert.equal(ranked.find((m) => m.id === 'a').decayed_strength, 0.6);
    assert.ok(ranked.find((m) => m.id === 'b').decayed_strength < 0.6);
  });
});

describe('session-start pinned tier', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('injects a global pin with content, regardless of recall', () => {
    seedMemory('mem_1', { title: 'Use tabs', body: 'Always use tabs.' });
    pinMemory(tmpDir, 'mem_1', { scope: 'global' });
    const p = computeSessionStart(tmpDir, { project: 'whatever' });
    assert.equal(p.pinned.length, 1);
    assert.equal(p.pinned[0].id, 'mem_1');
    assert.ok(p.pinned[0].content.includes('Always use tabs'));
    assert.ok(p.budget.pinned_tokens > 0);
  });

  it('project-scoped pins do not load outside their project', () => {
    seedMemory('mem_1', { relPath: 'professional/x.md' });
    pinMemory(tmpDir, 'mem_1', { scope: 'project:alpha' });
    assert.equal(computeSessionStart(tmpDir, { project: 'beta' }).pinned.length, 0);
    assert.equal(computeSessionStart(tmpDir, { project: 'alpha' }).pinned.length, 1);
  });

  it('survives simulated long decay with unchanged strength (pinned ⇒ stable)', () => {
    seedMemory('mem_1'); // last_accessed 365d ago
    pinMemory(tmpDir, 'mem_1');
    const ranked = rankMemories(
      Object.entries(readIndex(tmpDir).memories).map(([id, e]) => ({ id, ...e })),
      () => 0
    );
    assert.equal(ranked.find((m) => m.id === 'mem_1').decayed_strength, 0.6);
  });
});
