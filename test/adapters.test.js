const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const A = require('../src/adapters');
const { initializeBrain } = require('../src/installer');
const { readIndex } = require('../src/index-manager');

const MEMS = [
  { id: 'm1', title: 'Orders database', type: 'decision', content: 'Postgres behind pgbouncer in transaction mode.\nMongo was dropped.', tags: ['db'], created: '2026-09-02T10:00:00.000Z', origin: 'user' },
  { id: 'm2', title: 'Error format', type: 'preference', content: 'Handlers return RFC 7807 problem+json.', tags: [], created: '2026-08-01T00:00:00.000Z', origin: 'user' },
  { id: 'm3', title: 'Error format', type: 'relationship', content: 'Ayla owns the payments API.', tags: [], created: '2026-07-01T00:00:00.000Z', origin: 'user' },
];

describe('adapters: claude-memory', () => {
  it('writes one file per memory plus a MEMORY.md index, with unique names', () => {
    const { files } = A.toClaudeMemory(MEMS);
    assert.deepEqual(Object.keys(files).sort(), ['MEMORY.md', 'error-format-2.md', 'error-format.md', 'orders-database.md']);
    assert.match(files['MEMORY.md'], /- \[Orders database\]\(orders-database\.md\)/);
    assert.match(files['error-format.md'], /^---\nname: error-format\ndescription: "Error format"\nmetadata:\n  type: feedback\n---/);
  });

  it('round-trips title and content; type is mapped (FIDELITY)', () => {
    const back = A.fromClaudeMemory(A.toClaudeMemory(MEMS).files);
    assert.equal(back.length, 3);
    const db = back.find((m) => m.title === 'Orders database');
    assert.equal(db.content, MEMS[0].content);
    assert.equal(db.type, 'decision');
    assert.equal(back.find((m) => m.content.includes('7807')).type, 'preference');
    assert.equal(A.FIDELITY['claude-memory'].type, 'mapped');
  });
});

describe('adapters: markdown', () => {
  it('writes dated lines and reads them back', () => {
    const { text } = A.toMarkdown(MEMS);
    assert.match(text, /^\[2026-09-02\] - Orders database: Postgres behind pgbouncer in transaction mode\. Mongo was dropped\.$/m);
    const back = A.fromMarkdown(text);
    assert.equal(back[0].title, 'Orders database');
    assert.equal(back[0].saved, '2026-09-02');
    assert.equal(back[0].valid_from, undefined, 'a saved date is record time, never valid time');
  });

  it('reads a Claude.ai-style paste, including undated and bulleted lines', () => {
    const back = A.fromMarkdown('# My memories\n[2026-01-05] - Prefers dark mode\n- Works at Omelas: founder\n\n');
    assert.deepEqual(back.map((m) => m.title), ['Prefers dark mode', 'Works at Omelas']);
  });
});

describe('adapters: agentcore', () => {
  it('builds BatchCreateMemoryRecords bodies of at most 100 records', () => {
    const many = Array.from({ length: 205 }, (_, i) => ({ ...MEMS[0], id: `m${i}` }));
    const { batches } = A.toAgentCore(many);
    assert.deepEqual(batches.map((b) => b.records.length), [100, 100, 5]);
    const r = batches[0].records[0];
    assert.equal(r.requestIdentifier, 'm0');
    assert.deepEqual(r.namespaces, ['/brain/decision']);
    assert.equal(r.timestamp, Date.parse('2026-09-02T10:00:00.000Z') / 1000);
  });

  it('truncates text past 16,000 characters and reports it', () => {
    const { batches, truncated } = A.toAgentCore([{ ...MEMS[0], content: 'x'.repeat(20000) }]);
    assert.equal(batches[0].records[0].content.text.length, 16000);
    assert.equal(truncated, 1);
  });

  it('round-trips title, content and type; reads list summaries too', () => {
    const back = A.fromAgentCore(A.toAgentCore(MEMS));
    assert.equal(back[0].title, 'Orders database');
    assert.equal(back[0].content, MEMS[0].content);
    assert.equal(back[0].type, 'decision');
    const listed = A.fromAgentCore({ memoryRecordSummaries: [{ content: { text: 'Uses Fly.io' }, namespaces: ['/x/y'], createdAt: '2026-03-01T00:00:00Z' }] });
    assert.deepEqual(listed[0], { title: 'Uses Fly.io', type: 'learning', content: 'Uses Fly.io', tags: [], saved: '2026-03-01' });
  });
});

describe('brain port CLI', () => {
  let tmp;
  let brainDir;
  const PORT = path.join(__dirname, '..', 'bin', 'port.js');
  const MEMORIZE = path.join(__dirname, '..', 'bin', 'memorize.js');
  const env = () => ({ ...process.env, HOME: tmp, BRAIN_DIR: brainDir });
  const run = (args) => JSON.parse(execFileSync(process.execPath, [PORT, ...args], { env: env(), encoding: 'utf-8' }));

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-port-'));
    brainDir = path.join(tmp, '.brain');
    initializeBrain(tmp);
    execFileSync(process.execPath, [MEMORIZE], {
      env: env(),
      input: JSON.stringify({ memories: [
        { title: 'Orders database', type: 'decision', cognitive_type: 'semantic', path: 'professional/db.md', content: 'Postgres via pgbouncer.', origin: 'user' },
        { title: 'Vendor email claim', type: 'observation', cognitive_type: 'episodic', path: 'professional/inbox/v.md', content: 'The vendor moved offices.', origin: 'external' },
      ] }),
    });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('exports only what recall could show, and says what it skipped', () => {
    const out = path.join(tmp, 'claude-mem');
    const r = run(['export', '--format', 'claude-memory', '--out', out]);
    assert.equal(r.exported, 1);
    assert.equal(r.skipped.pending_verification, 1);
    assert.ok(fs.existsSync(path.join(out, 'orders-database.md')));
  });

  it('imports as external and pending, or as user with --trust', () => {
    const out = path.join(tmp, 'claude-mem');
    run(['export', '--format', 'claude-memory', '--out', out]);
    const before = Object.keys(readIndex(tmp).memories).length;

    const r = run(['import', '--from', 'claude-memory', out]);
    assert.equal(r.imported, 1);
    assert.equal(r.pending_verification, 1);
    assert.equal(readIndex(tmp).memories[r.ids[0]].origin, 'external');

    const t = run(['import', '--from', 'claude-memory', out, '--trust']);
    assert.equal(t.pending_verification, 0);
    assert.equal(Object.keys(readIndex(tmp).memories).length, before + 2);
  });

  it('--dry-run writes nothing', () => {
    const file = path.join(tmp, 'paste.txt');
    fs.writeFileSync(file, '[2026-01-05] - Prefers dark mode\n');
    const before = Object.keys(readIndex(tmp).memories).length;
    const r = run(['import', '--from', 'markdown', file, '--dry-run']);
    assert.equal(r.would_import, 1);
    assert.match(r.memories[0].source, /saved 2026-01-05/);
    assert.equal(Object.keys(readIndex(tmp).memories).length, before);
  });
});
