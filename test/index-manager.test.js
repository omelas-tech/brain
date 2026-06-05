const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getBrainDir,
  readIndex,
  writeIndex,
  addMemory,
  removeMemory,
  updateMemory,
  generateId,
  readMeta,
  writeMeta,
  groupByCategory,
  readAssociations,
  writeAssociations,
  reinforceEdge,
  getNeighbors,
  decayAssociations,
  readContexts,
  writeContexts,
  readReviewQueue,
  writeReviewQueue,
  readArchiveIndex,
  writeArchiveIndex,
  atomicWriteSync,
  validateBrainPath,
} = require('../src/index-manager');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-test-'));
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

// ===========================================================================
// getBrainDir
// ===========================================================================
describe('getBrainDir', () => {
  let savedEnv;
  beforeEach(() => {
    savedEnv = process.env.BRAIN_DIR;
    delete process.env.BRAIN_DIR;
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.BRAIN_DIR;
    else process.env.BRAIN_DIR = savedEnv;
  });

  it('returns <projectRoot>/.brain', () => {
    const input = path.join(path.sep, 'some', 'project');
    assert.equal(getBrainDir(input), path.join(input, '.brain'));
  });

  it('defaults to ~/.brain when no arg and no BRAIN_DIR', () => {
    const result = getBrainDir();
    assert.equal(result, path.join(os.homedir(), '.brain'));
  });

  it('honors the BRAIN_DIR env var (absolute path used as-is)', () => {
    const dir = path.join(path.sep, 'mnt', 'drive', 'brain');
    process.env.BRAIN_DIR = dir;
    assert.equal(getBrainDir(), dir);
  });

  it('expands a leading ~/ in BRAIN_DIR (env vars are not shell-expanded)', () => {
    process.env.BRAIN_DIR = '~/Google Drive/brain';
    assert.equal(getBrainDir(), path.join(os.homedir(), 'Google Drive', 'brain'));
  });

  it('an explicit overrideBase arg beats BRAIN_DIR', () => {
    process.env.BRAIN_DIR = path.join(path.sep, 'mnt', 'drive', 'brain');
    const input = path.join(path.sep, 'some', 'project');
    assert.equal(getBrainDir(input), path.join(input, '.brain'));
  });
});

// ===========================================================================
// readIndex / writeIndex
// ===========================================================================
describe('readIndex / writeIndex', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('returns null for missing file', () => {
    assert.equal(readIndex(tmpDir), null);
  });

  it('round-trips correctly (write then read)', () => {
    const index = makeIndex({ m1: { path: 'core/test.md', strength: 0.8 } });
    writeIndex(index, tmpDir);
    const result = readIndex(tmpDir);
    assert.equal(result.memories.m1.strength, 0.8);
    assert.equal(result.memory_count, 1);
  });

  it('writeIndex sets last_updated timestamp', () => {
    const index = makeIndex();
    const before = new Date().toISOString();
    writeIndex(index, tmpDir);
    const result = readIndex(tmpDir);
    assert.ok(result.last_updated >= before);
  });
});

// ===========================================================================
// addMemory / removeMemory / updateMemory
// ===========================================================================
describe('addMemory / removeMemory / updateMemory', () => {
  it('addMemory adds entry and increments count', () => {
    const index = makeIndex();
    addMemory(index, 'm1', { path: 'core/test.md', strength: 0.8 });
    assert.ok(index.memories.m1);
    assert.equal(index.memory_count, 1);
  });

  it('addMemory multiple adds count correctly', () => {
    const index = makeIndex();
    addMemory(index, 'm1', { path: 'a.md' });
    addMemory(index, 'm2', { path: 'b.md' });
    addMemory(index, 'm3', { path: 'c.md' });
    assert.equal(index.memory_count, 3);
  });

  it('removeMemory removes and decrements count', () => {
    const index = makeIndex();
    addMemory(index, 'm1', { path: 'a.md' });
    addMemory(index, 'm2', { path: 'b.md' });
    removeMemory(index, 'm1');
    assert.equal(index.memory_count, 1);
    assert.equal(index.memories.m1, undefined);
  });

  it('removeMemory on non-existent ID is a no-op', () => {
    const index = makeIndex({ m1: { path: 'a.md' } });
    removeMemory(index, 'nonexistent');
    assert.equal(index.memory_count, 1);
  });

  it('updateMemory partial update merges fields', () => {
    const index = makeIndex();
    addMemory(index, 'm1', { path: 'a.md', strength: 0.5, tags: ['old'] });
    updateMemory(index, 'm1', { strength: 0.8 });
    assert.equal(index.memories.m1.strength, 0.8);
    assert.deepEqual(index.memories.m1.tags, ['old']); // preserved
  });

  it('updateMemory on non-existent ID is a no-op', () => {
    const index = makeIndex();
    updateMemory(index, 'nonexistent', { strength: 0.9 });
    assert.equal(Object.keys(index.memories).length, 0);
  });
});

// ===========================================================================
// generateId
// ===========================================================================
describe('generateId', () => {
  it('matches pattern mem_YYYYMMDD_<6-hex>', () => {
    const id = generateId();
    assert.match(id, /^mem_\d{8}_[0-9a-f]{1,6}$/);
  });

  it('two calls produce different IDs', () => {
    const a = generateId();
    const b = generateId();
    assert.notEqual(a, b);
  });
});

// ===========================================================================
// readMeta / writeMeta
// ===========================================================================
describe('readMeta / writeMeta', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('returns null for missing meta', () => {
    assert.equal(readMeta('core', tmpDir), null);
  });

  it('round-trips correctly', () => {
    const meta = { description: 'Core memories', count: 5 };
    writeMeta('core', meta, tmpDir);
    const result = readMeta('core', tmpDir);
    assert.deepEqual(result, meta);
  });

  it('writeMeta creates parent directories recursively', () => {
    const meta = { description: 'Deep nested' };
    writeMeta('deep/nested/path', meta, tmpDir);
    const result = readMeta('deep/nested/path', tmpDir);
    assert.deepEqual(result, meta);
  });
});

// ===========================================================================
// groupByCategory
// ===========================================================================
describe('groupByCategory', () => {
  it('groups by first path segment', () => {
    const index = makeIndex({
      m1: { path: 'core/a.md' },
      m2: { path: 'core/b.md' },
      m3: { path: 'project/c.md' },
    });
    const groups = groupByCategory(index);
    assert.equal(groups.core.length, 2);
    assert.equal(groups.project.length, 1);
  });

  it('includes id field in each entry', () => {
    const index = makeIndex({ m1: { path: 'core/a.md' } });
    const groups = groupByCategory(index);
    assert.equal(groups.core[0].id, 'm1');
  });

  it('empty memories returns empty groups', () => {
    const index = makeIndex();
    const groups = groupByCategory(index);
    assert.deepEqual(groups, {});
  });
});

// ===========================================================================
// reinforceEdge
// ===========================================================================
describe('reinforceEdge', () => {
  it('creates bidirectional edges with initial weight', () => {
    const assoc = { edges: {} };
    reinforceEdge(assoc, 'a', 'b', 'tag_overlap', 0.20);
    assert.ok(assoc.edges.a.b);
    assert.ok(assoc.edges.b.a);
    assert.equal(assoc.edges.a.b.weight, 0.20);
    assert.equal(assoc.edges.b.a.weight, 0.20);
    assert.equal(assoc.edges.a.b.origin, 'tag_overlap');
  });

  it('self-links are rejected', () => {
    const assoc = { edges: {} };
    reinforceEdge(assoc, 'a', 'a', 'manual');
    assert.equal(Object.keys(assoc.edges).length, 0);
  });

  it('repeated reinforcement applies Hebbian formula', () => {
    const assoc = { edges: {} };
    reinforceEdge(assoc, 'a', 'b', 'co_retrieval', 0.20);
    const w0 = assoc.edges.a.b.weight;
    reinforceEdge(assoc, 'a', 'b', 'co_retrieval');
    const w1 = assoc.edges.a.b.weight;
    // Hebbian: w1 = min(1, 0.20 + 0.10*(1-0.20)) = min(1, 0.28)
    const expected = Math.min(1.0, w0 + 0.10 * (1.0 - w0));
    assert.ok(Math.abs(w1 - expected) < 0.001);
  });

  it('co_retrievals increments on reinforcement', () => {
    const assoc = { edges: {} };
    reinforceEdge(assoc, 'a', 'b', 'tag_overlap');
    assert.equal(assoc.edges.a.b.co_retrievals, 0);
    reinforceEdge(assoc, 'a', 'b', 'co_retrieval');
    assert.equal(assoc.edges.a.b.co_retrievals, 1);
  });

  it('respects custom initialWeight', () => {
    const assoc = { edges: {} };
    reinforceEdge(assoc, 'a', 'b', 'manual', 0.50);
    assert.equal(assoc.edges.a.b.weight, 0.50);
  });
});

// ===========================================================================
// getNeighbors
// ===========================================================================
describe('getNeighbors', () => {
  it('returns [] for null associations', () => {
    assert.deepEqual(getNeighbors(null, 'a'), []);
  });

  it('returns [] for empty associations', () => {
    assert.deepEqual(getNeighbors({ edges: {} }, 'a'), []);
  });

  it('returns [] for unknown ID', () => {
    const assoc = { edges: { x: { y: { weight: 0.5 } } } };
    assert.deepEqual(getNeighbors(assoc, 'unknown'), []);
  });

  it('returns array with edge fields spread', () => {
    const assoc = { edges: {} };
    reinforceEdge(assoc, 'a', 'b', 'tag_overlap', 0.30);
    const neighbors = getNeighbors(assoc, 'a');
    assert.equal(neighbors.length, 1);
    assert.equal(neighbors[0].id, 'b');
    assert.equal(neighbors[0].weight, 0.30);
    assert.equal(neighbors[0].origin, 'tag_overlap');
  });
});

// ===========================================================================
// decayAssociations
// ===========================================================================
describe('decayAssociations', () => {
  it('decays weights based on elapsed time', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    const assoc = {
      edges: {
        a: { b: { weight: 0.5, last_activated: oldDate.toISOString() } },
        b: { a: { weight: 0.5, last_activated: oldDate.toISOString() } },
      },
    };
    decayAssociations(assoc, 0.998, 0.01);
    const expected = 0.5 * Math.pow(0.998, 10);
    assert.ok(Math.abs(assoc.edges.a.b.weight - expected) < 0.01);
  });

  it('prunes edges below threshold', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 500);
    const assoc = {
      edges: {
        a: { b: { weight: 0.1, last_activated: oldDate.toISOString() } },
        b: { a: { weight: 0.1, last_activated: oldDate.toISOString() } },
      },
    };
    decayAssociations(assoc, 0.998, 0.05);
    // After 500 days at 0.998: 0.1 * 0.998^500 ≈ 0.037 < 0.05
    assert.equal(assoc.edges.a, undefined);
  });

  it('cleans up empty neighbor maps', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 1000);
    const assoc = {
      edges: {
        a: { b: { weight: 0.05, last_activated: oldDate.toISOString() } },
      },
    };
    decayAssociations(assoc, 0.998, 0.05);
    assert.equal(assoc.edges.a, undefined);
  });

  it('returns unchanged for null input', () => {
    assert.equal(decayAssociations(null), null);
  });
});

// ===========================================================================
// File I/O round-trip tests
// ===========================================================================
describe('readAssociations / writeAssociations round-trip', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('round-trips correctly', () => {
    const assoc = { edges: { a: { b: { weight: 0.5 } } } };
    writeAssociations(assoc, tmpDir);
    const result = readAssociations(tmpDir);
    assert.deepEqual(result, assoc);
  });

  it('returns null when file does not exist', () => {
    assert.equal(readAssociations(tmpDir), null);
  });
});

describe('readContexts / writeContexts round-trip', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('round-trips correctly', () => {
    const ctx = { sessions: [{ project: 'brain', topics: ['memory'] }] };
    writeContexts(ctx, tmpDir);
    const result = readContexts(tmpDir);
    assert.deepEqual(result, ctx);
  });

  it('returns null when file does not exist', () => {
    assert.equal(readContexts(tmpDir), null);
  });
});

describe('readReviewQueue / writeReviewQueue round-trip', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('round-trips correctly', () => {
    const queue = { items: [{ id: 'm1', next_review: '2026-02-15' }] };
    writeReviewQueue(queue, tmpDir);
    const result = readReviewQueue(tmpDir);
    assert.deepEqual(result, queue);
  });

  it('returns null when file does not exist', () => {
    assert.equal(readReviewQueue(tmpDir), null);
  });
});

describe('readArchiveIndex / writeArchiveIndex round-trip', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('round-trips correctly', () => {
    const archive = { archived: [{ id: 'm1', reason: 'low strength' }] };
    writeArchiveIndex(archive, tmpDir);
    const result = readArchiveIndex(tmpDir);
    assert.deepEqual(result, archive);
  });

  it('creates _archived/ directory automatically', () => {
    writeArchiveIndex({ archived: [] }, tmpDir);
    const dirExists = fs.existsSync(path.join(tmpDir, '.brain', '_archived'));
    assert.ok(dirExists);
  });

  it('returns null when file does not exist', () => {
    assert.equal(readArchiveIndex(tmpDir), null);
  });
});

// ===========================================================================
// atomicWriteSync
// ===========================================================================
describe('atomicWriteSync', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('writes data that can be read back', () => {
    const filePath = path.join(tmpDir, 'test-atomic.json');
    atomicWriteSync(filePath, '{"hello":"world"}\n');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.equal(content, '{"hello":"world"}\n');
  });

  it('overwrites existing file atomically', () => {
    const filePath = path.join(tmpDir, 'test-atomic.json');
    fs.writeFileSync(filePath, 'old content');
    atomicWriteSync(filePath, 'new content');
    assert.equal(fs.readFileSync(filePath, 'utf-8'), 'new content');
  });

  it('does not leave .tmp files on success', () => {
    const filePath = path.join(tmpDir, 'test-atomic.json');
    atomicWriteSync(filePath, 'data');
    const files = fs.readdirSync(tmpDir);
    const tmpFiles = files.filter((f) => f.includes('.tmp.'));
    assert.equal(tmpFiles.length, 0);
  });
});

// ===========================================================================
// validateBrainPath
// ===========================================================================
describe('validateBrainPath', () => {
  it('accepts paths within brain directory', () => {
    const brainDir = '/home/user/.brain';
    assert.doesNotThrow(() => {
      validateBrainPath('/home/user/.brain/professional/_meta.json', brainDir);
    });
  });

  it('rejects paths outside brain directory', () => {
    const brainDir = '/home/user/.brain';
    assert.throws(
      () => validateBrainPath('/home/user/.brain/../.ssh/id_rsa', brainDir),
      /Path traversal detected/
    );
  });

  it('rejects traversal via relative segments', () => {
    const brainDir = '/home/user/.brain';
    assert.throws(
      () => validateBrainPath('/home/user/.brain/../../etc/passwd', brainDir),
      /Path traversal detected/
    );
  });

  it('accepts the brain directory itself', () => {
    const brainDir = '/home/user/.brain';
    assert.doesNotThrow(() => {
      validateBrainPath('/home/user/.brain', brainDir);
    });
  });
});

// ===========================================================================
// readMeta / writeMeta — path validation
// ===========================================================================
describe('readMeta / writeMeta — path validation', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('readMeta rejects path traversal', () => {
    assert.throws(
      () => readMeta('../../etc', tmpDir),
      /Path traversal detected/
    );
  });

  it('writeMeta rejects path traversal', () => {
    assert.throws(
      () => writeMeta('../../etc', { malicious: true }, tmpDir),
      /Path traversal detected/
    );
  });
});

// ===========================================================================
// Deep-erasure utilities (previously untested)
// ===========================================================================
const {
  removeEdgesForMemory,
  removeFromReviewQueue,
  readConfig,
  writeConfig,
  DEFAULT_CONFIG,
  readPinned,
  readSkillsIndex,
  readSearchIndex,
  writeSearchIndex,
} = require('../src/index-manager');

describe('removeEdgesForMemory', () => {
  it('removes both outgoing and incoming edges and cleans up empty maps', () => {
    let assoc = { edges: {} };
    reinforceEdge(assoc, 'a', 'b', 'manual');
    reinforceEdge(assoc, 'c', 'b', 'manual'); // c→b and b→c
    reinforceEdge(assoc, 'a', 'c', 'manual');
    removeEdgesForMemory(assoc, 'b');
    // No edge anywhere should reference b.
    assert.equal(assoc.edges['b'], undefined, 'outgoing map for b deleted');
    for (const src of Object.keys(assoc.edges)) {
      assert.equal(assoc.edges[src]['b'], undefined, `${src} no longer links to b`);
    }
    // a↔c survives.
    assert.ok(assoc.edges['a'] && assoc.edges['a']['c']);
  });

  it('deletes a source map that becomes empty after removal', () => {
    let assoc = { edges: {} };
    reinforceEdge(assoc, 'x', 'y', 'manual'); // only x↔y
    removeEdgesForMemory(assoc, 'y');
    assert.deepEqual(assoc.edges, {}, 'x map emptied and pruned');
  });

  it('returns associations unchanged when there are no edges', () => {
    assert.deepEqual(removeEdgesForMemory(null, 'a'), null);
    assert.deepEqual(removeEdgesForMemory({}, 'a'), {});
  });
});

describe('removeFromReviewQueue', () => {
  it('filters out every item matching the memory id, preserving the rest', () => {
    const queue = { items: [
      { memory_id: 'm1', due: 1 },
      { memory_id: 'm2', due: 2 },
      { memory_id: 'm1', due: 3 },
    ] };
    removeFromReviewQueue(queue, 'm1');
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].memory_id, 'm2');
  });

  it('is a no-op when nothing matches', () => {
    const queue = { items: [{ memory_id: 'a' }] };
    removeFromReviewQueue(queue, 'zzz');
    assert.equal(queue.items.length, 1);
  });

  it('tolerates null queue or a missing/invalid items array', () => {
    assert.equal(removeFromReviewQueue(null, 'm'), null);
    const bad = { items: 'not-an-array' };
    assert.equal(removeFromReviewQueue(bad, 'm'), bad);
  });
});

describe('reinforceEdge weight dynamics', () => {
  it('Hebbian reinforcement converges toward but never exceeds 1.0', () => {
    let assoc = { edges: {} };
    for (let i = 0; i < 200; i++) reinforceEdge(assoc, 'a', 'b', 'co_retrieval');
    const w = assoc.edges['a']['b'].weight;
    assert.ok(w <= 1.0 && w > 0.99, `converged near 1.0, got ${w}`);
    assert.equal(assoc.edges['a']['b'].co_retrievals, 199); // first create is co_retrievals 0
  });

  it('honors a custom initial weight on first creation', () => {
    let assoc = { edges: {} };
    reinforceEdge(assoc, 'a', 'b', 'manual', 0.5);
    assert.equal(assoc.edges['a']['b'].weight, 0.5);
    assert.equal(assoc.edges['b']['a'].weight, 0.5);
  });

  it('refuses to self-link', () => {
    let assoc = { edges: {} };
    reinforceEdge(assoc, 'a', 'a', 'manual');
    assert.equal(assoc.edges['a'], undefined);
  });
});

describe('config / pinned / skills / search-index readers are corruption-tolerant', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('readConfig merges over defaults and falls back when the file is corrupt', () => {
    // Missing file → pure defaults.
    assert.deepEqual(readConfig(tmpDir), { ...DEFAULT_CONFIG });
    // Partial override merges on top of defaults.
    writeConfig({ working_memory_budget_tokens: 99 }, tmpDir);
    const merged = readConfig(tmpDir);
    assert.equal(merged.working_memory_budget_tokens, 99);
    assert.equal(merged.recall_budget_tokens, DEFAULT_CONFIG.recall_budget_tokens);
    // Corrupt JSON → defaults, never throws.
    fs.writeFileSync(path.join(getBrainDir(tmpDir), 'config.json'), '{not json');
    assert.deepEqual(readConfig(tmpDir), { ...DEFAULT_CONFIG });
  });

  it('readPinned/readSkillsIndex return an empty manifest on missing, corrupt, or wrong-shape data', () => {
    assert.deepEqual(readPinned(tmpDir), { version: 1, pins: [] });
    assert.deepEqual(readSkillsIndex(tmpDir), { version: 1, skills: [] });

    fs.writeFileSync(path.join(getBrainDir(tmpDir), 'pinned.json'), '{bad');
    assert.deepEqual(readPinned(tmpDir), { version: 1, pins: [] });

    // Right JSON, wrong shape (pins not an array) → still the safe empty form.
    fs.writeFileSync(path.join(getBrainDir(tmpDir), 'pinned.json'), JSON.stringify({ version: 1, pins: { a: 1 } }));
    assert.deepEqual(readPinned(tmpDir), { version: 1, pins: [] });

    fs.writeFileSync(path.join(getBrainDir(tmpDir), 'skills-index.json'), JSON.stringify({ skills: 'nope' }));
    assert.deepEqual(readSkillsIndex(tmpDir), { version: 1, skills: [] });
  });

  it('readSearchIndex returns null when absent but rethrows on corrupt JSON', () => {
    assert.equal(readSearchIndex(tmpDir), null);
    writeSearchIndex({ documents: {}, df: {}, doc_count: 0 }, tmpDir);
    assert.equal(readSearchIndex(tmpDir).doc_count, 0);
    fs.writeFileSync(path.join(getBrainDir(tmpDir), 'search-index.json'), '{corrupt');
    assert.throws(() => readSearchIndex(tmpDir));
  });
});
