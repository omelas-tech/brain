#!/usr/bin/env node

/**
 * brain import — cold-start a brain from transcripts your agents already wrote.
 *
 * Emits a deterministic, budget-bounded digest of past sessions. The agent reads
 * that digest and writes memories through the ordinary `brain memorize` path, so
 * imported memories go through the same provenance gate, scoring, and index as
 * anything else. Nothing here writes a memory.
 *
 * Usage:
 *   brain import [--source claude-code|codex] [--project P] [--since ISO] [--limit N] [--all]
 *   brain import --sources                 List detected history stores
 *   brain import --mark <id> [<id>...]     Record sessions as imported
 *
 * The `--mark` step is what makes import incremental: the agent calls it after a
 * successful memorize so the next run offers only new sessions.
 */

const fs = require('fs');
const path = require('path');

const { getBrainDir } = require('../src/index-manager');
const { harvest, availableSources, markImported } = require('../src/harvest');

function parseArgs(argv) {
  const args = {
    source: 'claude-code',
    project: null,
    since: null,
    limit: null,
    all: false,
    sources: false,
    mark: [],
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--source': args.source = argv[++i]; break;
      case '--project': args.project = argv[++i]; break;
      case '--since': args.since = argv[++i]; break;
      case '--limit': args.limit = parseInt(argv[++i], 10) || null; break;
      case '--all': args.all = true; break;
      case '--sources': args.sources = true; break;
      case '--mark':
        // Consume every following non-flag token as a session id.
        while (argv[i + 1] && !argv[i + 1].startsWith('--')) args.mark.push(argv[++i]);
        break;
      default: break;
    }
  }
  return args;
}

/**
 * Normalize `--since` into an ISO timestamp.
 *
 * Accepts a relative shorthand (`30d`, `6m`, `1y`) as well as any date string
 * Date can parse, because "the last month of work" is the natural way to scope
 * an import and computing that date by hand is friction.
 */
function normalizeSince(value) {
  if (!value) return null;
  const relative = /^(\d+)([dmy])$/i.exec(value.trim());
  if (relative) {
    const amount = parseInt(relative[1], 10);
    const date = new Date();
    if (relative[2].toLowerCase() === 'd') date.setDate(date.getDate() - amount);
    if (relative[2].toLowerCase() === 'm') date.setMonth(date.getMonth() - amount);
    if (relative[2].toLowerCase() === 'y') date.setFullYear(date.getFullYear() - amount);
    return date.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.sources) {
    console.log(JSON.stringify({ sources: availableSources() }, null, 2));
    return;
  }

  // A brain must exist before we offer to fill it — otherwise the agent gets a
  // digest it has nowhere to write.
  const brainDir = getBrainDir();
  if (!fs.existsSync(path.join(brainDir, 'index.json'))) {
    console.error(JSON.stringify({ error: 'Brain not initialized. Run `brain install` first.' }));
    process.exit(1);
  }

  if (args.mark.length > 0) {
    const result = markImported(args.source, args.mark);
    console.log(JSON.stringify({
      marked: args.mark.length - result.unknown.length,
      ...result,
      source: args.source,
      ...(result.unknown.length
        ? { warning: `${result.unknown.length} id(s) matched no ${args.source} session and were not recorded — check for a truncated or mistyped session id.` }
        : {}),
    }, null, 2));
    // A partial mark is a real failure: the caller believes those sessions are
    // done, and nothing else will ever tell them otherwise.
    if (result.unknown.length > 0) process.exit(1);
    return;
  }

  if (args.since && !normalizeSince(args.since)) {
    console.error(JSON.stringify({ error: `Could not parse --since "${args.since}" (try 30d, 6m, or 2026-01-01)` }));
    process.exit(1);
  }

  const digest = harvest({
    source: args.source,
    project: args.project,
    since: normalizeSince(args.since),
    limit: args.limit,
    all: args.all,
  });

  if (digest.error) {
    console.error(JSON.stringify({ error: digest.error }));
    process.exit(1);
  }

  console.log(JSON.stringify(digest, null, 2));
}

if (require.main === module) main();

module.exports = { main, parseArgs, normalizeSince };
