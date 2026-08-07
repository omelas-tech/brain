const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  push,
  listRestorePoints,
  restoreTo,
  writeSyncConfig,
} = require('../src/git-sync');

// ---------------------------------------------------------------------------
// Helpers (matches git-sync.test.js conventions — tmp brain, no remote needed:
// push() commits locally when no remote is configured, which is all restore
// history requires)
// ---------------------------------------------------------------------------

let tmpDir, brainDir;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-restore-test-'));
  brainDir = path.join(tmpDir, '.brain');
  fs.mkdirSync(brainDir, { recursive: true });
  writeSyncConfig(brainDir, { encrypt: false });
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function writeBrainFile(relPath, content) {
  const full = path.join(brainDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function readBrainFile(relPath) {
  return fs.readFileSync(path.join(brainDir, relPath), 'utf8');
}

// ===========================================================================
// listRestorePoints
// ===========================================================================

describe('listRestorePoints', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('throws when sync is not configured', () => {
    const bare = path.join(tmpDir, 'unconfigured');
    fs.mkdirSync(bare, { recursive: true });
    assert.throws(() => listRestorePoints(bare), /Sync not configured/);
  });

  it('returns [] before any push', () => {
    assert.deepEqual(listRestorePoints(brainDir), []);
  });

  it('lists one point per push, newest first, with hash/date/message', () => {
    writeBrainFile('index.json', '{"v":1}');
    push(brainDir, 'first');
    writeBrainFile('index.json', '{"v":2}');
    push(brainDir, 'second');

    const points = listRestorePoints(brainDir);
    assert.equal(points.length, 2);
    assert.equal(points[0].message, 'second');
    assert.equal(points[1].message, 'first');
    for (const p of points) {
      assert.match(p.commit, /^[0-9a-f]{40}$/);
      assert.ok(!Number.isNaN(new Date(p.date).getTime()));
    }
  });

  it('respects the limit', () => {
    for (let i = 0; i < 4; i++) {
      writeBrainFile('index.json', `{"v":${i}}`);
      push(brainDir, `push ${i}`);
    }
    assert.equal(listRestorePoints(brainDir, 2).length, 2);
  });
});

// ===========================================================================
// restoreTo
// ===========================================================================

describe('restoreTo', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('rejects an unknown ref', () => {
    writeBrainFile('index.json', '{}');
    push(brainDir, 'first');
    assert.throws(() => restoreTo(brainDir, 'deadbeef'), /Unknown restore point/);
  });

  it('throws before any history exists', () => {
    assert.throws(() => restoreTo(brainDir, 'HEAD'), /No sync history/);
  });

  it('restores files, removes post-snapshot files, and records a forward commit', () => {
    writeBrainFile('index.json', '{"memories":{"a":1}}');
    writeBrainFile('professional/a.md', 'memory A');
    push(brainDir, 'first');
    const [first] = listRestorePoints(brainDir);

    writeBrainFile('index.json', '{"memories":{"a":1,"b":1}}');
    writeBrainFile('professional/b.md', 'memory B');
    push(brainDir, 'second');

    const result = restoreTo(brainDir, first.commit);

    assert.equal(readBrainFile('professional/a.md'), 'memory A');
    assert.equal(readBrainFile('index.json'), '{"memories":{"a":1}}');
    assert.ok(!fs.existsSync(path.join(brainDir, 'professional/b.md')),
      'post-snapshot file must not survive the restore');
    assert.equal(result.restored_to, first.commit);
    // The brain matched HEAD when restore ran (just pushed), so no safety
    // snapshot was needed; the restore itself is a new forward commit.
    assert.equal(result.safety_commit, null);
    assert.notEqual(result.restore_commit, first.commit);
    assert.equal(listRestorePoints(brainDir)[0].commit, result.restore_commit);
  });

  it('safety-commits unsynced work so a restore is undoable', () => {
    writeBrainFile('professional/a.md', 'memory A');
    push(brainDir, 'first');
    const [first] = listRestorePoints(brainDir);

    // Unsynced change — never pushed.
    writeBrainFile('professional/c.md', 'memory C (unsynced)');

    const result = restoreTo(brainDir, first.commit);
    assert.ok(result.safety_commit, 'unsynced work must produce a safety snapshot');
    assert.ok(!fs.existsSync(path.join(brainDir, 'professional/c.md')));

    // Undo: restore to the safety snapshot brings the unsynced file back.
    restoreTo(brainDir, result.safety_commit);
    assert.equal(readBrainFile('professional/c.md'), 'memory C (unsynced)');
  });

  it('carries audit.log forward across the restore instead of rolling it back', () => {
    writeBrainFile('audit.log', '{"event":"memorize","id":"m1"}\n');
    writeBrainFile('professional/a.md', 'memory A');
    push(brainDir, 'first');
    const [first] = listRestorePoints(brainDir);

    fs.appendFileSync(path.join(brainDir, 'audit.log'), '{"event":"memorize","id":"m2"}\n');
    push(brainDir, 'second');

    restoreTo(brainDir, first.commit);
    const audit = readBrainFile('audit.log');
    assert.ok(audit.includes('"m2"'), 'audit entries written after the restore point must survive');
  });

  it('round-trips an encrypted brain with the passphrase', () => {
    writeSyncConfig(brainDir, { encrypt: true });
    writeBrainFile('professional/a.md', 'secret A');
    push(brainDir, 'first', 'hunter2');
    const [first] = listRestorePoints(brainDir);

    writeBrainFile('professional/a.md', 'secret A v2');
    push(brainDir, 'second', 'hunter2');

    assert.throws(() => restoreTo(brainDir, first.commit), /passphrase/);
    restoreTo(brainDir, first.commit, 'hunter2');
    assert.equal(readBrainFile('professional/a.md'), 'secret A');
  });

  it('never touches .sync/ infrastructure', () => {
    writeBrainFile('professional/a.md', 'memory A');
    push(brainDir, 'first');
    const [first] = listRestorePoints(brainDir);
    writeBrainFile('professional/b.md', 'memory B');
    push(brainDir, 'second');

    restoreTo(brainDir, first.commit);
    assert.ok(fs.existsSync(path.join(brainDir, '.sync', 'repo', '.git')),
      'sync repo must survive a restore');
    assert.ok(fs.existsSync(path.join(brainDir, '.sync', 'config.json')));
  });
});
