#!/usr/bin/env node

/**
 * brain unpin — remove a memory from the always-present semantic tier.
 *
 * Usage:
 *   brain unpin <id>
 */

const { unpinMemory } = require('../src/pinning');

function parseArgs(argv) {
  const args = { id: null };
  for (const a of argv) {
    if (!a.startsWith('--') && !args.id) args.id = a;
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  if (!args.id) {
    console.error(JSON.stringify({ error: 'Usage: brain unpin <id>' }));
    process.exit(1);
  }
  const result = unpinMemory(undefined, args.id);
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
