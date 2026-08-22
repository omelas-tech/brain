const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');

let tmpDir;
let brainDir;
let env;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-recallhist-'));
  brainDir = path.join(tmpDir, '.brain');
  fs.mkdirSync(brainDir, { recursive: true });
  fs.writeFileSync(path.join(brainDir, 'index.json'), JSON.stringify({ version: 1, memories: {} }));
  fs.writeFileSync(path.join(brainDir, 'associations.json'), JSON.stringify({ version: 1, edges: {} }));
  env = { ...process.env, BRAIN_DIR: brainDir };
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(script, args, input) {
  return execFileSync('node', [path.join(REPO, 'bin', script), ...args], {
    env, input, encoding: 'utf-8',
  });
}

function seedOne() {
  run('memorize.js', [], JSON.stringify({
    memories: [{
      title: 'Decay test', type: 'learning', path: 'personal/learning/decay.md',
      content: 'A memory to reinforce.', tags: ['decay', 'test'], origin: 'user',
    }],
  }));
  const idx = JSON.parse(fs.readFileSync(path.join(brainDir, 'index.json'), 'utf-8'));
  return Object.keys(idx.memories)[0];
}

describe('reinforce: recall history', () => {
  it('appends a row per reinforcement with the interval and strength delta', () => {
    // access_count says a memory was recalled N times but never WHEN. The
    // interval is the entire signal that spaced reinforcement rests on, and
    // the only thing decay constants can be fitted against.
    const id = seedOne();
    run('reinforce.js', [id]);
    run('reinforce.js', [id]);

    const idx = JSON.parse(fs.readFileSync(path.join(brainDir, 'index.json'), 'utf-8'));
    const entry = idx.memories[id];
    assert.equal(entry.access_count, 2);
    assert.equal(entry.recall_history.length, 2);
    for (const row of entry.recall_history) {
      assert.match(row.at, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(typeof row.days_since_last, 'number');
      assert.equal(typeof row.strength_before, 'number');
      assert.equal(typeof row.strength_after, 'number');
    }
    assert.ok(entry.recall_history[1].strength_after > entry.recall_history[0].strength_after);
  });

  it('writes recall_history to frontmatter as valid JSON, not [object Object]', () => {
    const id = seedOne();
    run('reinforce.js', [id]);

    const file = fs.readFileSync(path.join(brainDir, 'personal/learning/decay.md'), 'utf-8');
    const line = file.match(/^recall_history: (.*)$/m);
    assert.ok(line, 'recall_history line present in frontmatter');
    assert.equal(line[1].includes('[object Object]'), false);
    const parsed = JSON.parse(line[1]);   // JSON is a YAML subset — must round-trip
    assert.equal(Array.isArray(parsed), true);
    assert.equal(parsed.length, 1);
  });
});
