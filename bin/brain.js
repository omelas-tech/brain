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
};

// install.js finds its positional subcommand from process.argv itself, so it is
// required without stripping anything. Bare `brain` also routes here, preserving
// `npx brain-memory` via npm's single-bin fallback.
const INSTALLER = new Set(['install', 'update', 'uninstall']);

const HELP = `🧠 brain — Brain Memory CLI

Usage: brain <command> [options]

Memory
  recall "<query>" [--project P] [--task T] [--top N]
                              Deterministic recall (TF-IDF + decay + spreading)
  recall --context            Session-start recall from project context
  recall --reindex            Rebuild the search index
  memorize [--sync]           Store memories from a JSON payload on stdin
  reinforce <id> [<id>...]    Spaced reinforcement + Hebbian co-retrieval

Sync
  cloud <login|logout|push|pull|status>

Setup
  install                     Interactive installer (default when no command)
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

  // Bare `brain` or an installer subcommand → run the installer.
  if (sub === undefined || INSTALLER.has(sub)) {
    require(path.join(__dirname, 'install.js'));
    return;
  }

  const file = DELEGATED[sub];
  if (file) {
    process.argv.splice(2, 1); // drop the subcommand token
    require(path.join(__dirname, file));
    return;
  }

  console.error(`Unknown command: ${sub}\n`);
  console.error(HELP);
  process.exit(1);
}

main();
