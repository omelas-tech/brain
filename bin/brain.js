#!/usr/bin/env node

/**
 * brain — unified CLI dispatcher for the Brain Memory system.
 *
 * Routes subcommands to their implementations, replacing the former per-binary
 * surface (brain-recall, brain-reinforce, brain-memorize, brain-cloud). Each
 * delegate module still runs on load and remains invokable as `node bin/<file>`,
 * so direct invocation and the existing test suite are unaffected.
 *
 * Usage:
 *   brain                            Interactive installer (also: brain install)
 *   brain install|update|uninstall [flags]
 *   brain --claude --global          Installer flags alone also install (non-interactive)
 *   brain recall "<query>" [--project P] [--task T] [--top N] [--context] [--reindex]
 *   brain memorize [--sync]          Store memories from a JSON payload on stdin
 *   brain reinforce <id> [<id>...]   Spaced reinforcement + Hebbian co-retrieval
 *   brain cloud <login|logout|push|pull|status>
 *   brain --help | brain --version
 */

const path = require('path');

const VERSION = require('../package.json').version;

// Subcommands whose modules read process.argv.slice(2) directly. We strip the
// leading subcommand token, then require the module (which executes on load).
const DELEGATED = {
  recall: 'recall.js',
  reinforce: 'reinforce.js',
  memorize: 'memorize.js',
  cloud: 'cloud-sync.js',
  'session-start': 'session-start.js',
  pin: 'pin.js',
  unpin: 'unpin.js',
  skill: 'skill.js',
  import: 'import.js',
  restore: 'restore.js',
  verify: 'verify.js',
  audit: 'audit.js',
};

// install.js finds its positional subcommand from process.argv itself, so it is
// required without stripping anything. Bare `brain` also routes here, preserving
// `npx brain-memory` via npm's single-bin fallback.
const INSTALLER = new Set(['install', 'update', 'uninstall']);

// The documented non-interactive form has no subcommand at all —
// `brain --claude --global` — a holdover from the old `brain-memory` binary that
// install.js's own arg parser still accepts. An explicit list rather than "any
// --flag", so a typo like `--verison` still gets the unknown-command help.
const INSTALLER_FLAGS = new Set([
  '--claude', '--codex', '--openai', '--opencode', '--antigravity', '--copilot', '--kilo', '--all',
  '--global', '--local', '--update', '--uninstall', '--yes', '--y',
]);

const HELP = `◉ brain — Brain Memory CLI

Usage: brain <command> [options]

Memory
  recall "<query>" [--project P] [--task T] [--top N]
                              Deterministic recall (TF-IDF + decay + spreading)
  recall --context            Session-start recall from project context
  recall --reindex            Rebuild the search index
  memorize [--sync]           Store memories from a JSON payload on stdin
  reinforce <id> [<id>...]    Spaced reinforcement + Hebbian co-retrieval
  pin <id> [--scope global|project:<name>] [--priority N]
                              Pin a memory into the always-present tier
  unpin <id>                  Remove a memory from the always-present tier
  skill <list|show|use|add|remove|export>
                              Manage procedural skills (progressive disclosure)
  session-start [--project P] [--task T] [--top N]
                              Budget-bounded startup payload (agent-invoked)

Trust
  verify <list|show|approve|reject|requeue>
                              Quarantine workflow for unverified writes
  audit [--window 24h|7d] [--apply]
                              Anomalous-write scan over audit.log

Cold start
  import [--source S] [--project P] [--since 30d] [--limit N] [--all]
                              Digest past agent transcripts into import candidates
  import --sources            List detected agent history stores
  import --mark <id> [<id>...]
                              Record sessions as imported (incremental cursor)

Sync
  cloud <login|logout|push|pull|status>
  restore --list [--from git|cloud]
                              List restore points (Git history or Cloud snapshots)
  restore --to <point> [--from git|cloud]
                              Roll the whole brain back to a restore point

Setup
  install                     Interactive installer (default when no command)
  install --claude --global [--yes]
                              Non-interactive: name the runtime(s) and scope
                              (--codex --opencode --copilot --kilo --antigravity --all;
                              \`install\` may be omitted)
  update                      Update an existing installation
  uninstall [--delete-data]   Remove the installation

Other
  --help, -h                  Show this help
  --version, -v               Show version
`;

function main() {
  const sub = process.argv[2];

  if (sub === '--version' || sub === '-v') {
    console.log(VERSION);
    return;
  }

  if (sub === '--help' || sub === '-h' || sub === 'help') {
    console.log(HELP);
    return;
  }

  // Bare `brain`, an installer subcommand, or installer flags alone → run the installer.
  if (sub === undefined || INSTALLER.has(sub) || INSTALLER_FLAGS.has(sub)) {
    require(path.join(__dirname, 'install.js'));
    return;
  }

  const file = DELEGATED[sub];
  if (file) {
    process.argv.splice(2, 1); // drop the subcommand token
    const mod = require(path.join(__dirname, file));
    // Modules guarded with `require.main === module` (e.g. session-start) export
    // a main() that we must invoke; legacy modules already ran on require.
    if (mod && typeof mod.main === 'function') {
      mod.main(process.argv.slice(2));
    }
    return;
  }

  console.error(`Unknown command: ${sub}\n`);
  console.error(HELP);
  process.exit(1);
}

main();
