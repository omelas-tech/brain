/**
 * Brain Memory — Git Sync Engine
 *
 * Push/pull ~/.brain/ memories via any Git remote (GitHub, GitLab, Codeberg, etc.).
 * A hidden git repo lives at ~/.brain/.sync/repo/ — the project's own git history
 * is never touched.
 *
 * Zero external dependencies — uses child_process.execFileSync to call the git binary.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('./crypto');

const SYNC_DIR = '.sync';
const REPO_DIR = 'repo';
const CONFIG_FILE = 'config.json';

// Files/dirs inside ~/.brain/ that should NOT be synced
const EXCLUDED = new Set(['.sync', '.DS_Store']);

/**
 * Check whether `git` is available on PATH.
 *
 * @returns {boolean}
 */
function checkGitAvailable() {
  try {
    execFileSync('git', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a git command inside the sync repo.
 *
 * @param {string} repoDir - Absolute path to ~/.brain/.sync/repo/
 * @param {string[]} args - Git arguments
 * @param {Object} [opts] - Extra execFileSync options
 * @returns {string} stdout (trimmed)
 */
function git(repoDir, args, opts = {}) {
  // Explicitly set GIT_DIR and GIT_WORK_TREE to prevent git from walking up
  // the directory tree and finding the parent project's .git directory.
  // Without this, if ~/.brain/.sync/repo/.git doesn't exist yet (first push or
  // failed init), git operations would silently affect the parent project repo.
  const env = {
    ...process.env,
    GIT_DIR: path.join(repoDir, '.git'),
    GIT_WORK_TREE: repoDir,
  };
  return execFileSync('git', args, {
    cwd: repoDir,
    stdio: 'pipe',
    encoding: 'utf8',
    env,
    ...opts,
  }).trim();
}

/**
 * Resolve paths for sync infrastructure.
 *
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @returns {{ syncDir: string, repoDir: string, configPath: string }}
 */
function resolvePaths(brainDir) {
  const syncDir = path.join(brainDir, SYNC_DIR);
  const repoDir = path.join(syncDir, REPO_DIR);
  const configPath = path.join(syncDir, CONFIG_FILE);
  return { syncDir, repoDir, configPath };
}

/**
 * Initialize a git repo inside ~/.brain/.sync/repo/.
 *
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @returns {{ repoDir: string }} Created repo path
 */
function initSyncRepo(brainDir) {
  const { repoDir } = resolvePaths(brainDir);
  fs.mkdirSync(repoDir, { recursive: true });

  git(repoDir, ['init', '-b', 'main']);
  git(repoDir, ['config', 'user.email', 'brain-memory@local']);
  git(repoDir, ['config', 'user.name', 'Brain Memory']);

  return { repoDir };
}

/**
 * Configure (or update) the remote URL for the sync repo.
 *
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @param {string} remoteUrl - Git remote URL (SSH or HTTPS)
 */
function configureRemote(brainDir, remoteUrl) {
  const { repoDir } = resolvePaths(brainDir);

  try {
    git(repoDir, ['remote', 'get-url', 'origin']);
    // Remote exists — update it
    git(repoDir, ['remote', 'set-url', 'origin', remoteUrl]);
  } catch {
    // Remote doesn't exist — add it
    git(repoDir, ['remote', 'add', 'origin', remoteUrl]);
  }
}

/**
 * Copy ~/.brain/ files into the sync repo, excluding .sync/.
 * If encryption is enabled, files are encrypted before writing.
 *
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @param {string} repoDir - Absolute path to ~/.brain/.sync/repo/
 * @param {string|null} passphrase - Encryption passphrase or null
 */
function copyBrainToRepo(brainDir, repoDir, passphrase) {
  // Clean existing tracked files in repo (except .git)
  const entries = fs.readdirSync(repoDir);
  for (const entry of entries) {
    if (entry === '.git') continue;
    fs.rmSync(path.join(repoDir, entry), { recursive: true, force: true });
  }

  // Recursively copy ~/.brain/ → repo/
  copyDir(brainDir, repoDir, brainDir, passphrase);
}

/**
 * Recursively copy a directory, excluding EXCLUDED entries.
 *
 * @param {string} srcDir - Source directory
 * @param {string} destDir - Destination directory
 * @param {string} brainDir - Root brain dir (for relative path calculation)
 * @param {string|null} passphrase - Encryption passphrase or null
 */
function copyDir(srcDir, destDir, brainDir, passphrase) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = path.relative(brainDir, path.join(srcDir, entry.name));
    const topLevel = rel.split(path.sep)[0];
    if (EXCLUDED.has(topLevel)) continue;

    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath, brainDir, passphrase);
    } else {
      const content = fs.readFileSync(srcPath);
      if (passphrase) {
        fs.writeFileSync(destPath, encrypt(content.toString('utf8'), passphrase));
      } else {
        fs.writeFileSync(destPath, content);
      }
    }
  }
}

/**
 * Copy files from the sync repo back into ~/.brain/.
 * If encryption is enabled, files are decrypted after reading.
 *
 * @param {string} repoDir - Absolute path to ~/.brain/.sync/repo/
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @param {string|null} passphrase - Decryption passphrase or null
 */
function copyRepoToBrain(repoDir, brainDir, passphrase) {
  copyRepoDir(repoDir, brainDir, repoDir, passphrase);
}

/**
 * Recursively copy repo files back to brain.
 */
function copyRepoDir(srcDir, destDir, repoDir, passphrase) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git') continue;

    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyRepoDir(srcPath, destPath, repoDir, passphrase);
    } else {
      const content = fs.readFileSync(srcPath);
      if (passphrase) {
        fs.writeFileSync(destPath, decrypt(content, passphrase));
      } else {
        fs.writeFileSync(destPath, content);
      }
    }
  }
}

/**
 * Get a summary of local vs remote sync status.
 *
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @returns {{ configured: boolean, remote: string|null, branch: string|null, ahead: number, behind: number, lastPush: string|null }}
 */
function getStatus(brainDir) {
  const { repoDir, configPath } = resolvePaths(brainDir);
  const config = readConfig(configPath);

  if (!config) {
    return { configured: false, remote: null, branch: null, ahead: 0, behind: 0, lastPush: null };
  }

  let ahead = 0;
  let behind = 0;

  if (fs.existsSync(path.join(repoDir, '.git'))) {
    try {
      git(repoDir, ['fetch', 'origin'], { timeout: 15000 });
    } catch {
      // Offline or remote not reachable — use cached state
    }

    try {
      const counts = git(repoDir, ['rev-list', '--left-right', '--count', 'main...origin/main']);
      const parts = counts.split(/\s+/);
      ahead = parseInt(parts[0], 10) || 0;
      behind = parseInt(parts[1], 10) || 0;
    } catch {
      // No remote tracking yet (first push not done)
    }
  }

  return {
    configured: true,
    remote: config.remote || null,
    branch: config.branch || 'main',
    ahead,
    behind,
    lastPush: config.lastPush || null,
  };
}

/**
 * Push ~/.brain/ contents to the remote.
 *
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @param {string} [message] - Commit message (defaults to timestamp)
 * @param {string} [passphrase] - Encryption passphrase (if configured)
 * @returns {{ committed: boolean, pushed: boolean, message: string }}
 */
function push(brainDir, message, passphrase) {
  const { repoDir, configPath } = resolvePaths(brainDir);
  const config = readConfig(configPath);
  if (!config) throw new Error('Sync not configured. Run /brain:sync setup first.');

  const pass = config.encrypt ? passphrase : null;
  if (config.encrypt && !passphrase) {
    throw new Error('Encryption is enabled but no passphrase provided.');
  }

  // Ensure repo exists
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    initSyncRepo(brainDir);
    if (config.remote) configureRemote(brainDir, config.remote);
  }

  // Copy brain files into repo
  copyBrainToRepo(brainDir, repoDir, pass);

  // Stage all changes
  git(repoDir, ['add', '-A']);

  // Check if there's anything to commit
  const status = git(repoDir, ['status', '--porcelain']);
  if (!status) {
    return { committed: false, pushed: false, message: 'Nothing to push — no changes.' };
  }

  // Commit
  const commitMsg = message || `brain sync ${new Date().toISOString()}`;
  git(repoDir, ['commit', '-m', commitMsg]);

  // Push
  let pushed = false;
  if (config.remote) {
    try {
      git(repoDir, ['push', '-u', 'origin', 'main'], { timeout: 30000 });
      pushed = true;
    } catch (err) {
      return { committed: true, pushed: false, message: `Committed locally but push failed: ${err.message}` };
    }
  }

  // Update lastPush
  config.lastPush = new Date().toISOString();
  writeConfig(configPath, config);

  return { committed: true, pushed, message: `Pushed successfully at ${config.lastPush}` };
}

/**
 * Pull remote changes into ~/.brain/.
 *
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @param {string} [passphrase] - Decryption passphrase (if configured)
 * @returns {{ pulled: boolean, message: string }}
 */
function pull(brainDir, passphrase) {
  const { repoDir, configPath } = resolvePaths(brainDir);
  const config = readConfig(configPath);
  if (!config) throw new Error('Sync not configured. Run /brain:sync setup first.');

  const pass = config.encrypt ? passphrase : null;
  if (config.encrypt && !passphrase) {
    throw new Error('Encryption is enabled but no passphrase provided.');
  }

  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    initSyncRepo(brainDir);
    if (config.remote) configureRemote(brainDir, config.remote);
  }

  // Try fast-forward pull first
  let pulled = false;
  let hasConflicts = false;
  let conflictFiles = [];

  try {
    git(repoDir, ['pull', 'origin', 'main', '--ff-only'], { timeout: 30000 });
    pulled = true;
  } catch (err) {
    // Fast-forward failed — try fetch + merge
    try {
      git(repoDir, ['fetch', 'origin'], { timeout: 15000 });
    } catch {
      return { pulled: false, hasConflicts: false, message: 'Remote is unreachable.' };
    }

    try {
      git(repoDir, ['merge', 'origin/main']);
      pulled = true;
    } catch {
      // Check for unmerged paths
      try {
        const status = git(repoDir, ['status', '--porcelain']);
        conflictFiles = status
          .split('\n')
          .filter((line) => line.startsWith('U') || line.startsWith('AA') || line.startsWith('DD'))
          .map((line) => line.slice(3));
        hasConflicts = conflictFiles.length > 0;
      } catch { /* ignore status errors */ }

      // Abort the failed merge to leave repo clean
      try {
        git(repoDir, ['merge', '--abort']);
      } catch { /* ignore if nothing to abort */ }

      if (hasConflicts) {
        return {
          pulled: false,
          hasConflicts: true,
          conflictFiles,
          message: `Merge conflict in ${conflictFiles.length} file(s). Push your local changes first or manually resolve.`,
        };
      }

      return { pulled: false, hasConflicts: false, message: 'Remote has no commits yet or merge failed.' };
    }
  }

  // Copy repo files back to brain
  copyRepoToBrain(repoDir, brainDir, pass);

  // Update config
  config.lastPull = new Date().toISOString();
  writeConfig(configPath, config);

  return { pulled: true, hasConflicts: false, message: `Pulled successfully at ${config.lastPull}` };
}

/**
 * List restore points — the commits in the sync repo's history, newest first.
 *
 * A restore point exists for every push (and every pre-restore safety
 * snapshot), so granularity follows how often the brain is pushed.
 *
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @param {number} [limit=20] - Maximum entries to return
 * @returns {Array<{ commit: string, date: string, message: string }>}
 */
function listRestorePoints(brainDir, limit = 20) {
  const { repoDir, configPath } = resolvePaths(brainDir);
  const config = readConfig(configPath);
  if (!config) throw new Error('Sync not configured. Run /brain:sync setup first.');
  if (!fs.existsSync(path.join(repoDir, '.git'))) return [];

  let out;
  try {
    out = git(repoDir, ['log', '--pretty=format:%H%x09%cI%x09%s', '-n', String(limit)]);
  } catch {
    return []; // repo initialized but no commits yet
  }
  if (!out) return [];
  return out.split('\n').map((line) => {
    const [commit, date, ...subject] = line.split('\t');
    return { commit, date, message: subject.join('\t') };
  });
}

/**
 * Remove everything inside ~/.brain/ except the excluded infrastructure
 * entries (.sync/), so a restore can't leave orphaned post-snapshot files
 * behind. Only called after the current state is committed to sync history.
 */
function clearBrainDir(brainDir) {
  for (const entry of fs.readdirSync(brainDir)) {
    if (EXCLUDED.has(entry)) continue;
    fs.rmSync(path.join(brainDir, entry), { recursive: true, force: true });
  }
}

/**
 * Restore ~/.brain/ to a previous restore point.
 *
 * History only moves forward: the current brain state is first committed as a
 * pre-restore safety snapshot (when it differs from HEAD), then the target
 * tree is materialized as a NEW commit on main — so the restore itself is
 * always undoable via another restore.
 *
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @param {string} ref - Commit hash (or any git ref) to restore to
 * @param {string} [passphrase] - Encryption passphrase (if configured)
 * @returns {{ restored_to: string, safety_commit: string|null, restore_commit: string }}
 */
function restoreTo(brainDir, ref, passphrase) {
  const { repoDir, configPath } = resolvePaths(brainDir);
  const config = readConfig(configPath);
  if (!config) throw new Error('Sync not configured. Run /brain:sync setup first.');

  const pass = config.encrypt ? passphrase : null;
  if (config.encrypt && !passphrase) {
    throw new Error('Encryption is enabled but no passphrase provided.');
  }
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    throw new Error('No sync history yet — push at least once before restoring.');
  }

  // Validate the ref up front (also resolves short hashes / dates via git).
  let target;
  try {
    target = git(repoDir, ['rev-parse', '--verify', `${ref}^{commit}`]);
  } catch {
    throw new Error(`Unknown restore point "${ref}". Use --list to see available points.`);
  }

  // Safety snapshot: commit the CURRENT brain state before touching anything,
  // so even unsynced work survives the restore in history.
  copyBrainToRepo(brainDir, repoDir, pass);
  git(repoDir, ['add', '-A']);
  let safetyCommit = null;
  if (git(repoDir, ['status', '--porcelain'])) {
    git(repoDir, ['commit', '-m', `pre-restore snapshot ${new Date().toISOString()}`]);
    safetyCommit = git(repoDir, ['rev-parse', 'HEAD']);
  }

  // Materialize the target tree in the worktree and commit it forward.
  // Wipe first so files absent in the target don't survive, then let
  // `git add -A` stage those deletions alongside the checked-out content.
  for (const entry of fs.readdirSync(repoDir)) {
    if (entry === '.git') continue;
    fs.rmSync(path.join(repoDir, entry), { recursive: true, force: true });
  }
  git(repoDir, ['checkout', target, '--', '.']);
  git(repoDir, ['add', '-A']);
  if (git(repoDir, ['status', '--porcelain'])) {
    git(repoDir, ['commit', '-m', `restore to ${target.slice(0, 12)}`]);
  }
  const restoreCommit = git(repoDir, ['rev-parse', 'HEAD']);

  // Only now mutate the live brain — the snapshot above makes this recoverable.
  // audit.log is deliberately carried across the swap: the append-only trail
  // must record history *through* a restore, not be rolled back by one.
  const auditPath = path.join(brainDir, 'audit.log');
  let auditTrail = null;
  try { auditTrail = fs.readFileSync(auditPath); } catch { auditTrail = null; }

  clearBrainDir(brainDir);
  copyRepoToBrain(repoDir, brainDir, pass);
  if (auditTrail !== null) fs.writeFileSync(auditPath, auditTrail, { mode: 0o600 });

  return { restored_to: target, safety_commit: safetyCommit, restore_commit: restoreCommit };
}

/**
 * Read sync config from ~/.brain/.sync/config.json.
 *
 * @param {string} configPath - Absolute path to config.json
 * @returns {Object|null}
 */
function readConfig(configPath) {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Write sync config to ~/.brain/.sync/config.json.
 *
 * @param {string} configPath - Absolute path to config.json
 * @param {Object} config
 */
function writeConfig(configPath, config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Read the sync config for a brain directory.
 *
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @returns {Object|null}
 */
function getSyncConfig(brainDir) {
  const { configPath } = resolvePaths(brainDir);
  return readConfig(configPath);
}

/**
 * Write the sync config for a brain directory.
 *
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @param {Object} config
 */
function writeSyncConfig(brainDir, config) {
  const { configPath } = resolvePaths(brainDir);
  writeConfig(configPath, config);
}

module.exports = {
  checkGitAvailable,
  initSyncRepo,
  configureRemote,
  getStatus,
  push,
  pull,
  listRestorePoints,
  restoreTo,
  getSyncConfig,
  writeSyncConfig,
  // Internal — exported for testing
  copyBrainToRepo,
  copyRepoToBrain,
  resolvePaths,
};
