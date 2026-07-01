const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Smoke tests for the `bin/recall.js` CLI (the deterministic recall engine).
// The underlying scoring math is covered in tfidf/scorer/recall.test.js; this
// file exercises the executable end-to-end: seed a temp brain via the memorize
// CLI, then assert recall returns ranked, query-relevant results.

const RECALL = path.join(__dirname, '..', 'bin', 'recall.js');
const MEMORIZE = path.join(__dirname, '..', 'bin', 'memorize.js');

let tmpDir;
let brainDir;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-recall-cli-'));
  brainDir = path.join(tmpDir, '.brain');
  fs.mkdirSync(brainDir, { recursive: true });
}
function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

/** Write a minimal but valid empty index so the CLIs treat the brain as initialized. */
function initBrain() {
  fs.writeFileSync(path.join(brainDir, 'index.json'), JSON.stringify({
    version: '2.0',
    memory_count: 0,
    memories: {},
    last_updated: new Date().toISOString(),
  }, null, 2));
}

/** Drive bin/memorize.js to seed memories. Returns the parsed JSON result. */
function seed(memories) {
  const stdout = execFileSync('node', [MEMORIZE], {
    input: JSON.stringify({ memories }),
    env: { ...process.env, BRAIN_DIR: brainDir },
    encoding: 'utf-8',
  });
  return JSON.parse(stdout);
}

/**
 * Drive bin/recall.js as a subprocess. Returns { status, stdout, stderr, json }.
 * Never throws — a non-zero exit is captured so error cases can be asserted.
 */
function recall(args) {
  try {
    const stdout = execFileSync('node', [RECALL, ...args], {
      env: { ...process.env, BRAIN_DIR: brainDir },
      encoding: 'utf-8',
    });
    return { status: 0, stdout, stderr: '', json: JSON.parse(stdout) };
  } catch (err) {
    let json = null;
    try { json = JSON.parse((err.stderr || '').trim()); } catch { /* not JSON */ }
    return { status: err.status ?? 1, stdout: err.stdout || '', stderr: err.stderr || '', json };
  }
}

const THREE_MEMORIES = [
  {
    title: 'Database connection pooling',
    type: 'learning',
    cognitive_type: 'semantic',
    path: 'professional/db.md',
    content: 'Use a pg connection pool with parameterized queries for database performance.',
    tags: ['database', 'pooling', 'postgres'],
  },
  {
    title: 'JWT authentication flow',
    type: 'learning',
    cognitive_type: 'semantic',
    path: 'professional/auth.md',
    content: 'Issue JWT tokens with refresh rotation and bcrypt password hashing.',
    tags: ['auth', 'jwt', 'security'],
  },
  {
    title: 'CSS flexbox layout',
    type: 'learning',
    cognitive_type: 'semantic',
    path: 'professional/css.md',
    content: 'Use flexbox for one-dimensional responsive layouts in the frontend.',
    tags: ['css', 'frontend', 'layout'],
  },
];

describe('recall CLI: ranked retrieval', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('returns query-relevant results ranked by score (descending)', () => {
    initBrain();
    const seeded = seed(THREE_MEMORIES);
    const dbId = seeded.stored.find((m) => m.title === 'Database connection pooling').id;

    const r = recall(['database connection pooling', '--top', '10']);
    assert.equal(r.status, 0);
    assert.ok(Array.isArray(r.json));
    assert.ok(r.json.length > 0, 'expected at least one result');

    // The database memory must rank first for a database query.
    assert.equal(r.json[0].id, dbId);

    // Each result carries the documented scoring fields...
    for (const res of r.json) {
      assert.ok(typeof res.score === 'number');
      assert.ok(res.id && res.title);
    }
    // ...and the list is sorted by score, non-increasing.
    for (let i = 1; i < r.json.length; i++) {
      assert.ok(r.json[i].score <= r.json[i - 1].score, `rank violation at ${i}`);
    }
  });

  it('honors --top to cap the number of results', () => {
    initBrain();
    seed(THREE_MEMORIES);
    const r = recall(['frontend database auth', '--top', '2']);
    assert.equal(r.status, 0);
    assert.ok(r.json.length <= 2, `expected <=2 results, got ${r.json.length}`);
  });

  it('returns an empty array when the brain has no memories', () => {
    initBrain();
    const r = recall(['anything at all']);
    assert.equal(r.status, 0);
    assert.deepEqual(r.json, []);
  });

  it('exits non-zero when the brain is not initialized', () => {
    // No initBrain() → no index.json.
    const r = recall(['query']);
    assert.equal(r.status, 1);
    assert.match(r.json.error, /not initialized/i);
  });
});

describe('recall CLI: relevance floor', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('does not pad query results with unrelated memories', () => {
    initBrain();
    seed(THREE_MEMORIES);

    // Only the database memory relates to this query — the auth and css
    // memories must not ride along on strength/recency alone.
    const r = recall(['database pooling', '--top', '10']);
    assert.equal(r.status, 0);
    assert.ok(r.json.length >= 1, 'the relevant memory should be returned');
    const titles = r.json.map((m) => m.title);
    assert.ok(!titles.includes('CSS flexbox layout'),
      `unrelated memory padded the results: ${JSON.stringify(titles)}`);
  });

  it('returns an empty array for a query the brain knows nothing about', () => {
    initBrain();
    seed(THREE_MEMORIES);
    const r = recall(['quantum blockchain yoga retreat']);
    assert.equal(r.status, 0);
    assert.deepEqual(r.json, [], 'no-match query should return no results, not strength-ranked padding');
  });

  it('context mode still returns strength-ranked memories without a matching query', () => {
    initBrain();
    seed(THREE_MEMORIES);
    // --context builds a broad topical query; padding is intended there.
    const r = recall(['--context', '--project', 'nonexistent-project']);
    assert.equal(r.status, 0);
    assert.equal(r.json.length, 3, 'context mode must not apply the relevance floor');
  });
});
