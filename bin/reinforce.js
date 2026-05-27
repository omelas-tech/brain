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
 *   - Hebbian co-retrieval: strengthens association edges between all pairs
 *   - Updates index.json, associations.json, and memory files
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  readIndex,
  writeIndex,
  readAssociations,
  writeAssociations,
  reinforceEdge,
  getBrainDir,
} = require('../src/index-manager');

const {
  reinforceStrength,
  improveDecayRate,
} = require('../src/scorer');

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.memoryIds.length === 0) {
    console.error(JSON.stringify({ error: 'Usage: brain reinforce <mem_id1> [mem_id2] ...' }));
    process.exit(1);
  }

  const brainDir = getBrainDir();
  let index;
  try {
    index = readIndex();
  } catch (err) {
    console.error(JSON.stringify({
      error: `Corrupt index.json in ~/.brain/ — ${err.message}. Fix the JSON manually or restore from sync/backup.`,
    }));
    process.exit(1);
  }

  if (!index) {
    console.error(JSON.stringify({ error: 'Brain not initialized.' }));
    process.exit(1);
  }

  const now = new Date();
  const nowISO = now.toISOString();
  const reinforced = [];

  // Apply spaced reinforcement to each memory
  for (const memId of args.memoryIds) {
    const entry = index.memories[memId];
    if (!entry) continue;

    const lastAccessed = new Date(entry.last_accessed || entry.created);
    const daysSince = (now - lastAccessed) / (1000 * 60 * 60 * 24);
    const accessCount = entry.access_count || 0;

    // Compute boost
    const oldStrength = entry.strength;
    const newStrength = reinforceStrength(oldStrength, daysSince, accessCount);
    const newDecayRate = improveDecayRate(entry.decay_rate);

    // Update index entry
    entry.strength = Math.round(newStrength * 1000) / 1000;
    entry.decay_rate = Math.round(newDecayRate * 10000) / 10000;
    entry.last_accessed = nowISO;
    entry.access_count = accessCount + 1;

    // Update the memory file's frontmatter on disk
    updateMemoryFile(brainDir, entry.path, {
      strength: entry.strength,
      decay_rate: entry.decay_rate,
      last_accessed: nowISO,
      access_count: entry.access_count,
    });

    reinforced.push({
      id: memId,
      old_strength: oldStrength,
      new_strength: entry.strength,
      boost: Math.round((newStrength - oldStrength) * 1000) / 1000,
      decay_rate: entry.decay_rate,
    });
  }

  // Save index
  writeIndex(index);

  // Hebbian co-retrieval: strengthen edges between all pairs
  let edgesReinforced = 0;
  if (args.memoryIds.length > 1) {
    let associations = readAssociations() || { version: 1, edges: {} };

    for (let i = 0; i < args.memoryIds.length; i++) {
      for (let j = i + 1; j < args.memoryIds.length; j++) {
        const idA = args.memoryIds[i];
        const idB = args.memoryIds[j];
        // Only reinforce if both exist in index
        if (index.memories[idA] && index.memories[idB]) {
          reinforceEdge(associations, idA, idB, 'co_retrieval');
          edgesReinforced++;
        }
      }
    }

    writeAssociations(associations);
  }

  console.log(JSON.stringify({
    reinforced,
    edges_reinforced: edgesReinforced,
  }, null, 2));
}

/**
 * Update a memory file's YAML frontmatter fields on disk.
 *
 * @param {string} brainDir - Path to ~/.brain/
 * @param {string} memPath - Relative path to memory file
 * @param {Object} updates - Fields to update in frontmatter
 */
function updateMemoryFile(brainDir, memPath, updates) {
  const fullPath = path.join(brainDir, memPath);
  try {
    let content = fs.readFileSync(fullPath, 'utf-8');

    // Find frontmatter boundaries
    const firstDash = content.indexOf('---');
    const secondDash = content.indexOf('---', firstDash + 3);
    if (firstDash === -1 || secondDash === -1) return;

    let frontmatter = content.slice(firstDash + 3, secondDash);

    // Update each field in the YAML
    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^(${key}:\\s*).*$`, 'm');
      const formatted = typeof value === 'string' ? `"${value}"` : String(value);
      if (regex.test(frontmatter)) {
        frontmatter = frontmatter.replace(regex, `$1${formatted}`);
      }
    }

    content = content.slice(0, firstDash + 3) + frontmatter + content.slice(secondDash);
    fs.writeFileSync(fullPath, content);
  } catch { /* skip if file not readable/writable */ }
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
