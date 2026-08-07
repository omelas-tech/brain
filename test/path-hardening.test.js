const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { validateBrainPath, writeIndex, readIndex } = require('../src/index-manager');
const { exportBrain, importBrain, previewImport } = require('../src/export-import');
const { setFrontmatterFields } = require('../src/pinning');

// Symlink creation needs privileges on Windows — skip those cases there.
const CAN_SYMLINK = process.platform !== 'win32';

let tmpDir;
let brainDir;
let outsideDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-hardening-'));
  brainDir = path.join(tmpDir, '.brain');
  outsideDir = path.join(tmpDir, 'outside');
  fs.mkdirSync(brainDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('validateBrainPath: symlink hardening', () => {
  it('still rejects plain lexical traversal', () => {
    assert.throws(
      () => validateBrainPath(path.join(brainDir, '..', 'outside', 'x.md'), brainDir),
      /outside/
    );
  });

  it('accepts a normal path inside the brain', () => {
    validateBrainPath(path.join(brainDir, 'professional', 'x.md'), brainDir);
  });

  it('rejects a write under a symlinked directory that escapes the brain', { skip: !CAN_SYMLINK }, () => {
    fs.symlinkSync(outsideDir, path.join(brainDir, 'escape'));
    assert.throws(
      () => validateBrainPath(path.join(brainDir, 'escape', 'x.md'), brainDir),
      /Symlink escape/
    );
  });

  it('rejects a final component that is itself a symlink', { skip: !CAN_SYMLINK }, () => {
    const target = path.join(outsideDir, 'secret.txt');
    fs.writeFileSync(target, 'secret');
    fs.symlinkSync(target, path.join(brainDir, 'x.md'));
    assert.throws(
      () => validateBrainPath(path.join(brainDir, 'x.md'), brainDir),
      /symlink/i
    );
  });

  it('supports a brain dir that is itself a symlink (Dropbox/iCloud pattern)', { skip: !CAN_SYMLINK }, () => {
    const realBrain = path.join(tmpDir, 'real-brain');
    fs.mkdirSync(realBrain, { recursive: true });
    const linkBrain = path.join(tmpDir, 'link-brain');
    fs.symlinkSync(realBrain, linkBrain);
    // Writing inside via the symlinked root must be allowed.
    validateBrainPath(path.join(linkBrain, 'professional', 'x.md'), linkBrain);
  });
});

describe('export-import: traversal and symlink hardening', () => {
  function writeExport(files) {
    const p = path.join(tmpDir, 'evil.brain-export');
    fs.writeFileSync(p, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), files }));
    return p;
  }

  it('importBrain rejects .. traversal entries loudly', () => {
    const p = writeExport({ '../outside/pwned.txt': 'gotcha' });
    assert.throws(() => importBrain(p, brainDir, null), /traversal/);
    assert.ok(!fs.existsSync(path.join(outsideDir, 'pwned.txt')));
  });

  it('importBrain rejects absolute path entries', () => {
    const p = writeExport({ '/etc/pwned.txt': 'gotcha' });
    assert.throws(() => importBrain(p, brainDir, null), /traversal/);
  });

  it('previewImport rejects the same hostile entries instead of looking benign', () => {
    const p = writeExport({ 'ok.md': 'fine', '../outside/pwned.txt': 'gotcha' });
    assert.throws(() => previewImport(p, brainDir, null), /traversal/);
  });

  it('round-trips a legitimate export unchanged', () => {
    fs.mkdirSync(path.join(brainDir, 'professional'), { recursive: true });
    fs.writeFileSync(path.join(brainDir, 'professional', 'a.md'), 'alpha');
    const out = path.join(tmpDir, 'ok.brain-export');
    exportBrain(brainDir, out, null);

    const dest = path.join(tmpDir, 'dest-brain');
    fs.mkdirSync(dest, { recursive: true });
    const res = importBrain(out, dest, null);
    assert.equal(res.fileCount, 1);
    assert.equal(fs.readFileSync(path.join(dest, 'professional', 'a.md'), 'utf-8'), 'alpha');
  });

  it('exportBrain skips symlinks instead of reading through them', { skip: !CAN_SYMLINK }, () => {
    const secret = path.join(outsideDir, 'id_rsa');
    fs.writeFileSync(secret, 'PRIVATE KEY');
    fs.symlinkSync(secret, path.join(brainDir, 'leak.md'));
    fs.writeFileSync(path.join(brainDir, 'real.md'), 'fine');

    const out = path.join(tmpDir, 'x.brain-export');
    exportBrain(brainDir, out, null);
    const payload = JSON.parse(fs.readFileSync(out, 'utf-8'));
    assert.equal(payload.files['leak.md'], undefined);
    assert.equal(payload.files['real.md'], 'fine');
  });
});

describe('git-sync: symlink and credential hardening', () => {
  it('.cloud is excluded from git sync', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'git-sync.js'), 'utf-8');
    assert.match(src, /EXCLUDED = new Set\(\[[^\]]*'\.cloud'/);
  });

  it('copyBrainToRepo skips symlinks instead of copying their targets', { skip: !CAN_SYMLINK }, () => {
    // Exercise through the public sync path: writeSyncConfig then push()
    // (push commits locally when no remote is configured).
    const { writeSyncConfig, push } = require('../src/git-sync');
    writeSyncConfig(brainDir, { encrypt: false });

    const secret = path.join(outsideDir, 'id_rsa');
    fs.writeFileSync(secret, 'PRIVATE KEY');
    fs.symlinkSync(secret, path.join(brainDir, 'leak.md'));
    fs.writeFileSync(path.join(brainDir, 'real.md'), 'fine');
    fs.mkdirSync(path.join(brainDir, '.cloud'), { recursive: true });
    fs.writeFileSync(path.join(brainDir, '.cloud', 'config.json'), '{"token":"secret"}');

    push(brainDir);
    const repoDir = path.join(brainDir, '.sync', 'repo');
    assert.ok(fs.existsSync(path.join(repoDir, 'real.md')));
    assert.ok(!fs.existsSync(path.join(repoDir, 'leak.md')), 'symlink target leaked into sync repo');
    assert.ok(!fs.existsSync(path.join(repoDir, '.cloud')), 'cloud credentials leaked into sync repo');
  });
});

describe('cloud-sync: hostile tarball extraction', () => {
  const { execFileSync } = require('child_process');

  it('drops symlink members instead of materializing them', { skip: !CAN_SYMLINK }, () => {
    // Craft a tarball containing a symlink pointing outside.
    const stage = path.join(tmpDir, 'stage');
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(path.join(stage, 'good.md'), 'ok');
    fs.symlinkSync(outsideDir, path.join(stage, 'evil'));
    const tarPath = path.join(tmpDir, 'evil.tar.gz');
    execFileSync('tar', ['czf', tarPath, '-C', stage, '.']);

    // unpackBrain is internal — reach it through the module.
    const { unpackBrain } = require('../src/cloud-sync');
    unpackBrain(tarPath, brainDir);

    assert.equal(fs.readFileSync(path.join(brainDir, 'good.md'), 'utf-8'), 'ok');
    assert.ok(!fs.existsSync(path.join(brainDir, 'evil')), 'symlink member was materialized');
  });

  it('removes a pre-existing symlink at a destination instead of writing through it', { skip: !CAN_SYMLINK }, () => {
    const victim = path.join(outsideDir, 'victim.txt');
    fs.writeFileSync(victim, 'original');
    fs.symlinkSync(victim, path.join(brainDir, 'index.json.bak'));

    const stage = path.join(tmpDir, 'stage2');
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(path.join(stage, 'index.json.bak'), 'replaced');
    const tarPath = path.join(tmpDir, 'ok.tar.gz');
    execFileSync('tar', ['czf', tarPath, '-C', stage, '.']);

    const { unpackBrain } = require('../src/cloud-sync');
    unpackBrain(tarPath, brainDir);

    assert.equal(fs.readFileSync(victim, 'utf-8'), 'original', 'wrote through the symlink');
    assert.equal(fs.readFileSync(path.join(brainDir, 'index.json.bak'), 'utf-8'), 'replaced');
    assert.ok(!fs.lstatSync(path.join(brainDir, 'index.json.bak')).isSymbolicLink());
  });
});

describe('index-path writers: tampered index entries are inert', () => {
  it('setFrontmatterFields skips a path outside the brain', { skip: !CAN_SYMLINK }, () => {
    const victim = path.join(outsideDir, 'victim.md');
    fs.writeFileSync(victim, '---\nid: x\n---\nbody\n');
    fs.symlinkSync(outsideDir, path.join(brainDir, 'esc'));
    setFrontmatterFields(brainDir, path.join('esc', 'victim.md'), { pinned: true });
    assert.ok(!fs.readFileSync(victim, 'utf-8').includes('pinned'), 'wrote through symlinked dir');
  });
});
