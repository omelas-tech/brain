#!/usr/bin/env node

/**
 * brain audit — anomalous-write scan over audit.log + index + associations.
 *
 * The deterministic forensics pass (OWASP ASI06): finds write bursts,
 * co-tagged low-trust cliques, and quietly-reinforced low-trust memories,
 * and can quarantine what it finds. Run standalone or as sleep Phase 0
 * (the agent runs it and internalizes the JSON, session-start style).
 *
 * Usage:
 *   brain audit [--window 24h|7d] [--apply] [--max-apply N]
 *
 * --apply flags at most N (default 20) proposed memories per run — an audit
 * can propose broadly but never mass-quarantine; `truncated: true` reports
 * the cut. Every applied flag is itself audited (event: audit_quarantine).
 *
 * Output: JSON. Honors BRAIN_DIR.
 */

const fs = require('fs');
const path = require('path');

const { getBrainDir, readIndex, writeIndex, readAssociations } = require('../src/index-manager');
const { appendAudit } = require('../src/audit');
const { runAudit } = require('../src/anomaly');

/** Parse "24h" / "7d" / bare hours into hours. */
function parseWindow(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d+)(h|d)?$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return m[2] === 'd' ? n * 24 : n;
}

function parseArgs(argv) {
  const args = { windowHours: 24, apply: false, maxApply: 20 };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--window': {
        const parsed = parseWindow(argv[++i]);
        if (parsed) args.windowHours = parsed;
        break;
      }
      case '--apply': args.apply = true; break;
      case '--max-apply': args.maxApply = parseInt(argv[++i], 10) || 20; break;
      default: break;
    }
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  const brainDir = getBrainDir();

  if (!fs.existsSync(path.join(brainDir, 'index.json'))) {
    console.error(JSON.stringify({ error: 'Brain not initialized.' }));
    process.exit(1);
  }

  let index;
  try {
    index = readIndex();
  } catch (err) {
    console.error(JSON.stringify({
      error: `Corrupt index.json in ~/.brain/ — ${err.message}. Fix the JSON manually or restore from sync/backup.`,
    }));
    process.exit(1);
  }

  let associations;
  try {
    associations = readAssociations() || { version: 1, edges: {} };
  } catch (_) {
    associations = { version: 1, edges: {} };
  }

  const result = runAudit(
    brainDir,
    { index, associations, appendAudit, writeIndex },
    { windowHours: args.windowHours, apply: args.apply, maxApply: args.maxApply }
  );

  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, parseArgs, parseWindow };
