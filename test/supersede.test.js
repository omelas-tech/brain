const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { writeIndex, readIndex } = require('../src/index-manager');
const { rankMemories } = require('../src/scorer');

const MEMORIZE = path.join(__dirname, '..', 'bin', 'memorize.js');
const RECALL = path.join(__dirname, '..', 'bin', 'recall.js');

let tmpDir;
let brainDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-supersede-'));
  brainDir = path.join(tmpDir, '.brain');
  fs.mkdirSync(brainDir, { recursive: true });
  writeIndex({ version: '2.0', memory_count: 0, memories: {} }, tmpDir);
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const env = () => ({ ...process.env, HOME: tmpDir, USERPROFILE: tmpDir, BRAIN_DIR: brainDir });

function memorize(mem) {
  const stdout = execFileSync('node', [MEMORIZE], {
    input: JSON.stringify({ memories: [mem] }),
    env: env(),
    encoding: 'utf-8',
  });
  return JSON.parse(stdout);
}

function recall(query) {
  const stdout = execFileSync('node', [RECALL, query, '--top', '10'], { env: env(), encoding: 'utf-8' });
  return JSON.parse(stdout);
}

const base = (over) => ({
  type: 'decision', cognitive_type: 'semantic', origin: 'user',
  tags: ['database'], salience: 0.6, confidence: 0.9, ...over,
});

describe('scorer: superseded demotion (unit)', () => {
  const mem = (id, over = {}) => ({
    id, title: id, path: `p/${id}.md`, type: 'decision',
    strength: 0.8, decay_rate: 0.997, salience: 0.6, confidence: 0.9,
    last_accessed: '2026-06-01T00:00:00.000Z', created: '2026-06-01T00:00:00.000Z',
    tags: ['x'], origin: 'user', ...over,
  });

  it('a superseded memory ranks below its equally-relevant successor', () => {
    const rel = { old: 0.6, new: 0.6 };
    const ranked = rankMemories(
      [mem('old', { superseded_by: 'new' }), mem('new')],
      (m) => rel[m.id]
    );
    assert.deepEqual(ranked.map((m) => m.id), ['new', 'old']);
  });

  it('is a demotion, not exclusion — the superseded memory still appears', () => {
    const ranked = rankMemories([mem('old', { superseded_by: 'new' })], () => 0.5);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].id, 'old');
    assert.ok(Number.isFinite(ranked[0].score));
  });

  it('a much more relevant superseded memory can still surface but is penalized', () => {
    // old is far more relevant; penalty shrinks its lead but it is not dropped.
    const withPenalty = rankMemories([mem('old', { superseded_by: 'new' })], () => 0.9)[0].score;
    const withoutPenalty = rankMemories([mem('old')], () => 0.9)[0].score;
    assert.ok(withPenalty < withoutPenalty, 'superseded score must be lower');
  });
});

describe('memorize + recall: supersedes (end-to-end)', () => {
  it('supersedes stamps superseded_by on the target and reports it', () => {
    const first = memorize(base({
      title: 'Use MySQL', path: 'professional/db/mysql.md',
      content: 'We use MySQL for the API.',
    }));
    const oldId = first.stored[0].id;

    const second = memorize(base({
      title: 'Use Postgres now', path: 'professional/db/postgres.md',
      content: 'We migrated to Postgres for the API.',
      supersedes: [oldId],
    }));
    assert.ok(second.stored[0].superseded.some((s) => s.id === oldId));

    const index = readIndex(tmpDir);
    assert.equal(index.memories[oldId].superseded_by, second.stored[0].id);
    // frontmatter mirrors it
    const file = fs.readFileSync(path.join(brainDir, 'professional/db/mysql.md'), 'utf-8');
    assert.match(file, new RegExp(`superseded_by: "${second.stored[0].id}"`));
    // the new memory records what it replaced
    assert.deepEqual(index.memories[second.stored[0].id].supersedes, [oldId]);
  });

  it('recall surfaces superseded_by and ranks the successor first', () => {
    const first = memorize(base({
      title: 'Deploy target is Heroku', path: 'professional/ops/heroku.md',
      content: 'Deployment goes to Heroku.', tags: ['deploy', 'ops'],
    }));
    const oldId = first.stored[0].id;
    const second = memorize(base({
      title: 'Deploy target is Fly.io', path: 'professional/ops/fly.md',
      content: 'Deployment now goes to Fly.io.', tags: ['deploy', 'ops'],
      supersedes: [oldId],
    }));
    const newId = second.stored[0].id;

    const results = recall('deployment target');
    const ids = results.map((r) => r.id);
    assert.ok(ids.includes(newId) && ids.includes(oldId), 'both present');
    assert.ok(ids.indexOf(newId) < ids.indexOf(oldId), 'successor ranks first');
    const oldResult = results.find((r) => r.id === oldId);
    assert.equal(oldResult.superseded_by, newId);
  });

  it('an unknown supersedes id is skipped silently', () => {
    const out = memorize(base({
      title: 'x', path: 'professional/db/x.md', content: 'x', supersedes: ['mem_does_not_exist'],
    }));
    assert.equal(out.stored[0].superseded, undefined);
  });
});
