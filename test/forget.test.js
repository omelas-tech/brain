const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Smoke tests for the `bin/forget.js` CLI (archive primitive). Seeds a temp
// brain via the memorize CLI, then asserts forget archives a memory and clears
// it from BOTH index.json and search-index.json — the latter being the
// regression guard for the readSearchIndex/writeSearchIndex import fix.

const FORGET = path.join(__dirname, '..', 'bin', 'forget.js');
const MEMORIZE = path.join(__dirname, '..', 'bin', 'memorize.js');

let tmpDir;
let brainDir;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-forget-'));
  brainDir = path.join(tmpDir, '.brain');
  fs.mkdirSync(brainDir, { recursive: true });
}
function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

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
 * Drive bin/forget.js as a subprocess. Returns { status, stdout, stderr, json }.
 * Never throws — a non-zero exit is captured so error cases can be asserted.
 */
function forget(args) {
  try {
    const stdout = execFileSync('node', [FORGET, ...args], {
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

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(brainDir, rel), 'utf-8'));

const baseMem = (over = {}) => ({
  title: 'A learning',
  type: 'learning',
  cognitive_type: 'semantic',
  path: 'professional/notes/learn.md',
  content: 'Something worth remembering about databases and pooling.',
  tags: ['database'],
  salience: 0.5,
  ...over,
});

describe('forget CLI: archive + cleanup', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('archives a memory and removes it from index.json AND search-index.json', () => {
    initBrain();
    const id = seed([baseMem()]).stored[0].id;

    // Precondition: present in both the live index and the search index.
    assert.ok(readJson('index.json').memories[id], 'seeded into index.json');
    assert.ok(readJson('search-index.json').documents[id], 'seeded into search-index.json');

    const r = forget([id]);
    assert.equal(r.status, 0);
    assert.equal(r.json.archived, true);
    assert.equal(r.json.id, id);

    // Removed from the live index.
    assert.equal(readJson('index.json').memories[id], undefined, 'gone from index.json');

    // Removed from the search index — the regression this fix targets.
    assert.equal(readJson('search-index.json').documents[id], undefined, 'gone from search-index.json');

    // Recorded in the archive index and the file moved under _archived/.
    assert.ok(readJson('_archived/index.json').memories[id], 'recorded in archive index');
    assert.ok(
      fs.existsSync(path.join(brainDir, '_archived', 'professional/notes/learn.md')),
      'memory file moved into _archived/'
    );
  });

  it('refuses to archive a high-salience memory without --force, then archives with it', () => {
    initBrain();
    const id = seed([baseMem({ salience: 0.9 })]).stored[0].id;

    const blocked = forget([id]);
    assert.equal(blocked.status, 1);
    assert.equal(blocked.json.protected, true);
    // Still live in both indexes — nothing was touched.
    assert.ok(readJson('index.json').memories[id], 'still in index.json');
    assert.ok(readJson('search-index.json').documents[id], 'still in search-index.json');

    const forced = forget([id, '--force']);
    assert.equal(forced.status, 0);
    assert.equal(forced.json.archived, true);
    assert.equal(readJson('index.json').memories[id], undefined);
    assert.equal(readJson('search-index.json').documents[id], undefined);
  });

  it('exits non-zero for an unknown memory id', () => {
    initBrain();
    const r = forget(['mem_does_not_exist']);
    assert.equal(r.status, 1);
    assert.match(r.json.error, /not found/i);
  });

  it('exits non-zero when no id is provided', () => {
    initBrain();
    const r = forget([]);
    assert.equal(r.status, 1);
    assert.match(r.json.error, /Usage/);
  });
});
