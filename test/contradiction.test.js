const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { writeIndex } = require('../src/index-manager');

const MEMORIZE = path.join(__dirname, '..', 'bin', 'memorize.js');

let tmpDir;
function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-conflict-'));
  fs.mkdirSync(path.join(tmpDir, '.brain'), { recursive: true });
}
function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function runMemorize(payload) {
  const out = execFileSync('node', [MEMORIZE], {
    input: JSON.stringify(payload),
    // Set both HOME (Linux/macOS) and USERPROFILE (Windows) so os.homedir()
    // resolves to the temp brain dir on every platform.
    env: { ...process.env, HOME: tmpDir, USERPROFILE: tmpDir },
    encoding: 'utf-8',
  });
  return JSON.parse(out);
}

describe('memorize contradiction surfacing (Tier B §10.2)', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('flags potential_conflicts against a pinned memory with overlapping tags', () => {
    writeIndex({
      version: '2.0', memory_count: 1, last_updated: new Date().toISOString(),
      memories: {
        mem_pin: {
          title: 'Use tabs', path: 'p.md', type: 'preference', cognitive_type: 'semantic',
          created: new Date().toISOString(), last_accessed: new Date().toISOString(),
          access_count: 0, strength: 0.6, decay_rate: 0.998, salience: 0.5, confidence: 0.9,
          tags: ['tabs', 'style'], related: [], encoding_context: {}, token_estimate: 5,
          pinned: true, pin_scope: 'global', pin_priority: 0,
        },
      },
    }, tmpDir);

    const result = runMemorize({
      memories: [{
        title: 'Use spaces', type: 'preference', cognitive_type: 'semantic',
        path: 'professional/conventions/spaces.md', tags: ['tabs', 'style'],
        content: 'Always use spaces, never tabs.',
      }],
    });

    assert.equal(result.stored.length, 1);
    assert.ok(result.stored[0].potential_conflicts, 'should flag a conflict');
    assert.equal(result.stored[0].potential_conflicts[0].id, 'mem_pin');
  });

  it('does not flag when the overlapping memory is neither pinned nor stable', () => {
    writeIndex({
      version: '2.0', memory_count: 1, last_updated: new Date().toISOString(),
      memories: {
        mem_plain: {
          title: 'Tabs note', path: 'p.md', type: 'observation', cognitive_type: 'semantic',
          created: new Date().toISOString(), last_accessed: new Date().toISOString(),
          access_count: 0, strength: 0.4, decay_rate: 0.95, salience: 0.3, confidence: 0.7,
          tags: ['tabs', 'style'], related: [], encoding_context: {}, token_estimate: 5,
        },
      },
    }, tmpDir);

    const result = runMemorize({
      memories: [{
        title: 'Use spaces', type: 'preference', cognitive_type: 'semantic',
        path: 'professional/conventions/spaces.md', tags: ['tabs', 'style'],
        content: 'Always use spaces.',
      }],
    });
    assert.equal(result.stored[0].potential_conflicts, undefined);
  });
});

// ─────────────────────────────────────────────────────────
// Unit tests for the proposal heuristic itself (src/contradiction.js).
// The CLI tests above prove the wiring; these pin the filters.
// ─────────────────────────────────────────────────────────

const { proposeSupersessions } = require('../src/contradiction');

const NOW = '2026-08-21T12:00:00.000Z';

function idx(memories) {
  return { version: 1, memories };
}

describe('contradiction: supersession proposals', () => {
  it('proposes a boundary for a same-type memory with shared tags', () => {
    const index = idx({
      mem_old: { title: 'Deploy to Fly.io', type: 'decision', tags: ['deploy', 'infra'] },
    });
    const out = proposeSupersessions(
      index,
      { type: 'decision', tags: ['deploy', 'infra'], created: NOW },
      ['mem_old'],
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'mem_old');
    assert.equal(out[0].authority, 'same-type');
    assert.deepEqual(out[0].shared_tags, ['deploy', 'infra']);
    assert.equal(out[0].proposed_valid_until, NOW);
  });

  it('does not propose across differing types', () => {
    // An observation that shares tags with a decision is context, not a reversal.
    const index = idx({
      mem_old: { title: 'Deploy to Fly.io', type: 'decision', tags: ['deploy', 'infra'] },
    });
    const out = proposeSupersessions(
      index,
      { type: 'observation', tags: ['deploy', 'infra'], created: NOW },
      ['mem_old'],
    );
    assert.deepEqual(out, []);
  });

  it('still proposes across types when the target is pinned', () => {
    // Pinned memories carry the most authority into every session, so a
    // possible conflict is worth surfacing even when the heuristic is unsure.
    const index = idx({
      mem_pin: { title: 'Pinned convention', type: 'decision', tags: ['deploy', 'infra'], pinned: true },
    });
    const out = proposeSupersessions(
      index,
      { type: 'observation', tags: ['deploy', 'infra'], created: NOW },
      ['mem_pin'],
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].authority, 'pinned');
  });

  it('never second-guesses an author-set validity window', () => {
    const index = idx({
      mem_old: {
        title: 'Contract rate', type: 'decision', tags: ['rate', 'contract'],
        valid_until: '2026-12-31T00:00:00.000Z',
      },
    });
    const out = proposeSupersessions(
      index,
      { type: 'decision', tags: ['rate', 'contract'], created: NOW },
      ['mem_old'],
    );
    assert.deepEqual(out, []);
  });

  it('skips memories already superseded', () => {
    const index = idx({
      mem_old: { title: 'Old', type: 'decision', tags: ['a', 'b'], superseded_by: 'mem_mid' },
    });
    const out = proposeSupersessions(
      index,
      { type: 'decision', tags: ['a', 'b'], created: NOW },
      ['mem_old'],
    );
    assert.deepEqual(out, []);
  });

  it('prefers the successor\'s valid_from over its record time as the boundary', () => {
    const index = idx({
      mem_old: { title: 'Old', type: 'decision', tags: ['a', 'b'] },
    });
    const out = proposeSupersessions(
      index,
      { type: 'decision', tags: ['a', 'b'], created: NOW, valid_from: '2026-06-01T00:00:00.000Z' },
      ['mem_old'],
    );
    assert.equal(out[0].proposed_valid_until, '2026-06-01T00:00:00.000Z');
  });

  it('orders proposals pinned > stable > same-type', () => {
    const index = idx({
      mem_same: { title: 'same', type: 'decision', tags: ['a', 'b'] },
      mem_pin: { title: 'pin', type: 'decision', tags: ['a', 'b'], pinned: true },
      mem_stable: { title: 'stable', type: 'decision', tags: ['a', 'b'], stable: true },
    });
    const out = proposeSupersessions(
      index,
      { type: 'decision', tags: ['a', 'b'], created: NOW },
      ['mem_same', 'mem_pin', 'mem_stable'],
    );
    assert.deepEqual(out.map((p) => p.id), ['mem_pin', 'mem_stable', 'mem_same']);
  });

  it('ignores unknown ids', () => {
    const out = proposeSupersessions(idx({}), { type: 'decision', tags: ['a'], created: NOW }, ['nope']);
    assert.deepEqual(out, []);
  });
});
