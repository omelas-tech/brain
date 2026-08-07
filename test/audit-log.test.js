const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { appendAudit, readAudit } = require('../src/audit');
const { writeIndex } = require('../src/index-manager');

const FORGET = path.join(__dirname, '..', 'bin', 'forget.js');

let tmpDir;
let brainDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-audit-'));
  brainDir = path.join(tmpDir, '.brain');
  fs.mkdirSync(brainDir, { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('audit: append/read round-trip', () => {
  it('appends JSONL and reads records back oldest-first', () => {
    appendAudit(brainDir, { ts: '2026-01-01T00:00:00Z', event: 'memorize', id: 'a' });
    appendAudit(brainDir, { ts: '2026-01-02T00:00:00Z', event: 'forget', id: 'b' });
    const records = readAudit(brainDir);
    assert.equal(records.length, 2);
    assert.equal(records[0].id, 'a');
    assert.equal(records[1].event, 'forget');
  });

  it('stamps ts when absent', () => {
    appendAudit(brainDir, { event: 'memorize', id: 'x' });
    const [rec] = readAudit(brainDir);
    assert.ok(rec.ts);
    assert.ok(!Number.isNaN(Date.parse(rec.ts)));
  });

  it('returns [] for a missing log', () => {
    assert.deepEqual(readAudit(brainDir), []);
  });

  it('skips a torn trailing line (crash mid-append)', () => {
    appendAudit(brainDir, { ts: '2026-01-01T00:00:00Z', event: 'memorize', id: 'a' });
    fs.appendFileSync(path.join(brainDir, 'audit.log'), '{"ts":"2026-01-02T00:');
    const records = readAudit(brainDir);
    assert.equal(records.length, 1);
    assert.equal(records[0].id, 'a');
  });

  it('filters by since and events, and limits to most recent', () => {
    appendAudit(brainDir, { ts: '2026-01-01T00:00:00Z', event: 'memorize', id: 'a' });
    appendAudit(brainDir, { ts: '2026-02-01T00:00:00Z', event: 'memorize', id: 'b' });
    appendAudit(brainDir, { ts: '2026-03-01T00:00:00Z', event: 'restore', id: 'c' });

    const since = readAudit(brainDir, { since: '2026-01-15T00:00:00Z' });
    assert.deepEqual(since.map((r) => r.id), ['b', 'c']);

    const events = readAudit(brainDir, { events: ['memorize'] });
    assert.deepEqual(events.map((r) => r.id), ['a', 'b']);

    const limited = readAudit(brainDir, { limit: 1 });
    assert.deepEqual(limited.map((r) => r.id), ['c']);
  });

  it('accepts a Date for since', () => {
    appendAudit(brainDir, { ts: '2026-01-01T00:00:00Z', event: 'memorize', id: 'a' });
    appendAudit(brainDir, { ts: '2026-06-01T00:00:00Z', event: 'memorize', id: 'b' });
    const records = readAudit(brainDir, { since: new Date('2026-03-01T00:00:00Z') });
    assert.deepEqual(records.map((r) => r.id), ['b']);
  });
});

describe('audit: forget now writes the trail', () => {
  it('archiving a memory appends a forget event', () => {
    const memPath = 'professional/notes/x.md';
    fs.mkdirSync(path.join(brainDir, 'professional/notes'), { recursive: true });
    fs.writeFileSync(path.join(brainDir, memPath), '---\nid: mem_1\n---\nbody\n');
    writeIndex({
      version: '2.0',
      memory_count: 1,
      memories: {
        mem_1: { title: 'X', path: memPath, type: 'observation', salience: 0.3, origin: 'external', tags: [] },
      },
    }, tmpDir);

    const stdout = execFileSync('node', [FORGET, 'mem_1'], {
      env: { ...process.env, BRAIN_DIR: brainDir },
      encoding: 'utf-8',
    });
    assert.equal(JSON.parse(stdout).archived, true);

    const records = readAudit(brainDir, { events: ['forget'] });
    assert.equal(records.length, 1);
    assert.equal(records[0].id, 'mem_1');
    assert.equal(records[0].origin, 'external');
    assert.equal(records[0].reason, 'forget');
    assert.equal(records[0].forced, false);
  });
});
