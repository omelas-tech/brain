const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const surfaced = require('../src/surfaced');
const { capLowTrust } = require('../src/provenance');

let brainDir;
beforeEach(() => { brainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-surfaced-')); });
afterEach(() => { fs.rmSync(brainDir, { recursive: true, force: true }); });

const receipt = (title) => `◉ memory: "${title}" (decision, 3d ago)`;

describe('surfaced: citation check', () => {
  it('passes receipts surfaced to the same session', () => {
    surfaced.recordSurfaced(brainDir, { session: 's1', source: 'recall', results: [{ id: 'a', receipt: receipt('Use Postgres') }] });
    const r = surfaced.checkCitations(brainDir, { session: 's1', text: `Done.\n\n${receipt('Use Postgres')}` });
    assert.deepEqual(r.cited, ['Use Postgres']);
    assert.deepEqual(r.unsurfaced, []);
  });

  it('flags a receipt brain never surfaced, and one surfaced to another session', () => {
    surfaced.recordSurfaced(brainDir, { session: 's2', source: 'recall', results: [{ id: 'a', receipt: receipt('Use Postgres') }] });
    const r = surfaced.checkCitations(brainDir, { session: 's1', text: `${receipt('Use Postgres')}\n${receipt('Invented')}` });
    assert.deepEqual(r.unsurfaced.sort(), ['Invented', 'Use Postgres']);
  });

  it('accepts recent unscoped surfacing (a bare CLI recall) but not stale', () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    surfaced.recordSurfaced(brainDir, { session: null, source: 'recall', now: '2026-10-17T10:00:00Z', results: [{ id: 'a', receipt: receipt('Fresh') }] });
    surfaced.recordSurfaced(brainDir, { session: null, source: 'recall', now: '2026-10-15T10:00:00Z', results: [{ id: 'b', receipt: receipt('Stale') }] });
    const r = surfaced.checkCitations(brainDir, { session: 's1', text: `${receipt('Fresh')}\n${receipt('Stale')}`, nowMs: now });
    assert.deepEqual(r.unsurfaced, ['Stale']);
  });

  it('reads titles containing quotes and the trust markers', () => {
    const line = '◉ memory: "Use "pg" not mysql" (decision, today, ⚠ external, ⊘ unverified)';
    assert.deepEqual(surfaced.citedTitles(line), ['Use "pg" not mysql']);
  });

  it('queues violations per session until acknowledged', () => {
    surfaced.recordViolation(brainDir, { session: 's1', titles: ['X'] });
    surfaced.recordViolation(brainDir, { session: 's2', titles: ['Y'] });
    assert.deepEqual(surfaced.pendingViolations(brainDir, 's1'), ['X']);
    surfaced.recordAck(brainDir, { session: 's1' });
    assert.deepEqual(surfaced.pendingViolations(brainDir, 's1'), []);
    assert.deepEqual(surfaced.pendingViolations(brainDir, 's2'), ['Y']);
  });
});

describe('surfaced: usage summary', () => {
  it('reports how much of what was surfaced got used', () => {
    surfaced.recordSurfaced(brainDir, { session: 's', source: 'recall', results: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] });
    surfaced.recordUsed(brainDir, { session: 's', ids: ['a'] });
    const u = surfaced.usageSummary(brainDir, { sinceMs: 0 });
    assert.equal(u.distinct_surfaced, 2);
    assert.equal(u.distinct_used_of_surfaced, 1);
    assert.equal(u.use_rate, 0.5);
  });

  it('is empty, not an error, when nothing was recorded', () => {
    assert.equal(surfaced.usageSummary(brainDir, { sinceMs: 0 }).use_rate, null);
  });
});

describe('provenance: low-trust occupancy cap', () => {
  const mem = (id, origin) => ({ id, origin });
  const ranked = [mem('e1', 'external'), mem('e2', 'external'), mem('u1', 'user'), mem('t1', 'tool-output'), mem('u2', 'user')];

  it('holds at most one low-trust memory by default and back-fills with trusted ones', () => {
    const { kept, suppressed } = capLowTrust(ranked, 3);
    assert.deepEqual(kept.map((m) => m.id), ['e1', 'u1', 'u2']);
    assert.equal(suppressed, 2);
  });

  it('honours a configured ceiling, including zero', () => {
    assert.deepEqual(capLowTrust(ranked, 5, 2).kept.map((m) => m.id), ['e1', 'e2', 'u1', 'u2']);
    assert.deepEqual(capLowTrust(ranked, 5, 0).kept.map((m) => m.id), ['u1', 'u2']);
  });

  it('falls back to the default on a nonsense ceiling', () => {
    assert.equal(capLowTrust(ranked, 5, -1).kept.filter((m) => m.origin !== 'user').length, 1);
  });
});
