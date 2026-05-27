const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getBrainDir, readSkillsIndex, writeConfig } = require('../src/index-manager');
const {
  addSkill, listSkills, showSkill, useSkill, removeSkill, advertisedSummaries,
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
