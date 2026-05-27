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
  removeSkill,
  DEMOTE_FAIL_RATIO,
};
