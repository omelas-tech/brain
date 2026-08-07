/**
 * Memory seeder — creates deterministic brain memories for benchmarks.
 *
 * Uses src/index-manager.js APIs directly to write memories, associations,
 * and contexts. This ensures reproducibility: the test measures whether
 * agents *recall and use* memories, not whether they can store them.
 */

const fs = require('fs');
const path = require('path');

// Import brain-memory APIs from the parent project
const indexManager = require('../../src/index-manager');

/**
 * Seeded PRNG for reproducible memory generation (xorshift32).
 * Same algorithm as test/stress.test.js for consistency.
 */
function createRng(seed) {
  let s = seed | 0 || 1;
  return function next() {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

/**
 * Seed a set of memories into a brain directory.
 *
 * @param {string} brainBase - Base directory (brain dir will be at brainBase/.brain/)
 * @param {Object[]} memories - Array of memory definitions
 * @param {Object} [options]
 * @param {Object[]} [options.associations] - Association pairs [{idA, idB, weight, origin}]
 * @param {Object} [options.context] - Session context to seed
 * @returns {Object} { memoriesSeeded: number, associationsSeeded: number }
 */
function seedMemories(brainBase, memories, options = {}) {
  const brainDir = path.join(brainBase, '.brain');

  // Read current index
  let index = indexManager.readIndex(brainBase);
  if (!index) {
    throw new Error(`Brain not initialized at ${brainDir}. Run brain-setup first.`);
  }

  // Add each memory to the index and write the markdown file
  for (const mem of memories) {
    // Add to index. Trust/provenance fields (origin, quarantined, pinned,
    // stable) are only set when the scenario declares them, so existing
    // scenarios are byte-for-byte unchanged; poisoning scenarios can seed a
    // planted `external`/quarantined memory that recall then down-weights.
    indexManager.addMemory(index, mem.id, {
      type: mem.type,
      cognitive_type: mem.cognitive_type || 'semantic',
      path: mem.path,
      strength: mem.strength,
      decay_rate: mem.decay_rate,
      salience: mem.salience || 0.5,
      confidence: mem.confidence || 0.8,
      tags: mem.tags || [],
      created: mem.created || new Date().toISOString(),
      last_accessed: mem.last_accessed || new Date().toISOString(),
      access_count: mem.access_count || 0,
      encoding_context: mem.encoding_context || {},
      ...(mem.origin ? { origin: mem.origin } : {}),
      ...(mem.quarantined ? { quarantined: true, quarantine_reasons: mem.quarantine_reasons || [] } : {}),
      ...(mem.pin ? { pinned: true, pin_scope: mem.pin_scope || 'global', pin_priority: mem.pin_priority || 0 } : {}),
      ...(mem.stable ? { stable: true } : {}),
    });

    // Write the markdown file
    const memPath = path.join(brainDir, mem.path);
    fs.mkdirSync(path.dirname(memPath), { recursive: true });
    fs.writeFileSync(memPath, buildMemoryMarkdown(mem));
  }

  // Write updated index
  indexManager.writeIndex(index, brainBase);

  // Seed associations
  let associationsSeeded = 0;
  if (options.associations && options.associations.length > 0) {
    let associations = indexManager.readAssociations(brainBase) || { version: 1, edges: {} };

    for (const assoc of options.associations) {
      // Directly write edges for reproducibility (bypass Hebbian reinforcement)
      if (!associations.edges[assoc.idA]) associations.edges[assoc.idA] = {};
      if (!associations.edges[assoc.idB]) associations.edges[assoc.idB] = {};

      const edge = {
        weight: assoc.weight || 0.5,
        co_retrievals: assoc.co_retrievals || 0,
        last_activated: new Date().toISOString(),
        origin: assoc.origin || 'benchmark_seed',
      };

      associations.edges[assoc.idA][assoc.idB] = { ...edge };
      associations.edges[assoc.idB][assoc.idA] = { ...edge };
      associationsSeeded++;
    }

    indexManager.writeAssociations(associations, brainBase);
  }

  // Seed context
  if (options.context) {
    let contexts = indexManager.readContexts(brainBase) || { version: 1, sessions: [] };
    contexts.sessions.push({
      ...options.context,
      timestamp: new Date().toISOString(),
    });
    indexManager.writeContexts(contexts, brainBase);
  }

  return {
    memoriesSeeded: memories.length,
    associationsSeeded,
  };
}

/**
 * Build a markdown memory file with YAML frontmatter.
 *
 * @param {Object} mem - Memory definition
 * @returns {string} Markdown content
 */
function buildMemoryMarkdown(mem) {
  const frontmatter = {
    id: mem.id,
    type: mem.type,
    cognitive_type: mem.cognitive_type || 'semantic',
    created: mem.created || new Date().toISOString(),
    last_accessed: mem.last_accessed || new Date().toISOString(),
    access_count: mem.access_count || 0,
    recall_history: [],
    strength: mem.strength,
    decay_rate: mem.decay_rate,
    salience: mem.salience || 0.5,
    confidence: mem.confidence || 0.8,
    ...(mem.pin ? { pinned: true, pin_scope: mem.pin_scope || 'global', pin_priority: mem.pin_priority || 0 } : {}),
    ...(mem.stable ? { stable: true } : {}),
    ...(mem.quarantined ? { quarantined: true, quarantine_reasons: mem.quarantine_reasons || [] } : {}),
    tags: mem.tags || [],
    related: mem.related || [],
    ...(mem.origin ? { origin: mem.origin } : {}),
    source: mem.source || 'benchmark_seed',
    encoding_context: mem.encoding_context || {},
  };

  const yamlLines = ['---'];
  for (const [key, value] of Object.entries(frontmatter)) {
    yamlLines.push(`${key}: ${JSON.stringify(value)}`);
  }
  yamlLines.push('---');
  yamlLines.push('');
  yamlLines.push(mem.content || `# ${mem.title || mem.id}\n\n${mem.body || ''}`);
  yamlLines.push('');

  return yamlLines.join('\n');
}

module.exports = { seedMemories, buildMemoryMarkdown, createRng };
