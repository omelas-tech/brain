#!/usr/bin/env node

/**
 * Brain Memory — Deterministic Reinforcement Engine
 *
 * Applies spaced reinforcement and Hebbian co-retrieval strengthening
 * to recalled memories. The agent calls this after presenting recall
 * results instead of manually updating frontmatter.
 *
 * Usage:
 *   brain reinforce mem_123 mem_456 mem_789
 *   brain reinforce mem_123 --project my-app
 *
 * Effects:
 *   - Spaced reinforcement boost to each memory's strength
 *   - Decay rate improvement (more forgetting-resistant)
 *   - access_count++, last_accessed = now
 *   - recall_history entry (timestamp + interval + strength delta), capped
 *   - Hebbian co-retrieval: strengthens association edges between all pairs
 *   - Updates index.json, associations.json, and memory files
 */

const { envSession, recordUsed } = require('../src/surfaced');
const { getBrainDir } = require('../src/index-manager');
const { reinforceMemories } = require('../src/reinforce');

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.memoryIds.length === 0) {
    console.error(JSON.stringify({ error: 'Usage: brain reinforce <mem_id1> [mem_id2] ...' }));
    process.exit(1);
  }

  const brainDir = getBrainDir();
  const now = new Date();
  let result;
  try {
    result = reinforceMemories(args.memoryIds, { now, brainDir });
  } catch (err) {
    const msg = /not initialized/.test(err.message)
      ? 'Brain not initialized.'
      : `Corrupt index.json in ~/.brain/ — ${err.message}. Fix the JSON manually or restore from sync/backup.`;
    console.error(JSON.stringify({ error: msg }));
    process.exit(1);
  }

  // Injected-vs-used telemetry (src/surfaced.js): reinforce is the agent saying
  // a memory shaped its answer.
  recordUsed(brainDir, {
    session: envSession(),
    ids: result.reinforced.map((r) => r.id).filter(Boolean),
    now: now.toISOString(),
  });

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Parse CLI arguments.
 */
function parseArgs(argv) {
  const args = {
    memoryIds: [],
    project: null,
  };

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') {
      args.project = argv[++i];
    } else if (!argv[i].startsWith('--')) {
      args.memoryIds.push(argv[i]);
    }
  }

  return args;
}

main();
