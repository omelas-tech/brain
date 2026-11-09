#!/usr/bin/env node

/**
 * brain supersede — bound an existing memory by an existing successor.
 *
 * Usage:
 *   brain supersede <old_id> [<old_id>...] --by <new_id> [--valid-until ISO] [--dry-run]
 *
 * `memorize --supersedes` only works at write time, so a contradiction noticed
 * later — during sleep, during recall, or in an audit — had no way to be
 * resolved short of writing a duplicate of the newer fact. This links two
 * memories that already exist: the old one gets `superseded_by` and a
 * `valid_until` (default: the successor's valid_from / created), the successor
 * records `supersedes`, and a manual association edge joins them. Nothing is
 * deleted — recall demotes the old fact and still answers "that was true until
 * <date>".
 *
 * Deciding that B ended A is a judgement call, so this is an explicit command
 * the agent runs after confirming with the user (or during a user-approved
 * sleep pass) — never something recall does on its own.
 */

const {
  readIndex,
  writeIndex,
  readAssociations,
  writeAssociations,
  reinforceEdge,
  getBrainDir,
} = require('../src/index-manager');
const { applySupersession, supersessionInstant, parseInstant } = require('../src/temporal');
const { setFrontmatterFields } = require('../src/pinning');
const { appendAudit } = require('../src/audit');

function parseArgs(argv) {
  const args = { olds: [], by: null, validUntil: undefined, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--by') args.by = argv[++i];
    else if (a === '--valid-until') args.validUntil = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (!a.startsWith('--')) args.olds.push(a);
  }
  return args;
}

function fail(msg) {
  console.error(JSON.stringify({ error: msg }));
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.by || !args.olds.length) {
    fail('Usage: brain supersede <old_id> [<old_id>...] --by <new_id> [--valid-until ISO] [--dry-run]');
  }

  const brainDir = getBrainDir();
  const index = readIndex();
  if (!index) fail('Brain not initialized.');
  const successor = index.memories[args.by];
  if (!successor) fail(`Unknown successor id: ${args.by}`);

  let validUntil = supersessionInstant(successor);
  if (args.validUntil !== undefined) {
    const t = parseInstant(args.validUntil);
    if (t == null) fail(`Invalid --valid-until: ${args.validUntil}`);
    validUntil = new Date(t).toISOString();
  }

  const skipped = [];
  const targets = [];
  for (const id of new Set(args.olds)) {
    const entry = index.memories[id];
    if (!entry) skipped.push({ id, reason: 'unknown id' });
    else if (id === args.by) skipped.push({ id, reason: 'cannot supersede itself' });
    else if (successor.superseded_by === id) skipped.push({ id, reason: 'would form a cycle' });
    else targets.push(id);
  }

  if (args.dryRun) {
    console.log(JSON.stringify({
      dry_run: true,
      successor: { id: args.by, title: successor.title },
      would_supersede: targets.map((id) => ({ id, title: index.memories[id].title, valid_until: index.memories[id].valid_until || validUntil })),
      skipped,
    }, null, 2));
    return;
  }

  const applied = applySupersession(brainDir, index, args.by, targets, { validUntil });

  if (applied.length) {
    const list = [...new Set([...(successor.supersedes || []), ...applied.map((a) => a.id)])];
    successor.supersedes = list;
    setFrontmatterFields(brainDir, successor.path, {
      supersedes: `[${list.map((s) => `"${s}"`).join(', ')}]`,
    }, { raw: ['supersedes'] });
    writeIndex(index);

    const associations = readAssociations() || { version: 1, edges: {} };
    for (const a of applied) reinforceEdge(associations, args.by, a.id, 'manual', 0.20);
    writeAssociations(associations);

    appendAudit(brainDir, {
      ts: new Date().toISOString(),
      event: 'supersede',
      id: args.by,
      superseded: applied.map((a) => a.id),
      valid_until: validUntil,
    });
  }

  console.log(JSON.stringify({
    successor: { id: args.by, title: successor.title },
    superseded: applied.map((a) => ({ ...a, valid_until: index.memories[a.id].valid_until })),
    skipped,
  }, null, 2));
}

main();
