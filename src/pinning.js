/**
 * Brain Memory — Pinning (CoALA Phase 1)
 *
 * Pin/unpin a memory into the always-present semantic tier. Pinning is the fix
 * for the core reliability hole: a durable convention/preference must apply
 * every session regardless of recall score. A pinned memory is implicitly
 * decay-exempt (the scorer treats pinned || stable as exempt).
 *
 * The index entry is the source of truth read by recall/session-start; the
 * memory file's frontmatter is kept in sync for human-readability and git.
 */

const fs = require('fs');
const path = require('path');

const {
  getBrainDir,
  readIndex,
  writeIndex,
  readPinned,
  writePinned,
} = require('./index-manager');

/** chars/4 token estimate; falls back to the title line for older entries. */
function estimateTokens(entry) {
  if (entry && typeof entry.token_estimate === 'number') return entry.token_estimate;
  return Math.ceil((((entry && entry.title) || '').length + 8) / 4);
}

/**
 * Update-or-insert scalar YAML frontmatter fields in a memory file (best effort;
 * the index entry remains the source of truth if the file is unreadable).
 */
function setFrontmatterFields(brainDir, memPath, fields) {
  const fullPath = path.join(brainDir, memPath);
  let content;
  try { content = fs.readFileSync(fullPath, 'utf-8'); } catch (_) { return; }

  const first = content.indexOf('---');
  const second = content.indexOf('---', first + 3);
  if (first === -1 || second === -1) return;

  let fm = content.slice(first + 3, second);
  const inserts = [];
  for (const [key, value] of Object.entries(fields)) {
    const formatted = typeof value === 'string' ? `"${value}"` : String(value);
    const re = new RegExp(`^(${key}:\\s*).*$`, 'm');
    if (re.test(fm)) fm = fm.replace(re, `$1${formatted}`);
    else inserts.push(`${key}: ${formatted}\n`);
  }
  if (inserts.length) fm = fm.replace(/\s*$/, '\n') + inserts.join('');

  content = content.slice(0, first + 3) + fm + content.slice(second);
  fs.writeFileSync(fullPath, content);
}

/**
 * Pin a memory (always-loaded). Sets pinned/pin_scope/pin_priority on the index
 * entry + frontmatter and records it in pinned.json.
 *
 * @param {string} [projectRoot] - Filesystem root (undefined = real ~/.brain)
 * @param {string} id - Memory ID
 * @param {Object} [opts] - { scope = "global"|"project:<name>", priority = 0 }
 * @returns {Object} Result or { error }
 */
function pinMemory(projectRoot, id, opts = {}) {
  const scope = opts.scope || 'global';
  const priority = Number.isFinite(opts.priority) ? opts.priority : 0;

  const index = readIndex(projectRoot);
  if (!index || !index.memories || !index.memories[id]) {
    return { error: `Memory not found: ${id}` };
  }

  const entry = index.memories[id];
  entry.pinned = true;
  entry.pin_scope = scope;
  entry.pin_priority = priority;
  writeIndex(index, projectRoot);

  setFrontmatterFields(getBrainDir(projectRoot), entry.path, {
    pinned: true,
    pin_scope: scope,
    pin_priority: priority,
  });

  const pinned = readPinned(projectRoot);
  pinned.pins = pinned.pins.filter((p) => p.id !== id);
  pinned.pins.push({ id, scope, priority, token_estimate: estimateTokens(entry) });
  writePinned(pinned, projectRoot);

  return { id, pinned: true, scope, priority };
}

/**
 * Unpin a memory. Clears the pinned flag and removes it from pinned.json. Leaves
 * an independent `stable` flag untouched.
 *
 * @param {string} [projectRoot] - Filesystem root (undefined = real ~/.brain)
 * @param {string} id - Memory ID
 * @returns {Object} Result or { error }
 */
function unpinMemory(projectRoot, id) {
  const index = readIndex(projectRoot);
  if (!index || !index.memories || !index.memories[id]) {
    return { error: `Memory not found: ${id}` };
  }

  const entry = index.memories[id];
  const wasPinned = !!entry.pinned;
  entry.pinned = false;
  writeIndex(index, projectRoot);

  setFrontmatterFields(getBrainDir(projectRoot), entry.path, { pinned: false });

  const pinned = readPinned(projectRoot);
  const before = pinned.pins.length;
  pinned.pins = pinned.pins.filter((p) => p.id !== id);
  writePinned(pinned, projectRoot);

  return { id, pinned: false, was_pinned: wasPinned, removed: before !== pinned.pins.length };
}

module.exports = { pinMemory, unpinMemory, estimateTokens, setFrontmatterFields };
