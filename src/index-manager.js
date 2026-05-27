/**
 * Brain Memory — Index Manager
 *
 * Utilities for reading, updating, and maintaining the ~/.brain/index.json
 * file. Used by hooks and external integrations.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DEFAULT_BRAIN_DIR = path.join(os.homedir(), '.brain');
const INDEX_FILE = 'index.json';
const ASSOCIATIONS_FILE = 'associations.json';
const CONTEXTS_FILE = 'contexts.json';
const REVIEW_QUEUE_FILE = 'review-queue.json';
const ARCHIVE_INDEX_FILE = '_archived/index.json';
const SEARCH_INDEX_FILE = 'search-index.json';
const CONFIG_FILE = 'config.json';

// CoALA Phase 0 — working-memory budget (token estimates, chars/4 heuristic).
// All values are conservative caps; the session-start aggregator never exceeds
// working_memory_budget_tokens and reports overflow rather than dropping silently.
const DEFAULT_CONFIG = {
  working_memory_budget_tokens: 3000,
  pin_budget_tokens: 1500,
  skills_index_budget_tokens: 800,
  recall_budget_tokens: 700,
};

/**
 * Write data to a file atomically by writing to a temp file first,
 * then renaming. Prevents corruption if the process crashes mid-write.
 *
 * @param {string} filePath - Target file path
 * @param {string} data - Data to write
 */
function atomicWriteSync(filePath, data) {
  const tmpPath = filePath + '.tmp.' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, filePath);
}

/**
 * Validate that a target path is within the brain directory.
 * Prevents path traversal attacks (e.g. categoryPath = '../../etc/passwd').
 *
 * @param {string} targetPath - The resolved path to validate
 * @param {string} brainDir - The brain directory root
 * @throws {Error} if targetPath is outside brainDir
 */
function validateBrainPath(targetPath, brainDir) {
  const resolved = path.resolve(targetPath);
  const resolvedBrain = path.resolve(brainDir);
  if (!resolved.startsWith(resolvedBrain + path.sep) && resolved !== resolvedBrain) {
    throw new Error(`Path traversal detected: ${targetPath} is outside ${brainDir}`);
  }
}

/**
 * Resolve the brain directory path.
 *
 * @param {string} [overrideBase] - Override base directory (for testing)
 * @returns {string} Absolute path to ~/.brain/ (or overrideBase/.brain/ if provided)
 */
function getBrainDir(overrideBase) {
  if (overrideBase) return path.join(overrideBase, '.brain');
  return DEFAULT_BRAIN_DIR;
}

/**
 * Read and parse the brain index.
 *
 * @param {string} [projectRoot] - Project root directory
 * @returns {Object|null} Parsed index or null if not found
 */
function readIndex(projectRoot) {
  const indexPath = path.join(getBrainDir(projectRoot), INDEX_FILE);
  if (!fs.existsSync(indexPath)) return null;
  return JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
}

/**
 * Write the brain index back to disk.
 *
 * @param {Object} index - The index object to write
 * @param {string} [projectRoot] - Project root directory
 */
function writeIndex(index, projectRoot) {
  const indexPath = path.join(getBrainDir(projectRoot), INDEX_FILE);
  index.last_updated = new Date().toISOString();
  atomicWriteSync(indexPath, JSON.stringify(index, null, 2) + '\n');
}

/**
 * Add a memory entry to the index.
 *
 * @param {Object} index - The index object
 * @param {string} id - Memory ID
 * @param {Object} entry - Memory index entry
 * @returns {Object} Updated index
 */
function addMemory(index, id, entry) {
  index.memories[id] = entry;
  index.memory_count = Object.keys(index.memories).length;
  return index;
}

/**
 * Remove a memory entry from the index.
 *
 * @param {Object} index - The index object
 * @param {string} id - Memory ID to remove
 * @returns {Object} Updated index
 */
function removeMemory(index, id) {
  delete index.memories[id];
  index.memory_count = Object.keys(index.memories).length;
  return index;
}

/**
 * Update a memory entry in the index (partial update).
 *
 * @param {Object} index - The index object
 * @param {string} id - Memory ID
 * @param {Object} updates - Fields to update
 * @returns {Object} Updated index
 */
function updateMemory(index, id, updates) {
  if (index.memories[id]) {
    Object.assign(index.memories[id], updates);
  }
  return index;
}

/**
 * Generate a new memory ID.
 *
 * @returns {string} Memory ID in format mem_YYYYMMDD_<6-hex>
 */
function generateId() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const hex = Math.random().toString(16).slice(2, 8);
  return `mem_${date}_${hex}`;
}

/**
 * Read a _meta.json file from a brain subdirectory.
 *
 * @param {string} categoryPath - Relative path within ~/.brain/
 * @param {string} [projectRoot] - Project root directory
 * @returns {Object|null} Parsed meta or null
 */
function readMeta(categoryPath, projectRoot) {
  const brainDir = getBrainDir(projectRoot);
  const metaPath = path.join(brainDir, categoryPath, '_meta.json');
  validateBrainPath(metaPath, brainDir);
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Write a _meta.json file to a brain subdirectory.
 *
 * @param {string} categoryPath - Relative path within ~/.brain/
 * @param {Object} meta - Meta object to write
 * @param {string} [projectRoot] - Project root directory
 */
function writeMeta(categoryPath, meta, projectRoot) {
  const brainDir = getBrainDir(projectRoot);
  const metaPath = path.join(brainDir, categoryPath, '_meta.json');
  validateBrainPath(metaPath, brainDir);
  fs.mkdirSync(path.dirname(metaPath), { recursive: true });
  atomicWriteSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
}

/**
 * Get all memories grouped by category.
 *
 * @param {Object} index - The index object
 * @returns {Object} Map of category => [memory entries]
 */
function groupByCategory(index) {
  const groups = {};
  for (const [id, entry] of Object.entries(index.memories)) {
    const category = entry.path.split('/')[0];
    if (!groups[category]) groups[category] = [];
    groups[category].push({ id, ...entry });
  }
  return groups;
}

// --- Associations (Phase 1: Associative Network) ---

/**
 * Read the associations graph.
 *
 * @param {string} [projectRoot] - Project root directory
 * @returns {Object|null} Parsed associations or null
 */
function readAssociations(projectRoot) {
  const filePath = path.join(getBrainDir(projectRoot), ASSOCIATIONS_FILE);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Write the associations graph to disk.
 *
 * @param {Object} associations - The associations object
 * @param {string} [projectRoot] - Project root directory
 */
function writeAssociations(associations, projectRoot) {
  const filePath = path.join(getBrainDir(projectRoot), ASSOCIATIONS_FILE);
  atomicWriteSync(filePath, JSON.stringify(associations, null, 2) + '\n');
}

/**
 * Reinforce (or create) an edge between two memories.
 *
 * @param {Object} associations - The associations object
 * @param {string} idA - First memory ID
 * @param {string} idB - Second memory ID
 * @param {string} origin - Origin type (manual, tag_overlap, co_retrieval, propagation, creative)
 * @param {number} [initialWeight=0.20] - Weight for new edges
 * @returns {Object} Updated associations
 */
function reinforceEdge(associations, idA, idB, origin, initialWeight = 0.20) {
  if (idA === idB) return associations;
  if (!associations.edges) associations.edges = {};

  // Ensure bidirectional entries
  for (const [src, dst] of [[idA, idB], [idB, idA]]) {
    if (!associations.edges[src]) associations.edges[src] = {};
    const edge = associations.edges[src][dst];
    if (edge) {
      // Hebbian reinforcement: new_weight = min(1.0, weight + 0.10 * (1.0 - weight))
      edge.weight = Math.min(1.0, edge.weight + 0.10 * (1.0 - edge.weight));
      edge.co_retrievals = (edge.co_retrievals || 0) + 1;
      edge.last_activated = new Date().toISOString();
    } else {
      associations.edges[src][dst] = {
        weight: initialWeight,
        co_retrievals: 0,
        last_activated: new Date().toISOString(),
        origin: origin,
      };
    }
  }
  return associations;
}

/**
 * Get all neighbors of a memory with their edge weights.
 *
 * @param {Object} associations - The associations object
 * @param {string} id - Memory ID
 * @returns {Object[]} Array of {id, weight, co_retrievals, last_activated, origin}
 */
function getNeighbors(associations, id) {
  if (!associations || !associations.edges || !associations.edges[id]) return [];
  return Object.entries(associations.edges[id]).map(([neighborId, edge]) => ({
    id: neighborId,
    ...edge,
  }));
}

/**
 * Apply time-based decay to all association weights and prune weak links.
 *
 * @param {Object} associations - The associations object
 * @param {number} [decayBase=0.998] - Daily decay base
 * @param {number} [pruneThreshold=0.05] - Prune links below this weight
 * @returns {Object} Updated associations with decayed/pruned edges
 */
function decayAssociations(associations, decayBase = 0.998, pruneThreshold = 0.05) {
  if (!associations || !associations.edges) return associations;
  const now = new Date();

  for (const srcId of Object.keys(associations.edges)) {
    for (const dstId of Object.keys(associations.edges[srcId])) {
      const edge = associations.edges[srcId][dstId];
      const lastActivated = new Date(edge.last_activated);
      const daysSince = (now - lastActivated) / (1000 * 60 * 60 * 24);
      edge.weight = edge.weight * Math.pow(decayBase, daysSince);

      if (edge.weight < pruneThreshold) {
        delete associations.edges[srcId][dstId];
      }
    }
    // Clean up empty neighbor maps
    if (Object.keys(associations.edges[srcId]).length === 0) {
      delete associations.edges[srcId];
    }
  }
  return associations;
}

// --- Contexts (Phase 2: Context-Dependent Memory) ---

/**
 * Read the contexts file.
 *
 * @param {string} [projectRoot] - Project root directory
 * @returns {Object|null} Parsed contexts or null
 */
function readContexts(projectRoot) {
  const filePath = path.join(getBrainDir(projectRoot), CONTEXTS_FILE);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Write the contexts file to disk.
 *
 * @param {Object} contexts - The contexts object
 * @param {string} [projectRoot] - Project root directory
 */
function writeContexts(contexts, projectRoot) {
  const filePath = path.join(getBrainDir(projectRoot), CONTEXTS_FILE);
  atomicWriteSync(filePath, JSON.stringify(contexts, null, 2) + '\n');
}

// --- Review Queue (Phase 4: Spaced Repetition) ---

/**
 * Read the review queue.
 *
 * @param {string} [projectRoot] - Project root directory
 * @returns {Object|null} Parsed review queue or null
 */
function readReviewQueue(projectRoot) {
  const filePath = path.join(getBrainDir(projectRoot), REVIEW_QUEUE_FILE);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Write the review queue to disk.
 *
 * @param {Object} queue - The review queue object
 * @param {string} [projectRoot] - Project root directory
 */
function writeReviewQueue(queue, projectRoot) {
  const filePath = path.join(getBrainDir(projectRoot), REVIEW_QUEUE_FILE);
  atomicWriteSync(filePath, JSON.stringify(queue, null, 2) + '\n');
}

// --- Archive Index (Phase 4: Archive Search) ---

/**
 * Read the archive index.
 *
 * @param {string} [projectRoot] - Project root directory
 * @returns {Object|null} Parsed archive index or null
 */
function readArchiveIndex(projectRoot) {
  const filePath = path.join(getBrainDir(projectRoot), ARCHIVE_INDEX_FILE);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Write the archive index to disk.
 *
 * @param {Object} archiveIndex - The archive index object
 * @param {string} [projectRoot] - Project root directory
 */
function writeArchiveIndex(archiveIndex, projectRoot) {
  const filePath = path.join(getBrainDir(projectRoot), ARCHIVE_INDEX_FILE);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  atomicWriteSync(filePath, JSON.stringify(archiveIndex, null, 2) + '\n');
}

/**
 * Remove ALL association edges involving a memory (both directions).
 *
 * Deletes the memory's own neighbor map and removes it from every other
 * memory's neighbor map. Cleans up empty neighbor maps afterward.
 *
 * @param {Object} associations - The associations object
 * @param {string} memoryId - Memory ID to remove
 * @returns {Object} Updated associations
 */
function removeEdgesForMemory(associations, memoryId) {
  if (!associations || !associations.edges) return associations;

  // Remove the memory's own outgoing edges
  delete associations.edges[memoryId];

  // Remove all incoming edges from other memories
  for (const srcId of Object.keys(associations.edges)) {
    delete associations.edges[srcId][memoryId];
    // Clean up empty neighbor maps
    if (Object.keys(associations.edges[srcId]).length === 0) {
      delete associations.edges[srcId];
    }
  }

  return associations;
}

/**
 * Remove a memory from the review queue.
 *
 * Filters out any items matching the given memory ID.
 *
 * @param {Object} queue - The review queue object (with items array)
 * @param {string} memoryId - Memory ID to remove
 * @returns {Object} Updated queue
 */
function removeFromReviewQueue(queue, memoryId) {
  if (!queue || !Array.isArray(queue.items)) return queue;
  queue.items = queue.items.filter((item) => item.memory_id !== memoryId);
  return queue;
}

// --- Search Index (TF-IDF) ---

/**
 * Read the TF-IDF search index.
 *
 * @param {string} [projectRoot] - Project root directory
 * @returns {Object|null} Parsed search index or null
 */
function readSearchIndex(projectRoot) {
  const filePath = path.join(getBrainDir(projectRoot), SEARCH_INDEX_FILE);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Write the TF-IDF search index to disk.
 *
 * @param {Object} searchIndex - The search index object
 * @param {string} [projectRoot] - Project root directory
 */
function writeSearchIndex(searchIndex, projectRoot) {
  const filePath = path.join(getBrainDir(projectRoot), SEARCH_INDEX_FILE);
  atomicWriteSync(filePath, JSON.stringify(searchIndex, null, 2) + '\n');
}

// --- Config (CoALA Phase 0: working-memory budget) ---

/**
 * Read the brain config, merged over safe defaults. Created lazily — a missing
 * or unreadable config falls back to DEFAULT_CONFIG so session-start is robust.
 *
 * @param {string} [projectRoot] - Project root directory
 * @returns {Object} Config with all budget keys guaranteed present
 */
function readConfig(projectRoot) {
  const filePath = path.join(getBrainDir(projectRoot), CONFIG_FILE);
  let onDisk = {};
  try {
    onDisk = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    // ENOENT (not yet created) or corrupt JSON → fall back to defaults.
    // Budgets are non-critical; a broken config must not break startup.
    onDisk = {};
  }
  return { ...DEFAULT_CONFIG, ...onDisk };
}

/**
 * Write the brain config to disk atomically.
 *
 * @param {Object} config - The config object
 * @param {string} [projectRoot] - Project root directory
 */
function writeConfig(config, projectRoot) {
  const filePath = path.join(getBrainDir(projectRoot), CONFIG_FILE);
  atomicWriteSync(filePath, JSON.stringify(config, null, 2) + '\n');
}

module.exports = {
  getBrainDir,
  DEFAULT_CONFIG,
  readConfig,
  writeConfig,
  readIndex,
  writeIndex,
  addMemory,
  removeMemory,
  updateMemory,
  generateId,
  readMeta,
  writeMeta,
  groupByCategory,
  // Phase 1: Associative Network
  readAssociations,
  writeAssociations,
  reinforceEdge,
  getNeighbors,
  decayAssociations,
  // Phase 2: Context-Dependent Memory
  readContexts,
  writeContexts,
  // Phase 4: Spaced Repetition & Archive
  readReviewQueue,
  writeReviewQueue,
  readArchiveIndex,
  writeArchiveIndex,
  // Search Index (TF-IDF)
  readSearchIndex,
  writeSearchIndex,
  // Deep erasure utilities
  removeEdgesForMemory,
  removeFromReviewQueue,
  // Security utilities
  atomicWriteSync,
  validateBrainPath,
};
