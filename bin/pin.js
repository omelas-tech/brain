#!/usr/bin/env node

/**
 * brain pin — pin a memory into the always-present semantic tier (CoALA Phase 1).
 *
 * Usage:
 *   brain pin <id> [--scope global|project:<name>] [--priority N]
 */

const { pinMemory } = require('../src/pinning');

function parseArgs(argv) {
  const args = { id: null, scope: 'global', priority: 0 };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--scope': args.scope = argv[++i]; break;
      case '--priority': args.priority = parseInt(argv[++i], 10) || 0; break;
      default:
        if (!argv[i].startsWith('--') && !args.id) args.id = argv[i];
        break;
    }
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  if (!args.id) {
    console.error(JSON.stringify({ error: 'Usage: brain pin <id> [--scope global|project:<name>] [--priority N]' }));
    process.exit(1);
  }
  const result = pinMemory(undefined, args.id, { scope: args.scope, priority: args.priority });
  if (result.error) {
    console.error(JSON.stringify(result));
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, parseArgs };
