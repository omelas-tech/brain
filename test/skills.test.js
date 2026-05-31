const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getBrainDir, readSkillsIndex, writeConfig } = require('../src/index-manager');
const {
  addSkill, listSkills, showSkill, useSkill, removeSkill, advertisedSummaries, exportSkill,
} = require('../src/skills');
const { computeSessionStart } = require('../bin/session-start');

let tmpDir;
function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-skill-'));
  fs.mkdirSync(path.join(tmpDir, '.brain'), { recursive: true });
}
function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('skills CRUD', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('add creates a SKILL.md and an index entry', () => {
    const r = addSkill(tmpDir, {
      name: 'Structured Code Review',
      description: 'Review a PR systematically',
      triggers: ['review'],
      body: '## Steps\n1. read',
    });
    assert.equal(r.added, true);
    assert.equal(r.name, 'structured-code-review');

    const file = path.join(getBrainDir(tmpDir), '_skills/structured-code-review/SKILL.md');
    assert.ok(fs.existsSync(file));
    assert.ok(fs.readFileSync(file, 'utf-8').includes('cognitive_type: procedural'));

    const idx = readSkillsIndex(tmpDir);
    assert.equal(idx.skills.length, 1);
    assert.equal(idx.skills[0].description, 'Review a PR systematically');
  });

  it('show returns the full body; missing → error', () => {
    addSkill(tmpDir, { name: 'foo', description: 'd', body: 'BODYTEXT' });
    assert.ok(showSkill(tmpDir, 'foo').content.includes('BODYTEXT'));
    assert.ok(showSkill(tmpDir, 'nope').error);
  });

  it('use success strengthens; --failed weakens', () => {
    addSkill(tmpDir, { name: 'foo', description: 'd', strength: 0.6 });
    const ok = useSkill(tmpDir, 'foo');
    assert.equal(ok.use_count, 1);
    assert.ok(ok.strength > 0.6);
    const bad = useSkill(tmpDir, 'foo', { failed: true });
    assert.equal(bad.fail_count, 1);
    assert.ok(bad.strength < ok.strength);
  });

  it('a skill that fails too often is demoted out of L0 (Tier B §10.3)', () => {
    addSkill(tmpDir, { name: 'flaky', description: 'd' });
    useSkill(tmpDir, 'flaky');                 // 1 use, 0 fail
    useSkill(tmpDir, 'flaky', { failed: true }); // 2 use, 1 fail
    useSkill(tmpDir, 'flaky', { failed: true }); // 3 use, 2 fail → 0.66 > 0.5
    assert.equal(advertisedSummaries(tmpDir).find((s) => s.name === 'flaky'), undefined);
    assert.ok(listSkills(tmpDir).find((s) => s.name === 'flaky'), 'still on disk / in full list');
  });

  it('remove deletes the dir and the index entry', () => {
    addSkill(tmpDir, { name: 'foo', description: 'd' });
    assert.equal(removeSkill(tmpDir, 'foo').removed, true);
    assert.equal(readSkillsIndex(tmpDir).skills.length, 0);
    assert.ok(!fs.existsSync(path.join(getBrainDir(tmpDir), '_skills/foo')));
  });

  it('export writes the skill into the host native format (Phase 4)', () => {
    addSkill(tmpDir, { name: 'foo', description: 'd', body: 'EXPORTED' });
    const destRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-host-'));
    try {
      const r = exportSkill(tmpDir, 'foo', 'claude', destRoot);
      assert.equal(r.target, 'claude');
      const out = path.join(destRoot, '.claude', 'skills', 'foo', 'SKILL.md');
      assert.ok(fs.existsSync(out));
      assert.ok(fs.readFileSync(out, 'utf-8').includes('EXPORTED'));
      assert.ok(exportSkill(tmpDir, 'foo', 'bogus', destRoot).error);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });
});

describe('session-start skills index (L0)', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('advertises name + description only, budget-capped', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.brain', 'index.json'),
      JSON.stringify({ version: '2.0', memory_count: 0, memories: {} })
    );
    writeConfig({ skills_index_budget_tokens: 5 }, tmpDir);
    addSkill(tmpDir, { name: 'a', description: 'do a', body: 'steps' });
    addSkill(tmpDir, { name: 'b', description: 'do b', body: 'steps' });

    const p = computeSessionStart(tmpDir, {});
    assert.ok(p.skills_index.length >= 1);
    // L0 carries only name + description — never the body
    assert.ok('name' in p.skills_index[0] && 'description' in p.skills_index[0]);
    assert.equal(p.skills_index[0].body, undefined);
    assert.ok(p.budget.skills_tokens <= 5, 'within skills budget');
  });
});

// ===========================================================================
// Edge cases & error handling
// ===========================================================================
const { slug, isAdvertised } = require('../src/skills');

describe('skills slug normalization', () => {
  it('lowercases, collapses non-alphanumerics, trims dashes', () => {
    assert.equal(slug('Structured Code Review!'), 'structured-code-review');
    assert.equal(slug('  --Foo__Bar--  '), 'foo-bar');
    assert.equal(slug('API v2.0'), 'api-v2-0');
  });
  it('returns empty string for empty/nullish input', () => {
    assert.equal(slug(''), '');
    assert.equal(slug(null), '');
    assert.equal(slug(undefined), '');
    assert.equal(slug('!!!'), '');
  });
});

describe('addSkill validation & replacement', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('rejects a missing/blank name with an error and writes nothing', () => {
    assert.ok(addSkill(tmpDir, {}).error);
    assert.ok(addSkill(tmpDir, { name: '   ' }).error);
    assert.ok(addSkill(tmpDir, { name: '!!!' }).error);
    assert.equal(readSkillsIndex(tmpDir).skills.length, 0);
  });

  it('re-adding the same name replaces (no duplicate index entries) and resets counters', () => {
    addSkill(tmpDir, { name: 'Deploy', description: 'v1', body: 'old' });
    useSkill(tmpDir, 'deploy'); // bump use_count to 1
    addSkill(tmpDir, { name: 'deploy', description: 'v2', body: 'new' });
    const idx = readSkillsIndex(tmpDir);
    assert.equal(idx.skills.filter((s) => s.name === 'deploy').length, 1);
    assert.equal(idx.skills[0].description, 'v2');
    assert.equal(idx.skills[0].use_count, 0, 'counters reset on replace');
    assert.ok(showSkill(tmpDir, 'deploy').content.includes('new'));
  });

  it('persists triggers and strength into the SKILL.md frontmatter', () => {
    addSkill(tmpDir, { name: 'x', description: 'd', triggers: ['a', 'b'], strength: 0.8, body: 'B' });
    const fm = fs.readFileSync(path.join(getBrainDir(tmpDir), '_skills/x/SKILL.md'), 'utf-8');
    assert.ok(fm.includes('triggers: ["a", "b"]'));
    assert.ok(fm.includes('strength: 0.8'));
    assert.ok(fm.includes('cognitive_type: procedural'));
  });
});

describe('isAdvertised demotion threshold (Tier B §10.3)', () => {
  it('advertises until 3 uses regardless of failures', () => {
    assert.equal(isAdvertised({ use_count: 2, fail_count: 2 }), true, 'under the 3-use floor');
  });
  it('keeps advertising at exactly 50% failure (strictly > 0.5 demotes)', () => {
    assert.equal(isAdvertised({ use_count: 4, fail_count: 2 }), true);  // 0.5, not > 0.5
    assert.equal(isAdvertised({ use_count: 3, fail_count: 2 }), false); // 0.66 > 0.5
  });
  it('treats missing counters as zero', () => {
    assert.equal(isAdvertised({}), true);
  });
});

describe('useSkill clamping, persistence & errors', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('errors on an unknown skill', () => {
    assert.ok(useSkill(tmpDir, 'ghost').error);
  });

  it('strength floors at 0 after repeated failures and never goes negative', () => {
    addSkill(tmpDir, { name: 'f', description: 'd', strength: 0.15 });
    let last;
    for (let i = 0; i < 5; i++) last = useSkill(tmpDir, 'f', { failed: true });
    assert.ok(last.strength >= 0, 'never negative');
    assert.equal(last.strength, 0);
    assert.equal(last.fail_count, 5);
  });

  it('strength rises toward but never exceeds 1.0 on repeated success', () => {
    addSkill(tmpDir, { name: 's', description: 'd', strength: 0.9 });
    let last;
    for (let i = 0; i < 50; i++) last = useSkill(tmpDir, 's');
    assert.ok(last.strength <= 1.0);
    assert.ok(last.strength > 0.9);
  });

  it('writes updated counters/strength back into the SKILL.md frontmatter', () => {
    addSkill(tmpDir, { name: 'p', description: 'd' });
    useSkill(tmpDir, 'p', { failed: true });
    const fm = fs.readFileSync(path.join(getBrainDir(tmpDir), '_skills/p/SKILL.md'), 'utf-8');
    assert.ok(fm.includes('use_count: 1'));
    assert.ok(fm.includes('fail_count: 1'));
    assert.ok(/last_used: "20\d\d-/.test(fm), 'last_used timestamp recorded');
  });
});

describe('showSkill / exportSkill / removeSkill edges', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('showSkill normalizes the name before lookup', () => {
    addSkill(tmpDir, { name: 'Deploy Steps', description: 'd', body: 'CONTENT' });
    assert.ok(showSkill(tmpDir, 'Deploy Steps').content.includes('CONTENT'));
    assert.ok(showSkill(tmpDir, 'deploy-steps').content.includes('CONTENT'));
  });

  it('exportSkill supports the gemini target and propagates a missing-skill error', () => {
    addSkill(tmpDir, { name: 'g', description: 'd', body: 'GEM' });
    const destRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-host-g-'));
    try {
      const r = exportSkill(tmpDir, 'g', 'gemini', destRoot);
      assert.equal(r.target, 'gemini');
      assert.ok(fs.existsSync(path.join(destRoot, '.gemini', 'skills', 'g', 'SKILL.md')));
      assert.ok(exportSkill(tmpDir, 'does-not-exist', 'claude', destRoot).error);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  it('removeSkill on an unknown skill leaves the index untouched', () => {
    addSkill(tmpDir, { name: 'keep', description: 'd' });
    removeSkill(tmpDir, 'never-existed');
    assert.equal(readSkillsIndex(tmpDir).skills.length, 1);
    assert.ok(listSkills(tmpDir).find((s) => s.name === 'keep'));
  });
});
