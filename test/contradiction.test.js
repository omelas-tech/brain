const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { writeIndex } = require('../src/index-manager');

const MEMORIZE = path.join(__dirname, '..', 'bin', 'memorize.js');

let tmpDir;
function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-conflict-'));
  fs.mkdirSync(path.join(tmpDir, '.brain'), { recursive: true });
}
function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function runMemorize(payload) {
  const out = execFileSync('node', [MEMORIZE], {
    input: JSON.stringify(payload),
    // Set both HOME (Linux/macOS) and USERPROFILE (Windows) so os.homedir()
    // resolves to the temp brain dir on every platform.
    env: { ...process.env, HOME: tmpDir, USERPROFILE: tmpDir },
    encoding: 'utf-8',
  });
  return JSON.parse(out);
}

describe('memorize contradiction surfacing (Tier B §10.2)', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('flags potential_conflicts against a pinned memory with overlapping tags', () => {
    writeIndex({
      version: '2.0', memory_count: 1, last_updated: new Date().toISOString(),
      memories: {
        mem_pin: {
          title: 'Use tabs', path: 'p.md', type: 'preference', cognitive_type: 'semantic',
          created: new Date().toISOString(), last_accessed: new Date().toISOString(),
          access_count: 0, strength: 0.6, decay_rate: 0.998, salience: 0.5, confidence: 0.9,
          tags: ['tabs', 'style'], related: [], encoding_context: {}, token_estimate: 5,
          pinned: true, pin_scope: 'global', pin_priority: 0,
        },
      },
    }, tmpDir);

    const result = runMemorize({
      memories: [{
        title: 'Use spaces', type: 'preference', cognitive_type: 'semantic',
        path: 'professional/conventions/spaces.md', tags: ['tabs', 'style'],
        content: 'Always use spaces, never tabs.',
      }],
    });

    assert.equal(result.stored.length, 1);
    assert.ok(result.stored[0].potential_conflicts, 'should flag a conflict');
    assert.equal(result.stored[0].potential_conflicts[0].id, 'mem_pin');
  });

  it('does not flag when the overlapping memory is neither pinned nor stable', () => {
    writeIndex({
      version: '2.0', memory_count: 1, last_updated: new Date().toISOString(),
      memories: {
        mem_plain: {
          title: 'Tabs note', path: 'p.md', type: 'observation', cognitive_type: 'semantic',
          created: new Date().toISOString(), last_accessed: new Date().toISOString(),
          access_count: 0, strength: 0.4, decay_rate: 0.95, salience: 0.3, confidence: 0.7,
          tags: ['tabs', 'style'], related: [], encoding_context: {}, token_estimate: 5,
        },
      },
    }, tmpDir);

    const result = runMemorize({
      memories: [{
        title: 'Use spaces', type: 'preference', cognitive_type: 'semantic',
        path: 'professional/conventions/spaces.md', tags: ['tabs', 'style'],
        content: 'Always use spaces.',
      }],
    });
    assert.equal(result.stored[0].potential_conflicts, undefined);
  });
});
