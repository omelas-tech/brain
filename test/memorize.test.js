const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { getBrainDir, writeIndex, readIndex, readPinned } = require('../src/index-manager');

const MEMORIZE = path.join(__dirname, '..', 'bin', 'memorize.js');

let tmpDir;
function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-memorize-'));
  fs.mkdirSync(path.join(tmpDir, '.brain'), { recursive: true });
}
function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

/** Initialize a minimal but valid brain (empty index) unless `memories` given. */
function initBrain(memories = {}) {
  writeIndex({
    version: '2.0',
    memory_count: Object.keys(memories).length,
    memories,
    last_updated: new Date().toISOString(),
  }, tmpDir);
}

/**
 * Drive bin/memorize.js as a subprocess. Returns { status, stdout, stderr, json }.
 * Never throws — a non-zero exit is captured so error cases can be asserted.
 */
function run(payload, { args = [], raw = null } = {}) {
  const input = raw != null ? raw : JSON.stringify(payload);
  try {
    const stdout = execFileSync('node', [MEMORIZE, ...args], {
      input,
      env: { ...process.env, HOME: tmpDir, USERPROFILE: tmpDir },
      encoding: 'utf-8',
    });
    return { status: 0, stdout, stderr: '', json: JSON.parse(stdout) };
  } catch (err) {
    let json = null;
    try { json = JSON.parse((err.stderr || '').trim()); } catch { /* not JSON */ }
    return { status: err.status ?? 1, stdout: err.stdout || '', stderr: err.stderr || '', json };
  }
}

const baseMem = (over = {}) => ({
  title: 'A learning',
  type: 'learning',
  cognitive_type: 'semantic',
  path: 'professional/notes/learn.md',
  content: 'Something worth remembering.',
  ...over,
});

describe('memorize: happy path', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('writes the memory file, index entry, search index and _meta.json', () => {
    initBrain();
    const r = run({ memories: [baseMem({ tags: ['x'] })] });
    assert.equal(r.status, 0);
    assert.equal(r.json.total, 1);
    const stored = r.json.stored[0];
    assert.ok(stored.id.startsWith('mem_'));

    const brainDir = getBrainDir(tmpDir);
    // Memory file written with frontmatter + body.
    const file = path.join(brainDir, 'professional/notes/learn.md');
    const content = fs.readFileSync(file, 'utf-8');
    assert.ok(content.includes(`id: ${stored.id}`));
    assert.ok(content.includes('type: learning'));
    assert.ok(content.endsWith('Something worth remembering.\n'));

    // Index updated.
    const idx = readIndex(tmpDir);
    assert.ok(idx.memories[stored.id]);
    assert.equal(idx.memory_count, 1);

    // Search index + _meta.json side effects.
    assert.ok(fs.existsSync(path.join(brainDir, 'search-index.json')));
    const meta = JSON.parse(fs.readFileSync(path.join(brainDir, 'professional/_meta.json'), 'utf-8'));
    assert.equal(meta.memory_count, 1);
    assert.ok(meta.subcategories.includes('notes'));
  });

  it('computes strength/decay from type + cognitive adjustments', () => {
    initBrain();
    const r = run({ memories: [baseMem({ type: 'decision', cognitive_type: 'episodic' })] });
    const s = r.json.stored[0];
    // decision 0.85 + episodic +0.10 = 0.95; decay 0.995 * 0.995.
    assert.equal(s.strength, 0.95);
    assert.ok(Math.abs(s.decay_rate - 0.995 * 0.995) < 1e-9);
  });

  it('clamps strength at 1.0 for high-strength combinations', () => {
    initBrain();
    // insight 0.90 + episodic +0.10 = 1.00 exactly (not over).
    const r = run({ memories: [baseMem({ type: 'insight', cognitive_type: 'episodic' })] });
    assert.equal(r.json.stored[0].strength, 1.0);
  });

  it('stores multiple memories and links them via shared tags', () => {
    initBrain();
    const r = run({ memories: [
      baseMem({ title: 'M1', path: 'professional/a.md', tags: ['db', 'perf'] }),
      baseMem({ title: 'M2', path: 'professional/b.md', tags: ['db', 'perf'] }),
    ] });
    assert.equal(r.status, 0);
    assert.equal(r.json.total, 2);
    // The second memory sees the first already in the index → a tag-overlap edge.
    assert.ok(r.json.stored[1].edges_created >= 1, 'tag-overlap edge created');
  });

  it('creates an explicit "related" edge to a pre-existing memory', () => {
    initBrain({ mem_old: { title: 'Old', path: 'o.md', type: 'learning', tags: [], related: [] } });
    const r = run({ memories: [baseMem({ related: ['mem_old'] })] });
    assert.equal(r.json.stored[0].edges_created, 1);
  });

  it('registers a born-pinned memory in pinned.json and its frontmatter', () => {
    initBrain();
    // Born-pinning entrenches a memory in every future session, so it is only
    // reachable from an explicit user origin (see the provenance suite below).
    const r = run({ memories: [baseMem({ origin: 'user', pinned: true, pin_scope: 'project:app', pin_priority: 4 })] });
    const id = r.json.stored[0].id;
    const pins = readPinned(tmpDir).pins;
    assert.equal(pins.length, 1);
    assert.equal(pins[0].id, id);
    assert.equal(pins[0].scope, 'project:app');
    const fm = fs.readFileSync(path.join(getBrainDir(tmpDir), 'professional/notes/learn.md'), 'utf-8');
    assert.ok(fm.includes('pinned: true'));
    assert.ok(fm.includes('pin_scope: "project:app"'));
  });
});

describe('memorize: input validation & error exits', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('exits non-zero on invalid JSON', () => {
    initBrain();
    const r = run(null, { raw: '{ not json' });
    assert.equal(r.status, 1);
    assert.match(r.json.error, /Invalid JSON input/);
  });

  it('exits non-zero on a missing/empty memories array', () => {
    initBrain();
    assert.match(run({}).json.error, /non-empty "memories" array/);
    assert.match(run({ memories: [] }).json.error, /non-empty "memories" array/);
    assert.match(run({ memories: 'nope' }).json.error, /non-empty "memories" array/);
  });

  it('exits non-zero when the brain is not initialized', () => {
    // No initBrain() → no index.json.
    const r = run({ memories: [baseMem()] });
    assert.equal(r.status, 1);
    assert.match(r.json.error, /Brain not initialized/);
  });

  it('exits non-zero when a memory is missing a required field', () => {
    initBrain();
    const r = run({ memories: [baseMem({ content: undefined })] });
    assert.equal(r.status, 1);
    assert.match(r.json.error, /missing required fields/);
  });

  it('exits non-zero on an unknown memory type', () => {
    initBrain();
    const r = run({ memories: [baseMem({ type: 'banana' })] });
    assert.equal(r.status, 1);
    assert.match(r.json.error, /Unknown memory type/);
  });

  it('exits non-zero on a corrupt index.json', () => {
    fs.writeFileSync(path.join(tmpDir, '.brain', 'index.json'), '{ corrupt');
    const r = run({ memories: [baseMem()] });
    assert.equal(r.status, 1);
    assert.match(r.json.error, /Corrupt index\.json/);
  });

  it('rejects a path-traversal write target', () => {
    initBrain();
    const r = run({ memories: [baseMem({ path: '../../escape.md' })] });
    assert.equal(r.status, 1);
    assert.match(r.json.error, /Path traversal/);
  });
});

describe('memorize: resilience & sync', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('rebuilds a corrupt search index instead of failing', () => {
    initBrain();
    fs.writeFileSync(path.join(getBrainDir(tmpDir), 'search-index.json'), '{ corrupt');
    const r = run({ memories: [baseMem()] });
    assert.equal(r.status, 0, 'store still succeeds');
    // A fresh, valid search index was written.
    const si = JSON.parse(fs.readFileSync(path.join(getBrainDir(tmpDir), 'search-index.json'), 'utf-8'));
    assert.equal(si.doc_count, 1);
  });

  it('reports "no sync configured" when --sync is passed without any sync config', () => {
    initBrain();
    const r = run({ memories: [baseMem()] }, { args: ['--sync'] });
    assert.equal(r.status, 0);
    assert.equal(r.json.sync.method, 'none');
    assert.equal(r.json.sync.success, false);
  });

  it('honors auto_sync in the payload (same no-config path)', () => {
    initBrain();
    const r = run({ memories: [baseMem()], auto_sync: true });
    assert.equal(r.json.sync.method, 'none');
  });
});

// --- Provenance (OWASP ASI06: memory poisoning) ---
//
// Threat model: content the agent *read* — an email, a web page, a tool result —
// persuades it to write a fact, and that fact then entrenches itself as pinned,
// decay-exempt and prune-exempt. See MemGhost (arXiv:2607.05189).

describe('memorize: provenance policy', () => {
  beforeEach(setup);
  afterEach(teardown);

  const fmOf = (p = 'professional/notes/learn.md') =>
    fs.readFileSync(path.join(getBrainDir(tmpDir), p), 'utf-8');

  it('defaults to the weaker origin when the caller does not assert one', () => {
    initBrain();
    const r = run({ memories: [baseMem()] });
    assert.equal(r.json.stored[0].origin, 'agent-inferred');
    assert.ok(fmOf().includes('origin: "agent-inferred"'));
  });

  it('records the origin on the index entry so recall can weigh it', () => {
    initBrain();
    const r = run({ memories: [baseMem({ origin: 'external' })] });
    const entry = readIndex(tmpDir).memories[r.json.stored[0].id];
    assert.equal(entry.origin, 'external');
  });

  it('rejects an unknown origin instead of silently trusting it', () => {
    initBrain();
    const r = run({ memories: [baseMem({ origin: 'trusted-honest-really' })] });
    assert.equal(r.status, 1);
    assert.match(r.json.error, /Unknown origin/);
  });

  for (const origin of ['agent-inferred', 'tool-output', 'external']) {
    it(`refuses to let origin "${origin}" pin a memory into every session`, () => {
      initBrain();
      const r = run({ memories: [baseMem({ origin, pinned: true })] });
      assert.equal(r.status, 1);
      assert.match(r.json.error, /may not set pinned/);
      assert.equal(readPinned(tmpDir).pins.length, 0);
    });

    it(`refuses to let origin "${origin}" mark a memory decay-exempt`, () => {
      initBrain();
      const r = run({ memories: [baseMem({ origin, stable: true })] });
      assert.equal(r.status, 1);
      assert.match(r.json.error, /may not set stable/);
    });
  }

  it('keeps a non-user memory below the prune-exempt salience threshold', () => {
    initBrain();
    const r = run({ memories: [baseMem({ origin: 'external', salience: 1.0 })] });
    assert.ok(r.json.stored[0].salience < 0.7,
      `salience ${r.json.stored[0].salience} would be exempt from auto-pruning`);
  });

  it('reports an explicit over-ask rather than downgrading it silently', () => {
    initBrain();
    const r = run({ memories: [baseMem({ origin: 'external', salience: 1.0, confidence: 1.0 })] });
    const fields = r.json.provenance_clamps.map((c) => c.field).sort();
    assert.deepEqual(fields, ['confidence', 'salience']);
    assert.equal(r.json.provenance_clamps[0].requested, 1.0);
  });

  it('applies the ceiling to an unstated value without reporting a clamp', () => {
    initBrain();
    // The 0.7 default confidence still exceeds what "external" may claim.
    const r = run({ memories: [baseMem({ origin: 'external' })] });
    assert.ok(r.json.stored[0].confidence <= 0.4);
    assert.equal(r.json.provenance_clamps, undefined);
  });

  it('does not let a non-user origin inflate base strength', () => {
    initBrain();
    const boosted = run({ memories: [baseMem({ origin: 'tool-output', strength_adjustment: 0.5 })] });
    const plain = run({ memories: [baseMem({ origin: 'tool-output', path: 'professional/notes/b.md' })] });
    assert.equal(boosted.json.stored[0].strength, plain.json.stored[0].strength);
  });

  it('still allows a non-user origin to lower its own strength', () => {
    initBrain();
    const lowered = run({ memories: [baseMem({ origin: 'external', strength_adjustment: -0.2 })] });
    const plain = run({ memories: [baseMem({ origin: 'external', path: 'professional/notes/b.md' })] });
    assert.ok(lowered.json.stored[0].strength < plain.json.stored[0].strength);
  });

  it('makes untrusted-origin memory fade faster than user-origin memory', () => {
    initBrain();
    const user = run({ memories: [baseMem({ origin: 'user' })] });
    const ext = run({ memories: [baseMem({ origin: 'external', path: 'professional/notes/b.md' })] });
    assert.ok(ext.json.stored[0].decay_rate < user.json.stored[0].decay_rate,
      'an externally-sourced memory must lose to a genuine one over time');
  });

  it('lets an explicit user origin entrench a memory', () => {
    initBrain();
    const r = run({ memories: [baseMem({ origin: 'user', pinned: true, stable: true, salience: 1.0 })] });
    assert.equal(r.status, 0);
    assert.equal(r.json.stored[0].salience, 1.0);
    assert.equal(readPinned(tmpDir).pins.length, 1);
  });

  it('appends one audit line per stored memory', () => {
    initBrain();
    run({ memories: [baseMem({ origin: 'external' }), baseMem({ path: 'professional/notes/b.md' })] });
    const lines = fs.readFileSync(path.join(getBrainDir(tmpDir), 'audit.log'), 'utf-8')
      .trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].origin, 'external');
    assert.equal(lines[0].event, 'memorize');
    assert.equal(lines[1].origin, 'agent-inferred');
  });

  it('keeps the audit log append-only across separate invocations', () => {
    initBrain();
    run({ memories: [baseMem()] });
    run({ memories: [baseMem({ path: 'professional/notes/b.md' })] });
    const lines = fs.readFileSync(path.join(getBrainDir(tmpDir), 'audit.log'), 'utf-8').trim().split('\n');
    assert.equal(lines.length, 2, 'a later write must not truncate the earlier trail');
  });
});
