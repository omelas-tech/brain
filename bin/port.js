#!/usr/bin/env node

/**
 * brain port — move memories between brain and other memory systems.
 *
 * Usage:
 *   brain port export --format <claude-memory|markdown|agentcore> [--out PATH]
 *   brain port import --from <claude-memory|markdown|agentcore> <PATH> [--trust] [--dry-run]
 *
 * Export writes only what recall could show: memories pending verification,
 * consent-hidden sensitive memories and expired ones are left out, and counted.
 * `claude-memory` needs --out (a directory); the others print to stdout
 * unless --out names a file.
 *
 * Import sends every memory through `brain memorize`, so the origin policy,
 * lint and quarantine apply. Imported memories are `external` — pending
 * verification until approved — unless --trust marks them as the user's own
 * (`origin: user`), which is right only for an export of the user's own memory.
 * --dry-run prints the memorize payload instead of writing it.
 *
 * Output: JSON. Honors BRAIN_DIR.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { getBrainDir, readIndex, readConfig } = require('../src/index-manager');
const { ADAPTERS, FIDELITY } = require('../src/adapters');
const { isSensitiveHidden } = require('../src/sensitivity');
const { temporalState } = require('../src/temporal');

function fail(message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
}

function parseArgs(argv) {
  const args = { action: argv[0], format: null, from: null, out: null, path: null, trust: false, dryRun: false };
  for (let i = 1; i < argv.length; i++) {
    switch (argv[i]) {
      case '--format': args.format = argv[++i]; break;
      case '--from': args.from = argv[++i]; break;
      case '--out': args.out = argv[++i]; break;
      case '--trust': args.trust = true; break;
      case '--dry-run': args.dryRun = true; break;
      default: if (!argv[i].startsWith('--')) args.path = argv[i];
    }
  }
  return args;
}

function stripFrontmatter(text) {
  return String(text).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

/** Memories recall could show, plus counts of what was left out and why. */
function loadExportable(brainDir) {
  const index = readIndex();
  if (!index) fail('Brain not initialized.');
  const config = readConfig();
  const now = Date.now();
  const memories = [];
  const skipped = { pending_verification: 0, sensitive_hidden: 0, expired: 0, unreadable: 0 };
  for (const [id, entry] of Object.entries(index.memories || {})) {
    if (entry.quarantined) { skipped.pending_verification++; continue; }
    if (isSensitiveHidden(entry, config)) { skipped.sensitive_hidden++; continue; }
    if (temporalState(entry, now) === 'expired') { skipped.expired++; continue; }
    let content;
    try {
      content = stripFrontmatter(fs.readFileSync(path.join(brainDir, entry.path), 'utf-8'));
    } catch (_) {
      skipped.unreadable++;
      continue;
    }
    memories.push({ id, title: entry.title, type: entry.type, content, tags: entry.tags || [], created: entry.created, origin: entry.origin });
  }
  return { memories, skipped };
}

function doExport(args, brainDir) {
  const adapter = ADAPTERS[args.format];
  if (!adapter) fail(`--format must be one of: ${Object.keys(ADAPTERS).join(', ')}`);
  const { memories, skipped } = loadExportable(brainDir);
  const result = adapter.exportTo(memories);
  const summary = { format: args.format, exported: memories.length, skipped, fidelity: FIDELITY[args.format] };

  if (result.files) {
    if (!args.out) fail('--out <directory> is required for claude-memory');
    fs.mkdirSync(args.out, { recursive: true });
    for (const [rel, text] of Object.entries(result.files)) fs.writeFileSync(path.join(args.out, rel), text);
    console.log(JSON.stringify({ ...summary, out: args.out, files: Object.keys(result.files).length }, null, 2));
    return;
  }
  const body = result.text != null ? result.text : JSON.stringify({ batches: result.batches }, null, 2) + '\n';
  if (result.truncated) summary.truncated = result.truncated;
  if (args.out) {
    fs.writeFileSync(args.out, body);
    console.log(JSON.stringify({ ...summary, out: args.out }, null, 2));
  } else {
    process.stdout.write(body);
    console.error(JSON.stringify(summary));
  }
}

function readInput(adapter, p) {
  if (adapter.input === 'dir') {
    if (!fs.statSync(p).isDirectory()) fail(`${p} is not a directory`);
    const files = {};
    for (const name of fs.readdirSync(p)) {
      const full = path.join(p, name);
      if (name.endsWith('.md') && fs.statSync(full).isFile()) files[name] = fs.readFileSync(full, 'utf-8');
    }
    return files;
  }
  const text = fs.readFileSync(p, 'utf-8');
  return adapter.input === 'json' ? JSON.parse(text) : text;
}

function doImport(args, brainDir) {
  const adapter = ADAPTERS[args.from];
  if (!adapter) fail(`--from must be one of: ${Object.keys(ADAPTERS).join(', ')}`);
  if (!args.path || !fs.existsSync(args.path)) fail('Usage: brain port import --from <format> <path>');

  const origin = args.trust ? 'user' : 'external';
  const seen = new Set();
  const memories = adapter.importFrom(readInput(adapter, args.path)).map((m) => {
    let base = `imported/${args.from}/${m.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'memory'}`;
    let p = `${base}.md`;
    for (let i = 2; seen.has(p); i++) p = `${base}-${i}.md`;
    seen.add(p);
    const { saved, ...mem } = m;
    return {
      ...mem,
      cognitive_type: 'semantic',
      path: p,
      origin,
      source: `brain port import --from ${args.from}${saved ? ` (saved ${saved})` : ''}`,
      encoding_context: { project: '', topics: [], task_type: 'importing' },
    };
  });

  if (args.dryRun || memories.length === 0) {
    console.log(JSON.stringify({ from: args.from, origin, would_import: memories.length, memories }, null, 2));
    return;
  }
  const out = execFileSync(process.execPath, [path.join(__dirname, 'memorize.js')], {
    input: JSON.stringify({ memories }),
    env: { ...process.env, BRAIN_DIR: brainDir },
    encoding: 'utf-8',
  });
  const stored = (JSON.parse(out).stored || []);
  console.log(JSON.stringify({
    from: args.from,
    origin,
    imported: stored.length,
    pending_verification: stored.filter((s) => s.quarantine_pending).length,
    ids: stored.map((s) => s.id),
    ...(origin === 'external' ? { next: 'review with `brain verify list`, then approve the ones you want' } : {}),
  }, null, 2));
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  const brainDir = getBrainDir();
  if (!fs.existsSync(path.join(brainDir, 'index.json'))) fail('Brain not initialized.');
  if (args.action === 'export') return doExport(args, brainDir);
  if (args.action === 'import') return doImport(args, brainDir);
  fail('Usage: brain port export --format <f> [--out P] | brain port import --from <f> <path> [--trust] [--dry-run]');
}

if (require.main === module) main();

module.exports = { main, parseArgs, loadExportable };
