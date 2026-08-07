const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  detectWriteBursts,
  detectLowTrustCliques,
  detectReinforcedLowTrust,
  runAudit,
  BURST_THRESHOLDS,
} = require('../src/anomaly');
const { appendAudit, readAudit } = require('../src/audit');
const { writeIndex, readIndex } = require('../src/index-manager');

let tmpDir;
let brainDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-anomaly-'));
  brainDir = path.join(tmpDir, '.brain');
  fs.mkdirSync(brainDir, { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** N memorize audit events for one origin, minutes apart. */
function writeEvents(origin, n, startIso = '2026-08-01T00:00:00Z') {
  const start = Date.parse(startIso);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = `mem_${origin}_${i}`;
    ids.push(id);
    appendAudit(brainDir, {
      ts: new Date(start + i * 60_000).toISOString(),
      event: 'memorize', id, origin,
    });
  }
  return ids;
}

describe('anomaly: write bursts', () => {
  it('flags an external burst over threshold and reports the ids', () => {
    const ids = writeEvents('external', BURST_THRESHOLDS.external + 1);
    const findings = detectWriteBursts(readAudit(brainDir), { windowHours: 24 });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].kind, 'write_burst');
    assert.equal(findings[0].origin, 'external');
    assert.equal(findings[0].count, ids.length);
    assert.deepEqual(findings[0].ids, ids);
  });

  it('stays quiet at or under threshold', () => {
    writeEvents('external', BURST_THRESHOLDS.external);
    assert.deepEqual(detectWriteBursts(readAudit(brainDir)), []);
  });

  it('never flags user writes as a burst', () => {
    writeEvents('user', 100);
    assert.deepEqual(detectWriteBursts(readAudit(brainDir)), []);
  });

  it('respects the sliding window — spread-out writes are not a burst', () => {
    const start = Date.parse('2026-08-01T00:00:00Z');
    for (let i = 0; i < BURST_THRESHOLDS.external + 3; i++) {
      appendAudit(brainDir, {
        ts: new Date(start + i * 25 * 3600 * 1000).toISOString(), // >24h apart
        event: 'memorize', id: `mem_${i}`, origin: 'external',
      });
    }
    assert.deepEqual(detectWriteBursts(readAudit(brainDir), { windowHours: 24 }), []);
  });
});

describe('anomaly: low-trust cliques', () => {
  const lowTrustIndex = () => ({
    memories: {
      a: { origin: 'external', tags: ['t1', 't2'] },
      b: { origin: 'external', tags: ['t1', 't2'] },
      c: { origin: 'tool-output', tags: ['t1', 't2'] },
      trusted: { origin: 'user', tags: ['t1', 't2'] },
    },
  });
  const edges = (pairs) => {
    const out = {};
    for (const [s, d, origin] of pairs) {
      out[s] = out[s] || {};
      out[s][d] = { weight: 0.2, co_retrievals: 0, origin };
    }
    return { edges: out };
  };

  it('finds a connected component of low-trust tag_overlap nodes', () => {
    const assoc = edges([
      ['a', 'b', 'tag_overlap'],
      ['b', 'c', 'tag_overlap'],
      ['a', 'trusted', 'tag_overlap'], // trusted endpoint excluded
    ]);
    const findings = detectLowTrustCliques(lowTrustIndex(), assoc, { minSize: 3 });
    assert.equal(findings.length, 1);
    assert.deepEqual(findings[0].ids, ['a', 'b', 'c']);
    assert.ok(findings[0].shared_tags.includes('t1'));
  });

  it('ignores components below minSize and non-tag_overlap edges', () => {
    const assoc = edges([
      ['a', 'b', 'tag_overlap'],
      ['b', 'c', 'co_retrieval'], // breaks the chain
    ]);
    assert.deepEqual(detectLowTrustCliques(lowTrustIndex(), assoc, { minSize: 3 }), []);
  });

  it('skips vetted members', () => {
    const index = lowTrustIndex();
    index.memories.c.vetted = true;
    const assoc = edges([
      ['a', 'b', 'tag_overlap'],
      ['b', 'c', 'tag_overlap'],
    ]);
    assert.deepEqual(detectLowTrustCliques(index, assoc, { minSize: 3 }), []);
  });
});

describe('anomaly: reinforced low trust', () => {
  it('flags unvetted, unpinned low-trust memories with high access counts', () => {
    const index = {
      memories: {
        hot: { origin: 'external', access_count: 8 },
        vetted: { origin: 'external', access_count: 9, vetted: true },
        pinned: { origin: 'tool-output', access_count: 9, pinned: true },
        cold: { origin: 'external', access_count: 2 },
        user: { origin: 'user', access_count: 50 },
      },
    };
    const findings = detectReinforcedLowTrust(index, { minAccess: 5 });
    assert.deepEqual(findings.map((f) => f.id), ['hot']);
  });
});

describe('anomaly: runAudit', () => {
  function seedBrain() {
    const memories = {};
    const start = Date.parse('2026-08-01T00:00:00Z');
    for (let i = 0; i < BURST_THRESHOLDS.external + 2; i++) {
      const id = `mem_${i}`;
      memories[id] = {
        title: `Planted ${i}`, path: `p/${i}.md`, type: 'observation',
        origin: 'external', tags: ['x', 'y'], access_count: 0,
      };
      fs.mkdirSync(path.join(brainDir, 'p'), { recursive: true });
      fs.writeFileSync(path.join(brainDir, `p/${i}.md`), `---\nid: ${id}\norigin: "external"\n---\nbody\n`);
      appendAudit(brainDir, {
        ts: new Date(start + i * 60_000).toISOString(),
        event: 'memorize', id, origin: 'external',
      });
    }
    writeIndex({ version: '2.0', memory_count: Object.keys(memories).length, memories }, tmpDir);
    return readIndex(tmpDir);
  }

  const deps = (index) => ({
    index,
    associations: { version: 1, edges: {} },
    appendAudit,
    writeIndex: (idx) => writeIndex(idx, tmpDir),
  });

  it('proposes without applying by default', () => {
    const index = seedBrain();
    const result = runAudit(brainDir, deps(index), { now: '2026-08-01T12:00:00Z' });
    assert.ok(result.findings.some((f) => f.kind === 'write_burst'));
    assert.ok(result.proposed_quarantine.length > 0);
    assert.equal(result.applied, undefined);
    // nothing was flagged on disk
    const reread = readIndex(tmpDir);
    assert.ok(Object.values(reread.memories).every((e) => !e.quarantined));
  });

  it('--apply flags proposed ids, audits each, and respects maxApply', () => {
    const index = seedBrain();
    const result = runAudit(brainDir, deps(index), {
      now: '2026-08-01T12:00:00Z', apply: true, maxApply: 3,
    });
    assert.equal(result.applied.length, 3);
    assert.equal(result.truncated, true);
    assert.equal(result.pending_verification, 3);

    const reread = readIndex(tmpDir);
    for (const id of result.applied) {
      assert.equal(reread.memories[id].quarantined, true);
      assert.ok(reread.memories[id].quarantine_reasons.some((r) => r.startsWith('anomaly:')));
    }
    assert.equal(readAudit(brainDir, { events: ['audit_quarantine'] }).length, 3);
  });

  it('skips vetted, pinned, user-origin, and already-quarantined entries', () => {
    const index = seedBrain();
    const ids = Object.keys(index.memories);
    index.memories[ids[0]].vetted = true;
    index.memories[ids[1]].pinned = true;
    index.memories[ids[2]].origin = 'user';
    index.memories[ids[3]].quarantined = true;
    const result = runAudit(brainDir, deps(index), { now: '2026-08-01T12:00:00Z' });
    for (const skipped of ids.slice(0, 4)) {
      assert.ok(!result.proposed_quarantine.includes(skipped));
    }
  });
});
