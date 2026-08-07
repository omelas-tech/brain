#!/usr/bin/env node

/**
 * brain restore — roll the whole brain back to a previous restore point.
 *
 * Two sources of restore points:
 *   git (default)  Commits in the Git sync history (~/.brain/.sync/repo/) —
 *                  one per push, plus a pre-restore safety snapshot taken
 *                  automatically before every restore.
 *   cloud          Brain Cloud's pre-overwrite snapshots — one is taken
 *                  server-side before every `brain cloud push` commit.
 *
 * Usage:
 *   brain restore --list [--from git|cloud] [--limit N]
 *   brain restore --to <commit|version> [--from git|cloud] [--passphrase <p>]
 *
 * Both sources are undoable: git commits a safety snapshot first; cloud writes
 * a local pre-restore backup under ~/.brain/.cloud/. audit.log is carried
 * forward through every restore, and every restore is itself logged there.
 * Output: JSON.
 */

const fs = require('fs');
const path = require('path');

const { listRestorePoints, restoreTo } = require('../src/git-sync');
const { getBrainDir, readIndex } = require('../src/index-manager');
const { readSearchIndex, writeSearchIndex, rebuildIndex, isSearchIndexStale } = require('../src/tfidf');

function parseArgs(argv) {
  const args = { list: false, to: null, from: 'git', limit: 20, passphrase: null };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--list': args.list = true; break;
      case '--to': args.to = argv[++i]; break;
      case '--from': args.from = argv[++i]; break;
      case '--limit': args.limit = parseInt(argv[++i], 10) || 20; break;
      case '--passphrase': args.passphrase = argv[++i]; break;
      default: break;
    }
  }
  return args;
}

/** Append-only audit trail — same format and mode as memorize's write log. */
function appendAuditLog(brainDir, record) {
  fs.appendFileSync(
    path.join(brainDir, 'audit.log'),
    JSON.stringify(record) + '\n',
    { mode: 0o600 }
  );
}

/**
 * The restored search index normally matches the restored index.json, but
 * rebuild defensively when it drifted (matches recall.js's staleness rule).
 */
function reindexIfStale(brainDir) {
  try {
    const index = readIndex();
    let searchIndex = null;
    try { searchIndex = readSearchIndex(brainDir); } catch { searchIndex = null; }
    if (index && isSearchIndexStale(searchIndex, index)) {
      writeSearchIndex(brainDir, rebuildIndex(brainDir, index));
      return true;
    }
  } catch { /* index unreadable — surfaced by the next recall, not here */ }
  return false;
}

async function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  const brainDir = getBrainDir();

  if (args.from !== 'git' && args.from !== 'cloud') {
    console.error(JSON.stringify({ error: `Unknown source "${args.from}" (expected git or cloud)` }));
    process.exit(1);
  }

  try {
    if (args.list) {
      if (args.from === 'cloud') {
        const cloud = require('../src/cloud-sync');
        const versions = await cloud.listVersions(brainDir);
        console.log(JSON.stringify({ source: 'cloud', restore_points: versions.slice(0, args.limit), total: versions.length }, null, 2));
      } else {
        const points = listRestorePoints(brainDir, args.limit);
        console.log(JSON.stringify({ source: 'git', restore_points: points, total: points.length }, null, 2));
      }
      return;
    }

    if (!args.to) {
      console.error(JSON.stringify({
        error: 'Usage: brain restore --list [--from git|cloud] | brain restore --to <point> [--from git|cloud] [--passphrase <p>]',
      }));
      process.exit(1);
    }

    let result;
    if (args.from === 'cloud') {
      const cloud = require('../src/cloud-sync');
      result = await cloud.restoreVersion(brainDir, args.to);
    } else {
      result = restoreTo(brainDir, args.to, args.passphrase || undefined);
    }

    const reindexed = reindexIfStale(brainDir);

    appendAuditLog(brainDir, {
      ts: new Date().toISOString(),
      event: 'restore',
      source: args.from,
      ...(args.from === 'cloud'
        ? { restored_version: result.restored_version, backup: result.backup }
        : { restored_to: result.restored_to, safety_commit: result.safety_commit, restore_commit: result.restore_commit }),
    });

    console.log(JSON.stringify({ source: args.from, ...result, reindexed }, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, parseArgs };
