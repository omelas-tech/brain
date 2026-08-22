/**
 * Brain Memory — Procedural Skills (CoALA Phase 2 + Tier B §10.3)
 *
 * Stores "how to do things" as `_skills/<name>/SKILL.md` folders and serves them
 * via three-level progressive disclosure:
 *   L0 — session start advertises only name + description (skills-index.json)
 *   L1 — on a matching task, the agent reads the full SKILL.md
 *   L2 — referenced resources/ load only at execution
 *
 * Procedural memory strengthens with successful use and weakens on failure
 * (Tier B §10.3), so a bad crystallized skill demotes itself out of the index.
 */

const fs = require('fs');
const path = require('path');

const {
  getBrainDir,
  readSkillsIndex,
  writeSkillsIndex,
  validateBrainPath,
  atomicWriteSync,
} = require('./index-manager');
const { setFrontmatterFields } = require('./pinning');
const { verifySkill } = require('./skill-verify');

const SKILLS_DIR = '_skills';
const DEFAULT_STRENGTH = 0.6;
// A skill whose failure rate exceeds this drops below the L0 advertisement cut.
const DEMOTE_FAIL_RATIO = 0.5;

/** Normalize a skill name to a filesystem-safe slug. */
function slug(name) {
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function skillPath(name) {
  return `${SKILLS_DIR}/${slug(name)}/SKILL.md`;
}

function buildSkillFile(skill) {
  const fm = [
    '---',
    `name: ${slug(skill.name)}`,
    `description: ${JSON.stringify(skill.description || '')}`,
    `triggers: [${(skill.triggers || []).map((t) => JSON.stringify(t)).join(', ')}]`,
    'cognitive_type: procedural',
    `strength: ${skill.strength ?? DEFAULT_STRENGTH}`,
    `last_used: ${skill.last_used ? JSON.stringify(skill.last_used) : 'null'}`,
    `use_count: ${skill.use_count ?? 0}`,
    `fail_count: ${skill.fail_count ?? 0}`,
    '---',
    '',
  ].join('\n');
  return fm + (skill.body || '') + '\n';
}

/** Is this skill advertised at L0? Demoted skills stay on disk but go quiet. */
function isAdvertised(s) {
  const uses = s.use_count || 0;
  const fails = s.fail_count || 0;
  return !(uses >= 3 && fails / uses > DEMOTE_FAIL_RATIO);
}

/**
 * Create or replace a skill.
 * @param {string} [projectRoot]
 * @param {Object} skill - { name, description, triggers[], body, strength? }
 */
function addSkill(projectRoot, skill) {
  const name = slug(skill && skill.name);
  if (!name) return { error: 'Skill name required' };

  const brainDir = getBrainDir(projectRoot);
  const dir = path.join(brainDir, SKILLS_DIR, name);
  validateBrainPath(dir, brainDir);
  fs.mkdirSync(dir, { recursive: true });

  const record = {
    name,
    description: skill.description || '',
    triggers: skill.triggers || [],
    strength: skill.strength ?? DEFAULT_STRENGTH,
    use_count: 0,
    fail_count: 0,
    last_used: null,
    // Declarative, read-only preconditions (src/skill-verify.js). Only set when
    // present, so prose-only skills stay lean and are reported `unverifiable`
    // rather than failing a check they never claimed to support.
    ...(Array.isArray(skill.verify) && skill.verify.length ? { verify: skill.verify } : {}),
  };
  atomicWriteSync(path.join(dir, 'SKILL.md'), buildSkillFile({ ...record, body: skill.body }));

  const idx = readSkillsIndex(projectRoot);
  idx.skills = idx.skills.filter((s) => s.name !== name);
  idx.skills.push({ ...record, path: skillPath(name) });
  writeSkillsIndex(idx, projectRoot);

  return { name, added: true };
}

/** Full advertised index (every stored skill, advertised or demoted). */
function listSkills(projectRoot) {
  return readSkillsIndex(projectRoot).skills;
}

/** L0 summaries (name + description) for advertised skills only. */
function advertisedSummaries(projectRoot) {
  return readSkillsIndex(projectRoot).skills
    .filter(isAdvertised)
    .map((s) => ({ name: s.name, description: s.description, triggers: s.triggers || [] }));
}

/** L1: the full SKILL.md body. */
function showSkill(projectRoot, name) {
  const full = path.join(getBrainDir(projectRoot), skillPath(name));
  try {
    return { name: slug(name), content: fs.readFileSync(full, 'utf-8') };
  } catch (_) {
    return { error: `Skill not found: ${name}` };
  }
}

/**
 * Check a skill's declared preconditions against the current working directory.
 *
 * Answers "does this skill still describe reality?" without running the agent
 * — the offline-checkable half of procedural memory (Skill-DisCo,
 * arXiv:2606.26669). A skill distilled against a repo layout that has since
 * changed is not weakly-supported, it is wrong, and it will keep being
 * advertised to every matching session until enough real failures accumulate.
 *
 * A failed verification demotes exactly like a failed use, because the user
 * pays the same price either way. A *passing* verification does NOT strengthen:
 * preconditions holding says the skill is still applicable, not that following
 * it produced a good outcome, and inflating strength on a cheap automatic check
 * would let a skill climb the index without ever having worked.
 *
 * Skills with no `verify` block return `unverifiable` and are left untouched.
 *
 * @param {string} projectRoot
 * @param {string} name
 * @param {Object} [opts] - { cwd }
 * @returns {Object} { name, status, passed, total, checks, strength? }
 */
function verifySkillByName(projectRoot, name, opts = {}) {
  const idx = readSkillsIndex(projectRoot);
  const s = idx.skills.find((x) => x.name === slug(name));
  if (!s) return { error: `Skill not found: ${name}` };

  const result = verifySkill(s, { cwd: opts.cwd || process.cwd() });
  if (result.status === 'unverifiable') {
    return { name: s.name, ...result };
  }

  const now = new Date().toISOString();
  s.last_verified = now;
  s.verify_status = result.status;
  if (result.status === 'failed') {
    s.fail_count = (s.fail_count || 0) + 1;
    s.strength = Math.max(0, (s.strength ?? DEFAULT_STRENGTH) - 0.10);
  }
  writeSkillsIndex(idx, projectRoot);

  setFrontmatterFields(getBrainDir(projectRoot), skillPath(name), {
    last_verified: now,
    verify_status: result.status,
    ...(result.status === 'failed'
      ? { strength: Math.round(s.strength * 1000) / 1000, fail_count: s.fail_count }
      : {}),
  });

  return {
    name: s.name,
    ...result,
    strength: Math.round((s.strength ?? DEFAULT_STRENGTH) * 1000) / 1000,
    advertised: isAdvertised(s),
  };
}

/**
 * Record a use. Success strengthens; failure weakens and counts toward demotion.
 * @param {Object} [opts] - { failed: boolean }
 */
function useSkill(projectRoot, name, opts = {}) {
  const idx = readSkillsIndex(projectRoot);
  const s = idx.skills.find((x) => x.name === slug(name));
  if (!s) return { error: `Skill not found: ${name}` };

  s.use_count = (s.use_count || 0) + 1;
  if (opts.failed) {
    s.fail_count = (s.fail_count || 0) + 1;
    s.strength = Math.max(0, (s.strength ?? DEFAULT_STRENGTH) - 0.10);
  } else {
    const cur = s.strength ?? DEFAULT_STRENGTH;
    s.strength = Math.min(1.0, cur + 0.05 * (1.0 - cur));
  }
  s.last_used = new Date().toISOString();
  writeSkillsIndex(idx, projectRoot);

  setFrontmatterFields(getBrainDir(projectRoot), skillPath(name), {
    strength: Math.round(s.strength * 1000) / 1000,
    use_count: s.use_count,
    fail_count: s.fail_count,
    last_used: s.last_used,
  });

  return {
    name: s.name,
    use_count: s.use_count,
    fail_count: s.fail_count,
    strength: Math.round(s.strength * 1000) / 1000,
    advertised: isAdvertised(s),
  };
}

/**
 * Export a stored skill into the host agent's native skill format so it becomes
 * directly executable (CoALA Phase 4 host bridge). Brain stores/distills; the
 * host executes.
 *
 * @param {string} [projectRoot] - Brain filesystem root
 * @param {string} name - Skill name
 * @param {string} [target='claude'] - 'claude' | 'gemini'
 * @param {string} [destRoot=process.cwd()] - Host project root to write into
 */
function exportSkill(projectRoot, name, target = 'claude', destRoot = process.cwd()) {
  const src = showSkill(projectRoot, name);
  if (src.error) return src;

  const dests = {
    claude: path.join(destRoot, '.claude', 'skills', slug(name)),
    gemini: path.join(destRoot, '.gemini', 'skills', slug(name)),
  };
  const dir = dests[target];
  if (!dir) return { error: `Unknown target: ${target} (use claude|gemini)` };

  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, 'SKILL.md');
  fs.writeFileSync(outPath, src.content);
  return { name: slug(name), target, path: outPath };
}

function removeSkill(projectRoot, name) {
  const n = slug(name);
  const dir = path.join(getBrainDir(projectRoot), SKILLS_DIR, n);
  let removedDir = false;
  try { fs.rmSync(dir, { recursive: true, force: true }); removedDir = true; } catch (_) { /* ignore */ }

  const idx = readSkillsIndex(projectRoot);
  const before = idx.skills.length;
  idx.skills = idx.skills.filter((s) => s.name !== n);
  writeSkillsIndex(idx, projectRoot);

  return { name: n, removed: removedDir || before !== idx.skills.length };
}

module.exports = {
  slug,
  skillPath,
  isAdvertised,
  addSkill,
  listSkills,
  advertisedSummaries,
  showSkill,
  useSkill,
  verifySkillByName,
  removeSkill,
  exportSkill,
  DEMOTE_FAIL_RATIO,
};
