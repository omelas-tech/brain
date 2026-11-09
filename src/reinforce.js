/**
 * Brain Memory — Reinforcement (library form)
 *
 * Spaced reinforcement + Hebbian co-retrieval, shared by `brain reinforce`
 * (explicit, agent-invoked) and the Stop hook (implicit: a memory the agent
 * cited with a verified receipt shaped the answer, so it was used).
 *
 * Why the implicit path exists: the whole strength model assumes recall makes
 * a memory stronger, but in practice agents almost never ran `brain reinforce`
 * after recalling — one real brain had 328 surfaced events and zero `used`
 * events across seven months, leaving 93% of memories at access_count 0. A
 * receipt in the final reply is a stronger "this memory was used" signal than
 * anything the agent would remember to report, and it is already verified
 * against the surfaced ledger by the citation lock.
 */

const fs = require('fs');
const path = require('path');

const {
  readIndex,
  writeIndex,
  readAssociations,
  writeAssociations,
  reinforceEdge,
  getBrainDir,
  validateBrainPath,
} = require('./index-manager');
const { reinforceStrength, improveDecayRate } = require('./scorer');

// Recall-history rows kept per memory. Enough to fit an interval curve;
// small enough that a hot memory's frontmatter stays cheap to parse.
const RECALL_HISTORY_MAX = 50;

/**
 * Update a memory file's YAML frontmatter fields on disk (existing keys only).
 */
function updateMemoryFile(brainDir, memPath, updates) {
  const fullPath = path.join(brainDir, memPath);
  try {
    // The path comes from index.json — which syncs across devices, so a
    // tampered index entry must not become a write primitive outside ~/.brain.
    validateBrainPath(fullPath, brainDir);
    let content = fs.readFileSync(fullPath, 'utf-8');
    const firstDash = content.indexOf('---');
    const secondDash = content.indexOf('---', firstDash + 3);
    if (firstDash === -1 || secondDash === -1) return;
    let frontmatter = content.slice(firstDash + 3, secondDash);
    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^(${key}:\\s*).*$`, 'm');
      // Arrays/objects are JSON-encoded (JSON is a YAML subset); String() would
      // render an array of objects as "[object Object]".
      const formatted = typeof value === 'string'
        ? `"${value}"`
        : (value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value));
      if (regex.test(frontmatter)) frontmatter = frontmatter.replace(regex, `$1${formatted}`);
    }
    content = content.slice(0, firstDash + 3) + frontmatter + content.slice(secondDash);
    fs.writeFileSync(fullPath, content);
  } catch { /* skip if file not readable/writable */ }
}

/**
 * Reinforce memories by id.
 *
 * @param {string[]} ids
 * @param {Object} [opts] - { now: Date, brainDir }
 * @returns {{ reinforced: Object[], edges_reinforced: number }}
 */
function reinforceMemories(ids, opts = {}) {
  const now = opts.now || new Date();
  const nowISO = now.toISOString();
  const brainDir = opts.brainDir || getBrainDir();
  const index = readIndex();
  if (!index) throw new Error('Brain not initialized.');

  const unique = [...new Set((ids || []).filter(Boolean))];
  const reinforced = [];

  for (const memId of unique) {
    const entry = index.memories[memId];
    if (!entry) continue;

    const lastAccessed = new Date(entry.last_accessed || entry.created);
    const daysSince = Math.max(0, (now - lastAccessed) / (1000 * 60 * 60 * 24));
    const accessCount = entry.access_count || 0;

    const oldStrength = entry.strength;
    const newStrength = reinforceStrength(oldStrength, daysSince, accessCount);
    const newDecayRate = improveDecayRate(entry.decay_rate);

    entry.strength = Math.round(newStrength * 1000) / 1000;
    entry.decay_rate = Math.round(newDecayRate * 10000) / 10000;
    entry.last_accessed = nowISO;
    entry.access_count = accessCount + 1;

    // One row per reinforcement, capped — the interval series is what makes
    // decay calibration possible (benchmark/harness/decay-calibration.js).
    const history = Array.isArray(entry.recall_history) ? entry.recall_history : [];
    history.push({
      at: nowISO,
      days_since_last: Math.round(daysSince * 100) / 100,
      strength_before: oldStrength,
      strength_after: entry.strength,
    });
    entry.recall_history = history.slice(-RECALL_HISTORY_MAX);

    updateMemoryFile(brainDir, entry.path, {
      strength: entry.strength,
      decay_rate: entry.decay_rate,
      last_accessed: nowISO,
      access_count: entry.access_count,
      recall_history: entry.recall_history,
    });

    reinforced.push({
      id: memId,
      old_strength: oldStrength,
      new_strength: entry.strength,
      boost: Math.round((newStrength - oldStrength) * 1000) / 1000,
      decay_rate: entry.decay_rate,
    });
  }

  if (reinforced.length) writeIndex(index);

  // Hebbian co-retrieval: strengthen edges between every pair used together.
  let edgesReinforced = 0;
  const present = reinforced.map((r) => r.id);
  if (present.length > 1) {
    const associations = readAssociations() || { version: 1, edges: {} };
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        reinforceEdge(associations, present[i], present[j], 'co_retrieval');
        edgesReinforced++;
      }
    }
    writeAssociations(associations);
  }

  return { reinforced, edges_reinforced: edgesReinforced };
}

module.exports = { reinforceMemories, updateMemoryFile, RECALL_HISTORY_MAX };
