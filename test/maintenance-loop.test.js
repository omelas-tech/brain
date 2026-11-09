/**
 * The maintenance loop: the pieces that keep a long-lived brain from drifting —
 * flat-edge normalization, after-the-fact supersession, sleep-due and
 * unsaved-notable signals, and text-neighbour contradiction candidates.
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { writeIndex, readIndex, normalizeAssociations, readAssociations, writeContexts } = require('../src/index-manager');

const BIN = path.join(__dirname, '..', 'bin');

let tmpDir;
let brainDir;
let savedBrainDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-maint-'));
  brainDir = path.join(tmpDir, '.brain');
  fs.mkdirSync(brainDir, { recursive: true });
  writeIndex({ version: '2.0', memory_count: 0, memories: {} }, tmpDir);
  savedBrainDir = process.env.BRAIN_DIR;
  process.env.BRAIN_DIR = brainDir;
});
afterEach(() => {
  if (savedBrainDir === undefined) delete process.env.BRAIN_DIR;
  else process.env.BRAIN_DIR = savedBrainDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const env = () => ({ ...process.env, HOME: tmpDir, USERPROFILE: tmpDir, BRAIN_DIR: brainDir });
const run = (script, args, input) => JSON.parse(execFileSync('node', [path.join(BIN, script), ...args], {
  env: env(), encoding: 'utf-8', ...(input ? { input } : {}),
}));
let seq = 0;
const memorize = (mems) => run('memorize.js', [], JSON.stringify({
  memories: mems.map((m) => ({ path: `professional/test/m${seq++}.md`, ...m })),
}));

describe('normalizeAssociations', () => {
  it('folds flat "a::b" edges into the nested map, both directions, keeping the stronger weight', () => {
    const assoc = normalizeAssociations({
      version: 1,
      edges: {
        'm1::m2': { source: 'm1', target: 'm2', weight: 0.4, origin: 'creative', co_activations: 2, insight: 'x', created: '2026-01-01T00:00:00.000Z' },
        m1: { m3: { weight: 0.1, co_retrievals: 0, origin: 'tag_overlap', last_activated: '2026-01-01T00:00:00.000Z' } },
        m2: { m1: { weight: 0.9, co_retrievals: 5, origin: 'co_retrieval', last_activated: '2026-01-01T00:00:00.000Z' } },
      },
    });
    assert.equal(assoc.edges['m1::m2'], undefined);
    assert.equal(assoc.edges.m1.m2.weight, 0.4);
    assert.equal(assoc.edges.m1.m2.co_retrievals, 2);
    assert.equal(assoc.edges.m1.m2.insight, 'x');
    assert.equal(assoc.edges.m2.m1.weight, 0.9, 'existing stronger nested edge kept');
    assert.ok(assoc.edges.m1.m3, 'unrelated nested edge untouched');
  });

  it('readAssociations returns the normalized shape', () => {
    fs.writeFileSync(path.join(brainDir, 'associations.json'), JSON.stringify({
      version: 1, edges: { 'a::b': { source: 'a', target: 'b', weight: 0.3 } },
    }));
    const assoc = readAssociations();
    assert.equal(assoc.edges.a.b.weight, 0.3);
    assert.equal(assoc.edges.b.a.weight, 0.3);
  });
});

describe('brain supersede', () => {
  it('bounds an existing memory by an existing successor', () => {
    const [oldM] = memorize([{ title: 'API at api.example.work', type: 'decision', origin: 'user', content: 'API lives at api.example.work', tags: ['domain'] }]).stored;
    const [newM] = memorize([{ title: 'Domain moved to example.ai', type: 'decision', origin: 'user', content: 'Primary domain is example.ai', tags: ['dns'] }]).stored;

    const dry = run('supersede.js', [oldM.id, '--by', newM.id, '--dry-run']);
    assert.equal(dry.would_supersede[0].id, oldM.id);
    assert.equal(readIndex(tmpDir).memories[oldM.id].superseded_by, undefined, 'dry run writes nothing');

    const out = run('supersede.js', [oldM.id, '--by', newM.id, '--valid-until', '2026-06-04']);
    assert.equal(out.superseded[0].id, oldM.id);
    const idx = readIndex(tmpDir).memories;
    assert.equal(idx[oldM.id].superseded_by, newM.id);
    assert.equal(idx[oldM.id].valid_until, '2026-06-04T00:00:00.000Z');
    assert.deepEqual(idx[newM.id].supersedes, [oldM.id]);
    assert.match(fs.readFileSync(path.join(brainDir, idx[oldM.id].path), 'utf-8'), /superseded_by: "/);
    assert.ok(readAssociations().edges[newM.id][oldM.id]);
  });

  it('refuses self-supersession and unknown ids', () => {
    const [m] = memorize([{ title: 'Only one', type: 'decision', origin: 'user', content: 'x', tags: [] }]).stored;
    const out = run('supersede.js', [m.id, 'mem_nope', '--by', m.id]);
    assert.deepEqual(out.superseded, []);
    assert.equal(out.skipped.length, 2);
  });
});

describe('memorize: text-neighbour contradiction candidates', () => {
  it('proposes a same-project, same-type memory that shares no tags but restates the fact', () => {
    const ctx = { project: 'acme', topics: [], task_type: 'deploy' };
    const [oldM] = memorize([{
      title: 'Website deploys with wrangler from the laptop', type: 'decision', origin: 'user',
      content: 'The marketing website deploys by running wrangler deploy manually from the laptop.',
      tags: ['cloudflare'], encoding_context: ctx,
    }]).stored;
    const [newM] = memorize([{
      title: 'Website deploys automatically from GitHub Actions', type: 'decision', origin: 'user',
      content: 'The marketing website now deploys automatically via GitHub Actions on push; no manual wrangler deploy.',
      tags: ['ci'], encoding_context: ctx,
    }]).stored;
    assert.ok((newM.potential_conflicts || []).some((c) => c.id === oldM.id), JSON.stringify(newM));
  });

  it('does not propose memories from another project', () => {
    memorize([{
      title: 'Website deploys with wrangler from the laptop', type: 'decision', origin: 'user',
      content: 'The marketing website deploys by running wrangler deploy manually.', tags: ['cloudflare'],
      encoding_context: { project: 'other', topics: [], task_type: '' },
    }]);
    const [newM] = memorize([{
      title: 'Website deploys automatically from GitHub Actions', type: 'decision', origin: 'user',
      content: 'The marketing website now deploys automatically via GitHub Actions; no manual wrangler deploy.',
      tags: ['ci'], encoding_context: { project: 'acme', topics: [], task_type: '' },
    }]).stored;
    assert.equal(newM.potential_conflicts, undefined);
  });
});

describe('session-start maintenance signals', () => {
  const { computeSessionStart } = require('../bin/session-start.js');
  const day = 86400000;

  function seed(n, createdMs, project = 'acme') {
    const index = readIndex(tmpDir);
    for (let i = 0; i < n; i++) {
      const id = `mem_s${Object.keys(index.memories).length}`;
      index.memories[id] = {
        path: `professional/${id}.md`, title: id, type: 'learning', strength: 0.7, decay_rate: 0.99,
        created: new Date(createdMs).toISOString(), last_accessed: new Date(createdMs).toISOString(),
        access_count: 0, tags: [], encoding_context: { project },
      };
    }
    index.memory_count = Object.keys(index.memories).length;
    writeIndex(index, tmpDir);
  }

  it('flags sleep as due after a week with enough new memories, using backup dirs as the last-sleep mark', () => {
    const now = Date.now();
    fs.mkdirSync(path.join(brainDir, '_sleep_backups', new Date(now - 10 * day).toISOString().replace(/[:.]/g, '-')), { recursive: true });
    seed(12, now - 2 * day);
    const p = computeSessionStart(tmpDir, { project: 'acme' });
    assert.equal(p.sleep_due.due, true);
    assert.equal(p.sleep_due.days_since_last, 10);
    assert.equal(p.sleep_due.memorized_since, 12);
  });

  it('stays quiet right after a sleep', () => {
    const now = Date.now();
    seed(12, now - 3 * day);
    fs.writeFileSync(path.join(brainDir, 'sleep-log.json'), JSON.stringify({ last_sleep: new Date(now - day).toISOString() }));
    assert.equal(computeSessionStart(tmpDir, { project: 'acme' }).sleep_due, undefined);
  });

  it('surfaces notable_unsaved from recent sessions not followed by a write', () => {
    const now = Date.now();
    seed(1, now - 5 * day);
    writeContexts({ version: 1, sessions: [
      { project: 'acme', ended: new Date(now - 6 * day).toISOString(), notable_unsaved: ['handled already'] },
      { project: 'acme', ended: new Date(now - day).toISOString(), notable_unsaved: ['Decided X over Y', 'x'.repeat(400)] },
      { project: 'other', ended: new Date(now - day).toISOString(), notable_unsaved: ['not this project'] },
    ] }, tmpDir);
    const p = computeSessionStart(tmpDir, { project: 'acme' });
    assert.equal(p.unsaved_notables.count, 2);
    assert.equal(p.unsaved_notables.items[0], 'Decided X over Y');
    assert.ok(p.unsaved_notables.items[1].length <= 160);
  });
});
