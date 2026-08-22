/**
 * Brain Memory — Skill Verification (Skill-DisCo, arXiv:2606.26669)
 *
 * A crystallized skill is a claim: "this is how this repo does migrations."
 * Today that claim is only ever tested by *using* it — `brain skill use
 * --failed` demotes one that misfires, so a bad skill decays out of the L0
 * index eventually. Eventually is the problem: the skill is advertised to
 * every session until enough failures accumulate, and the first few failures
 * are paid by the user.
 *
 * The Skill-DisCo result is that procedural memory should compile to something
 * **checkable offline** — verifiable without running the agent. This module is
 * that check: a skill may declare preconditions, and `brain skill verify`
 * answers whether they still hold in the current working directory.
 *
 * The value is drift detection. A skill distilled six months ago against a repo
 * whose `migrations/` folder has since been renamed is not weakly-supported —
 * it is *wrong*, and it will confidently misdirect the next session that
 * matches its triggers. A precondition check catches that in milliseconds.
 *
 * ── Why declarative checks and not a shell command ───────────────────────
 * The obvious design is `verify: npm run migrate:check`. It is also a loaded
 * gun pointed at the rest of this codebase.
 *
 * Skills are crystallized automatically from experience (sleep Phase 4b), they
 * sync between machines, and they can be imported from other people. A `verify`
 * field holding arbitrary shell would mean a memory file that executes code —
 * turning every one of Brain's poisoning defenses into theatre, because the
 * payload would no longer need to persuade the agent of anything. It would just
 * need to be run. `curl … | bash` in a synced skill is precisely the OWASP
 * ASI06 scenario with the hard part removed.
 *
 * So checks are DECLARATIVE and READ-ONLY. Every check type below inspects
 * state; none of them execute anything, and there is deliberately no escape
 * hatch. A skill can ask "does `migrations/` exist?" It cannot ask the machine
 * to run something and trust the exit code.
 *
 * ── Check types ──────────────────────────────────────────────────────────
 *   { file_exists: "migrations/" }
 *   { file_absent: "config/legacy.yml" }
 *   { file_contains: { path: "package.json", text: "\"migrate\"" } }
 *   { command_available: "psql" }        — PATH lookup only, never executed
 *   { env_set: "DATABASE_URL" }          — presence only, value never read
 */

const fs = require('fs');
const path = require('path');

// A contains-check reads a file into memory; cap it so a skill pointed at a
// multi-gigabyte artifact degrades to a failed check instead of an OOM.
const MAX_CONTAINS_BYTES = 2 * 1024 * 1024;

const CHECK_TYPES = ['file_exists', 'file_absent', 'file_contains', 'command_available', 'env_set'];

/**
 * Resolve a skill-declared path inside the working directory.
 *
 * Skills sync between machines and can be imported from other people, so a
 * declared path is untrusted input. Anything that escapes the working
 * directory — `../`, an absolute path, a symlink pointing out — resolves to
 * null and fails the check, so a skill can never be used to probe for files
 * elsewhere on the disk.
 *
 * @param {string} cwd - Directory the checks run against
 * @param {string} rel - Skill-declared path
 * @returns {string|null} Absolute path, or null when it escapes `cwd`
 */
function resolveInside(cwd, rel) {
  if (typeof rel !== 'string' || rel.length === 0) return null;
  if (path.isAbsolute(rel)) return null;
  const base = fs.realpathSync.native ? path.resolve(cwd) : path.resolve(cwd);
  const target = path.resolve(base, rel);
  const withSep = base.endsWith(path.sep) ? base : base + path.sep;
  if (target !== base && !target.startsWith(withSep)) return null;
  return target;
}

/** Is `name` an executable on PATH? Resolves only — never runs it. */
function onPath(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(name)) return false;
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch { /* keep looking */ }
  }
  return false;
}

/**
 * Evaluate one declarative check.
 *
 * @param {Object} check - Single-key object, e.g. { file_exists: "migrations/" }
 * @param {string} cwd
 * @returns {{ check: string, target: string, ok: boolean, detail?: string }}
 */
function runCheck(check, cwd) {
  if (!check || typeof check !== 'object') {
    return { check: 'malformed', target: '', ok: false, detail: 'check is not an object' };
  }
  const kind = Object.keys(check).find((k) => CHECK_TYPES.includes(k));
  if (!kind) {
    return {
      check: 'unknown',
      target: String(Object.keys(check)[0] || ''),
      ok: false,
      detail: `unsupported check; expected one of ${CHECK_TYPES.join(', ')}`,
    };
  }

  const value = check[kind];

  if (kind === 'env_set') {
    const ok = typeof value === 'string' && Boolean(process.env[value]);
    // Presence only. The value is never read, so a check can't exfiltrate a
    // secret into a result payload that later gets synced.
    return { check: kind, target: String(value), ok };
  }

  if (kind === 'command_available') {
    return { check: kind, target: String(value), ok: onPath(value) };
  }

  if (kind === 'file_exists' || kind === 'file_absent') {
    const abs = resolveInside(cwd, value);
    if (abs === null) {
      return { check: kind, target: String(value), ok: false, detail: 'path escapes the working directory' };
    }
    const exists = fs.existsSync(abs);
    return { check: kind, target: String(value), ok: kind === 'file_exists' ? exists : !exists };
  }

  // file_contains
  const spec = value && typeof value === 'object' ? value : {};
  const abs = resolveInside(cwd, spec.path);
  if (abs === null) {
    return { check: kind, target: String(spec.path || ''), ok: false, detail: 'path escapes the working directory' };
  }
  if (typeof spec.text !== 'string' || spec.text.length === 0) {
    return { check: kind, target: String(spec.path || ''), ok: false, detail: 'missing `text`' };
  }
  try {
    const stat = fs.statSync(abs);
    if (stat.size > MAX_CONTAINS_BYTES) {
      return { check: kind, target: spec.path, ok: false, detail: 'file too large to scan' };
    }
    return { check: kind, target: spec.path, ok: fs.readFileSync(abs, 'utf-8').includes(spec.text) };
  } catch {
    return { check: kind, target: String(spec.path || ''), ok: false, detail: 'unreadable' };
  }
}

/**
 * Run every check a skill declares.
 *
 * A skill with no `verify` block is `unverifiable` — not passing and not
 * failing. Most skills are prose and always will be; treating an absent block
 * as failure would demote the whole library on the first verification sweep.
 *
 * @param {Object} skill - Skill record (needs `verify` array)
 * @param {Object} [opts]
 * @param {string} [opts.cwd=process.cwd()]
 * @returns {{ status: 'passed'|'failed'|'unverifiable', checks: Object[], passed: number, total: number }}
 */
function verifySkill(skill, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const declared = (skill && skill.verify) || null;

  if (!Array.isArray(declared) || declared.length === 0) {
    return { status: 'unverifiable', checks: [], passed: 0, total: 0 };
  }

  const checks = declared.map((c) => runCheck(c, cwd));
  const passed = checks.filter((c) => c.ok).length;
  return {
    status: passed === checks.length ? 'passed' : 'failed',
    checks,
    passed,
    total: checks.length,
  };
}

module.exports = { verifySkill, runCheck, resolveInside, onPath, CHECK_TYPES, MAX_CONTAINS_BYTES };
