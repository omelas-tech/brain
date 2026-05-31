const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  checkGitAvailable,
  initSyncRepo,
  configureRemote,
  getStatus,
  push,
  pull,
  getSyncConfig,
  writeSyncConfig,
  copyBrainToRepo,
  copyRepoToBrain,
  resolvePaths,
} = require('../src/git-sync');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir, brainDir, bareRemote;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-gitsync-test-'));
  brainDir = path.join(tmpDir, '.brain');
  fs.mkdirSync(brainDir, { recursive: true });

  // Create a bare git repo to act as the remote
  bareRemote = path.join(tmpDir, 'remote.git');
  fs.mkdirSync(bareRemote);
  execFileSync('git', ['init', '--bare', '-b', 'main'], { cwd: bareRemote, stdio: 'pipe' });
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function writeBrainFile(relPath, content) {
  const full = path.join(brainDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

// ===========================================================================
// checkGitAvailable
// ===========================================================================

describe('checkGitAvailable', () => {
  it('returns true when git is installed', () => {
    assert.equal(checkGitAvailable(), true);
  });
});

// ===========================================================================
// initSyncRepo
// ===========================================================================

describe('initSyncRepo', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('creates a git repo at .brain/.sync/repo/', () => {
    const { repoDir } = initSyncRepo(brainDir);
    assert.ok(fs.existsSync(path.join(repoDir, '.git')));
  });

  it('sets git config for user name and email', () => {
    const { repoDir } = initSyncRepo(brainDir);
    const email = execFileSync('git', ['config', 'user.email'], {
      cwd: repoDir, encoding: 'utf8', stdio: 'pipe',
    }).trim();
    assert.equal(email, 'brain-memory@local');
  });
});

// ===========================================================================
// configureRemote
// ===========================================================================

describe('configureRemote', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('adds a remote origin', () => {
    initSyncRepo(brainDir);
    configureRemote(brainDir, bareRemote);

    const { repoDir } = resolvePaths(brainDir);
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: repoDir, encoding: 'utf8', stdio: 'pipe',
    }).trim();
    assert.equal(url, bareRemote);
  });

  it('updates an existing remote', () => {
    initSyncRepo(brainDir);
    configureRemote(brainDir, bareRemote);
    configureRemote(brainDir, '/new/path');

    const { repoDir } = resolvePaths(brainDir);
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: repoDir, encoding: 'utf8', stdio: 'pipe',
    }).trim();
    assert.equal(url, '/new/path');
  });
});

// ===========================================================================
// copyBrainToRepo / copyRepoToBrain
// ===========================================================================

describe('copyBrainToRepo', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('copies files from .brain/ to repo, excluding .sync/', () => {
    writeBrainFile('index.json', '{"memories":[]}');
    writeBrainFile('professional/_meta.json', '{}');
    // .sync/ should be excluded
    fs.mkdirSync(path.join(brainDir, '.sync'), { recursive: true });
    fs.writeFileSync(path.join(brainDir, '.sync', 'config.json'), '{}');

    const { repoDir } = initSyncRepo(brainDir);
    copyBrainToRepo(brainDir, repoDir, null);

    assert.ok(fs.existsSync(path.join(repoDir, 'index.json')));
    assert.ok(fs.existsSync(path.join(repoDir, 'professional', '_meta.json')));
    assert.ok(!fs.existsSync(path.join(repoDir, '.sync')));
  });

  it('encrypts files when passphrase is provided', () => {
    writeBrainFile('index.json', '{"test":true}');
    const { repoDir } = initSyncRepo(brainDir);

    copyBrainToRepo(brainDir, repoDir, 'my-secret');

    const content = fs.readFileSync(path.join(repoDir, 'index.json'));
    // Encrypted content should NOT be valid JSON
    assert.throws(() => JSON.parse(content.toString('utf8')));
  });
});

describe('copyRepoToBrain', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('copies files from repo back to .brain/', () => {
    const { repoDir } = initSyncRepo(brainDir);

    // Write a file directly into the repo
    fs.writeFileSync(path.join(repoDir, 'new-file.json'), '{"new":true}');

    copyRepoToBrain(repoDir, brainDir, null);

    assert.ok(fs.existsSync(path.join(brainDir, 'new-file.json')));
    assert.equal(fs.readFileSync(path.join(brainDir, 'new-file.json'), 'utf8'), '{"new":true}');
  });
});

// ===========================================================================
// push / pull (integration with bare remote)
// ===========================================================================

describe('push', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('commits and pushes brain files to the bare remote', () => {
    writeBrainFile('index.json', '{"memories":[]}');
    writeSyncConfig(brainDir, { type: 'git', remote: bareRemote, branch: 'main', encrypt: false });

    initSyncRepo(brainDir);
    configureRemote(brainDir, bareRemote);

    const result = push(brainDir, 'initial push');
    assert.equal(result.committed, true);
    assert.equal(result.pushed, true);

    // Verify the config was updated with lastPush
    const config = getSyncConfig(brainDir);
    assert.ok(config.lastPush);
  });

  it('returns no-op when there are no changes', () => {
    writeBrainFile('index.json', '{"memories":[]}');
    writeSyncConfig(brainDir, { type: 'git', remote: bareRemote, branch: 'main', encrypt: false });

    initSyncRepo(brainDir);
    configureRemote(brainDir, bareRemote);
    push(brainDir, 'first');

    const result = push(brainDir, 'second');
    assert.equal(result.committed, false);
    assert.equal(result.pushed, false);
  });

  it('throws when sync is not configured', () => {
    assert.throws(() => push(brainDir, 'test'), /not configured/);
  });

  it('throws when encryption is enabled but no passphrase given', () => {
    writeSyncConfig(brainDir, { type: 'git', remote: bareRemote, branch: 'main', encrypt: true });
    assert.throws(() => push(brainDir, 'test'), /passphrase/i);
  });

  it('works with encryption enabled', () => {
    writeBrainFile('index.json', '{"encrypted":true}');
    writeSyncConfig(brainDir, { type: 'git', remote: bareRemote, branch: 'main', encrypt: true });

    initSyncRepo(brainDir);
    configureRemote(brainDir, bareRemote);

    const result = push(brainDir, 'encrypted push', 'secret123');
    assert.equal(result.committed, true);
    assert.equal(result.pushed, true);
  });
});

describe('pull', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('pulls remote changes into .brain/', () => {
    // First push from brain
    writeBrainFile('index.json', '{"v":1}');
    writeSyncConfig(brainDir, { type: 'git', remote: bareRemote, branch: 'main', encrypt: false });
    initSyncRepo(brainDir);
    configureRemote(brainDir, bareRemote);
    push(brainDir, 'initial');

    // Simulate a remote change by cloning, modifying, pushing
    const cloneDir = path.join(tmpDir, 'clone');
    execFileSync('git', ['clone', bareRemote, cloneDir], { stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@test.local'], { cwd: cloneDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: cloneDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(cloneDir, 'index.json'), '{"v":2}');
    execFileSync('git', ['add', '-A'], { cwd: cloneDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'remote update'], { cwd: cloneDir, stdio: 'pipe' });
    execFileSync('git', ['push'], { cwd: cloneDir, stdio: 'pipe' });

    // Pull into brain
    const result = pull(brainDir);
    assert.equal(result.pulled, true);
    assert.equal(fs.readFileSync(path.join(brainDir, 'index.json'), 'utf8'), '{"v":2}');
  });

  it('throws when sync is not configured', () => {
    assert.throws(() => pull(brainDir), /not configured/);
  });

  it('works with encryption round-trip', () => {
    const passphrase = 'roundtrip-secret';

    // Push encrypted
    writeBrainFile('index.json', '{"secret":"data"}');
    writeSyncConfig(brainDir, { type: 'git', remote: bareRemote, branch: 'main', encrypt: true });
    initSyncRepo(brainDir);
    configureRemote(brainDir, bareRemote);
    push(brainDir, 'encrypted push', passphrase);

    // Create a fresh brain dir and pull
    const brainDir2 = path.join(tmpDir, '.brain2');
    fs.mkdirSync(brainDir2, { recursive: true });
    writeSyncConfig(brainDir2, { type: 'git', remote: bareRemote, branch: 'main', encrypt: true });
    initSyncRepo(brainDir2);
    configureRemote(brainDir2, bareRemote);

    const result = pull(brainDir2, passphrase);
    assert.equal(result.pulled, true);
    assert.equal(
      fs.readFileSync(path.join(brainDir2, 'index.json'), 'utf8'),
      '{"secret":"data"}'
    );
  });
});

// ===========================================================================
// getStatus
// ===========================================================================

describe('getStatus', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('returns configured:false when no config exists', () => {
    const status = getStatus(brainDir);
    assert.equal(status.configured, false);
  });

  it('returns configured:true with remote info', () => {
    writeBrainFile('index.json', '{}');
    writeSyncConfig(brainDir, { type: 'git', remote: bareRemote, branch: 'main', encrypt: false });
    initSyncRepo(brainDir);
    configureRemote(brainDir, bareRemote);
    push(brainDir, 'init');

    const status = getStatus(brainDir);
    assert.equal(status.configured, true);
    assert.equal(status.remote, bareRemote);
    assert.equal(status.branch, 'main');
  });
});

// ===========================================================================
// getSyncConfig / writeSyncConfig
// ===========================================================================

describe('getSyncConfig / writeSyncConfig', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('returns null when no config exists', () => {
    assert.equal(getSyncConfig(brainDir), null);
  });

  it('round-trips config', () => {
    const config = { type: 'git', remote: 'git@example.com:repo.git', branch: 'main', encrypt: false };
    writeSyncConfig(brainDir, config);
    const loaded = getSyncConfig(brainDir);
    assert.deepEqual(loaded, config);
  });
});

// ===========================================================================
// pull: divergence, merge conflicts & unreachable remote (lines 335-372)
// ===========================================================================
describe('pull conflict & failure handling', () => {
  beforeEach(setup);
  afterEach(teardown);

  const gitCfg = () => ({ type: 'git', remote: bareRemote, branch: 'main', encrypt: false });

  it('non-fast-forward push is reported as committed-but-not-pushed', () => {
    writeSyncConfig(brainDir, gitCfg());
    writeBrainFile('note.md', 'ORIGINAL\n');
    assert.equal(push(brainDir, 'init').pushed, true);

    // A second brain advances the remote behind brain1's back.
    const dir2 = path.join(tmpDir, 'brain2');
    fs.mkdirSync(dir2, { recursive: true });
    writeSyncConfig(dir2, gitCfg());
    assert.equal(pull(dir2).pulled, true);
    fs.writeFileSync(path.join(dir2, 'note.md'), 'FROM-BRAIN-2\n');
    assert.equal(push(dir2, 'b2').pushed, true);

    // brain1 commits a conflicting change → push is rejected (non-fast-forward).
    writeBrainFile('note.md', 'FROM-BRAIN-1\n');
    const p = push(brainDir, 'b1');
    assert.equal(p.committed, true);
    assert.equal(p.pushed, false);
    assert.match(p.message, /push failed/i);
  });

  it('detects a true merge conflict and lists the conflicting file', () => {
    writeSyncConfig(brainDir, gitCfg());
    writeBrainFile('note.md', 'ORIGINAL\n');
    push(brainDir, 'init');

    const dir2 = path.join(tmpDir, 'brain2');
    fs.mkdirSync(dir2, { recursive: true });
    writeSyncConfig(dir2, gitCfg());
    pull(dir2);
    fs.writeFileSync(path.join(dir2, 'note.md'), 'FROM-BRAIN-2\n');
    push(dir2, 'b2');

    writeBrainFile('note.md', 'FROM-BRAIN-1\n');
    push(brainDir, 'b1'); // commits locally, push rejected

    const r = pull(brainDir);
    assert.equal(r.pulled, false);
    assert.equal(r.hasConflicts, true);
    assert.ok(r.conflictFiles.includes('note.md'), `conflict files: ${JSON.stringify(r.conflictFiles)}`);
    assert.match(r.message, /Merge conflict in 1 file/);

    // The failed merge must be aborted, leaving the repo clean (no .git/MERGE_HEAD).
    const { repoDir } = resolvePaths(brainDir);
    assert.ok(!fs.existsSync(path.join(repoDir, '.git', 'MERGE_HEAD')), 'merge was aborted');
  });

  it('reports an unreachable remote instead of throwing', () => {
    writeSyncConfig(brainDir, { ...gitCfg(), remote: path.join(tmpDir, 'ghost.git') });
    writeBrainFile('a.md', 'x');
    push(brainDir); // commits locally; push to the bogus remote fails silently
    const r = pull(brainDir);
    assert.equal(r.pulled, false);
    assert.equal(r.hasConflicts, false);
    assert.match(r.message, /unreachable/i);
  });
});
