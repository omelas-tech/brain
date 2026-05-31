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

// ===========================================================================
// estimateTokens (previously untested)
// ===========================================================================
const { estimateTokens, setFrontmatterFields } = require('../src/pinning');

describe('estimateTokens', () => {
  it('returns an explicit numeric token_estimate verbatim, including 0', () => {
    assert.equal(estimateTokens({ token_estimate: 42 }), 42);
    assert.equal(estimateTokens({ token_estimate: 0 }), 0);
  });
  it('falls back to a chars/4 estimate of the title when token_estimate is absent or non-numeric', () => {
    assert.equal(estimateTokens({ title: '' }), 2);                  // ceil(8/4)
    assert.equal(estimateTokens({ title: 'abcd' }), 3);             // ceil(12/4)
    assert.equal(estimateTokens({ token_estimate: 'oops', title: 'abcd' }), 3);
  });
  it('handles null/undefined/empty entries without throwing', () => {
    assert.equal(estimateTokens(null), 2);
    assert.equal(estimateTokens(undefined), 2);
    assert.equal(estimateTokens({}), 2);
  });
});

// ===========================================================================
// setFrontmatterFields (previously untested)
// ===========================================================================
describe('setFrontmatterFields', () => {
  beforeEach(setup);
  afterEach(teardown);

  function writeMd(rel, fmLines, body) {
    const full = path.join(getBrainDir(tmpDir), rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `---\n${fmLines.join('\n')}\n---\n${body}\n`);
    return full;
  }

  it('updates an existing field in place and preserves the body', () => {
    const full = writeMd('a.md', ['id: m1', 'strength: 0.5'], 'BODY-TEXT');
    setFrontmatterFields(getBrainDir(tmpDir), 'a.md', { strength: 0.9 });
    const out = fs.readFileSync(full, 'utf-8');
    assert.ok(out.includes('strength: 0.9'));
    assert.ok(!out.includes('strength: 0.5'));
    assert.ok(out.includes('BODY-TEXT'));
  });

  it('inserts a missing field rather than dropping it', () => {
    const full = writeMd('b.md', ['id: m2'], 'B');
    setFrontmatterFields(getBrainDir(tmpDir), 'b.md', { pinned: true });
    assert.ok(fs.readFileSync(full, 'utf-8').includes('pinned: true'));
  });

  it('quotes string values but writes numbers/booleans bare', () => {
    const full = writeMd('c.md', ['id: m3'], 'B');
    setFrontmatterFields(getBrainDir(tmpDir), 'c.md', { pin_scope: 'project:app', pin_priority: 3, pinned: true });
    const out = fs.readFileSync(full, 'utf-8');
    assert.ok(out.includes('pin_scope: "project:app"'));
    assert.ok(out.includes('pin_priority: 3'));
    assert.ok(out.includes('pinned: true'));
  });

  it('is a silent no-op on a missing file', () => {
    assert.doesNotThrow(() => setFrontmatterFields(getBrainDir(tmpDir), 'nope.md', { x: 1 }));
  });

  it('is a silent no-op when the file has no frontmatter block', () => {
    const full = path.join(getBrainDir(tmpDir), 'plain.md');
    fs.writeFileSync(full, 'just a body, no frontmatter\n');
    setFrontmatterFields(getBrainDir(tmpDir), 'plain.md', { pinned: true });
    assert.equal(fs.readFileSync(full, 'utf-8'), 'just a body, no frontmatter\n');
  });
});

// ===========================================================================
// pin/unpin opts validation & manifest semantics
// ===========================================================================
describe('pinMemory / unpinMemory edge cases', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('coerces a non-finite priority to 0 but keeps a valid negative/decimal one', () => {
    seedMemory('mem_a');
    assert.equal(pinMemory(tmpDir, 'mem_a', { priority: Infinity }).priority, 0);
    assert.equal(pinMemory(tmpDir, 'mem_a', { priority: NaN }).priority, 0);
    assert.equal(pinMemory(tmpDir, 'mem_a', { priority: 'high' }).priority, 0);
    assert.equal(pinMemory(tmpDir, 'mem_a', { priority: -2 }).priority, -2);
  });

  it('pinning the same memory twice keeps exactly one manifest entry (idempotent)', () => {
    seedMemory('mem_b');
    pinMemory(tmpDir, 'mem_b', { scope: 'project:app', priority: 1 });
    pinMemory(tmpDir, 'mem_b', { scope: 'global', priority: 5 });
    const pins = readPinned(tmpDir).pins.filter((p) => p.id === 'mem_b');
    assert.equal(pins.length, 1);
    assert.equal(pins[0].scope, 'global');
    assert.equal(pins[0].priority, 5);
  });

  it('unpin reports was_pinned and removed accurately', () => {
    seedMemory('mem_c');
    // Never pinned → was_pinned false, removed false.
    const u1 = unpinMemory(tmpDir, 'mem_c');
    assert.equal(u1.was_pinned, false);
    assert.equal(u1.removed, false);
    // Pin then unpin → was_pinned true, removed true.
    pinMemory(tmpDir, 'mem_c');
    const u2 = unpinMemory(tmpDir, 'mem_c');
    assert.equal(u2.was_pinned, true);
    assert.equal(u2.removed, true);
    // Second unpin is idempotent.
    assert.equal(unpinMemory(tmpDir, 'mem_c').removed, false);
  });

  it('errors clearly when the memory id does not exist', () => {
    assert.ok(pinMemory(tmpDir, 'ghost').error);
    assert.ok(unpinMemory(tmpDir, 'ghost').error);
  });
});
