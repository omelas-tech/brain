const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  cleanPromptText,
  userTextFrom,
  selectPrompts,
  dedupePrompts,
  truncate,
  slugToPathGuess,
  readJsonl,
  readImportState,
  markImported,
  importStatePath,
  SOURCES,
} = require('../src/harvest');

const { normalizeSince, parseArgs } = require('../bin/import');

let tmpDir;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-harvest-'));
  fs.mkdirSync(path.join(tmpDir, '.brain'), { recursive: true });
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('cleanPromptText', () => {
  it('strips system-reminder blocks', () => {
    const raw = 'do the thing <system-reminder>secret harness text</system-reminder> please';
    assert.equal(cleanPromptText(raw), 'do the thing please');
  });

  it('strips slash-command wrapper tags and their contents', () => {
    const raw = '<command-name>/brain:memorize</command-name><command-args>x</command-args>';
    assert.equal(cleanPromptText(raw), '');
  });

  it('strips local command output', () => {
    const raw = 'ran it <local-command-stdout>1000 lines of build log</local-command-stdout>';
    assert.equal(cleanPromptText(raw), 'ran it');
  });

  it('strips image placeholders but keeps surrounding intent', () => {
    assert.equal(cleanPromptText('[Image #1] make this page match'), 'make this page match');
  });

  it('drops bare acknowledgements as noise', () => {
    for (const noise of ['yes', 'ok', 'thanks', 'go ahead', 'yep!']) {
      assert.equal(cleanPromptText(noise), '', `expected "${noise}" to be dropped`);
    }
  });

  it('keeps a short prompt that carries real intent', () => {
    assert.equal(cleanPromptText('use tabs not spaces'), 'use tabs not spaces');
  });

  it('drops a bare slash-command invocation', () => {
    assert.equal(cleanPromptText('/brain:status'), '');
  });

  it('collapses whitespace', () => {
    assert.equal(cleanPromptText('a\n\n  b\t c'), 'a b c');
  });

  it('handles non-string input', () => {
    assert.equal(cleanPromptText(null), '');
    assert.equal(cleanPromptText(undefined), '');
    assert.equal(cleanPromptText(42), '');
  });
});

describe('userTextFrom', () => {
  it('reads a bare string content field', () => {
    assert.equal(userTextFrom({ message: { content: 'hello there' } }), 'hello there');
  });

  it('reads text blocks from an array content field', () => {
    const record = { message: { content: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }] } };
    assert.equal(userTextFrom(record), 'first second');
  });

  it('ignores tool_result blocks — those are command output, not user speech', () => {
    const record = {
      message: {
        content: [
          { type: 'tool_result', content: 'exit code 0' },
          { type: 'text', text: 'now deploy it' },
        ],
      },
    };
    assert.equal(userTextFrom(record), 'now deploy it');
  });

  it('ignores image blocks', () => {
    const record = {
      message: { content: [{ type: 'image', source: { data: 'base64...' } }, { type: 'text', text: 'match this' }] },
    };
    assert.equal(userTextFrom(record), 'match this');
  });

  it('returns empty for a tool-result-only record', () => {
    assert.equal(userTextFrom({ message: { content: [{ type: 'tool_result', content: 'ok' }] } }), '');
  });

  it('survives malformed records', () => {
    assert.equal(userTextFrom(null), '');
    assert.equal(userTextFrom({}), '');
    assert.equal(userTextFrom({ message: {} }), '');
    assert.equal(userTextFrom({ message: { content: 7 } }), '');
  });
});

describe('dedupePrompts', () => {
  it('removes repeated prompts', () => {
    assert.deepEqual(dedupePrompts(['a', 'b', 'a']), ['a', 'b']);
  });

  it('treats prompts sharing a long prefix as duplicates', () => {
    const long = 'x'.repeat(200);
    assert.deepEqual(dedupePrompts([long + 'A', long + 'B']), [long + 'A']);
  });

  it('is case-insensitive', () => {
    assert.deepEqual(dedupePrompts(['Fix It', 'fix it']), ['Fix It']);
  });
});

describe('selectPrompts', () => {
  it('returns everything when under the cap', () => {
    assert.deepEqual(selectPrompts(['a', 'b'], 6), ['a', 'b']);
  });

  it('keeps both edges, because the opening states the goal and the end states the outcome', () => {
    const prompts = ['start', 'm1', 'm2', 'm3', 'm4', 'end'];
    const picked = selectPrompts(prompts, 4);
    assert.equal(picked.length, 4);
    assert.equal(picked[0], 'start');
    assert.equal(picked[picked.length - 1], 'end');
  });
});

describe('truncate', () => {
  it('leaves short text alone', () => {
    assert.equal(truncate('short', 100), 'short');
  });

  it('cuts on a word boundary and marks the elision', () => {
    const out = truncate('alpha beta gamma delta', 14);
    assert.ok(out.endsWith('…'));
    assert.ok(!out.includes('delta'));
    assert.ok(out.length <= 15);
  });
});

describe('slugToPathGuess', () => {
  it('recovers a plausible path from a project slug', () => {
    assert.equal(slugToPathGuess('-Users-me-code-app'), '/Users/me/code/app');
  });

  it('passes through anything not slug-shaped', () => {
    assert.equal(slugToPathGuess('plain'), 'plain');
    assert.equal(slugToPathGuess(''), null);
  });
});

describe('readJsonl', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('parses valid lines', () => {
    const file = path.join(tmpDir, 'a.jsonl');
    fs.writeFileSync(file, '{"a":1}\n{"b":2}\n');
    assert.deepEqual(readJsonl(file), [{ a: 1 }, { b: 2 }]);
  });

  it('skips a truncated trailing line rather than failing the session', () => {
    const file = path.join(tmpDir, 'b.jsonl');
    fs.writeFileSync(file, '{"a":1}\n{"b":2\n');
    assert.deepEqual(readJsonl(file), [{ a: 1 }]);
  });

  it('returns empty for a missing file', () => {
    assert.deepEqual(readJsonl(path.join(tmpDir, 'nope.jsonl')), []);
  });
});

describe('claude-code adapter', () => {
  beforeEach(setup);
  afterEach(teardown);

  function writeSession(projectSlug, sessionId, records) {
    const dir = path.join(tmpDir, 'projects', projectSlug);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${sessionId}.jsonl`);
    fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return file;
  }

  it('extracts title, cwd, branch, prompts, and edited files', () => {
    const file = writeSession('-Users-me-code-app', 'sess-1', [
      { type: 'ai-title', aiTitle: 'Add auth', sessionId: 'sess-1' },
      { type: 'system', cwd: '/Users/me/code/app', gitBranch: 'main', timestamp: '2026-01-01T00:00:00.000Z' },
      { type: 'user', message: { role: 'user', content: 'add oauth login' } },
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-5',
          content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/Users/me/code/app/auth.ts' } }],
        },
      },
      { type: 'user', message: { role: 'user', content: 'use google as the provider' } },
    ]);

    const session = SOURCES['claude-code'].parse(file);
    assert.equal(session.title, 'Add auth');
    assert.equal(session.cwd, '/Users/me/code/app');
    assert.equal(session.git_branch, 'main');
    assert.equal(session.turns, 1);
    assert.deepEqual(session.prompts, ['add oauth login', 'use google as the provider']);
    assert.deepEqual([...session.files_touched], ['/Users/me/code/app/auth.ts']);
    assert.deepEqual([...session.models], ['claude-opus-5']);
  });

  it('excludes sidechain records — subagent traffic is not the user talking', () => {
    const file = writeSession('-Users-me-code-app', 'sess-2', [
      { type: 'user', message: { content: 'real prompt' } },
      { type: 'user', isSidechain: true, message: { content: 'subagent instruction' } },
      { type: 'assistant', isSidechain: true, message: { model: 'x', content: [] } },
    ]);
    const session = SOURCES['claude-code'].parse(file);
    assert.deepEqual(session.prompts, ['real prompt']);
    assert.equal(session.turns, 0, 'sidechain assistant turns should not count');
  });

  it('excludes isMeta records', () => {
    const file = writeSession('-Users-me-code-app', 'sess-3', [
      { type: 'user', isMeta: true, message: { content: 'harness injected' } },
      { type: 'user', message: { content: 'genuine ask' } },
    ]);
    assert.deepEqual(SOURCES['claude-code'].parse(file).prompts, ['genuine ask']);
  });

  it('falls back to the slug when no record carries a cwd', () => {
    const file = writeSession('-Users-me-code-app', 'sess-4', [{ type: 'user', message: { content: 'hi there' } }]);
    assert.equal(SOURCES['claude-code'].parse(file).cwd, '/Users/me/code/app');
  });

  it('falls back to the filename when no record carries a sessionId', () => {
    const file = writeSession('-Users-me-code-app', 'sess-5', [{ type: 'user', message: { content: 'hi there' } }]);
    assert.equal(SOURCES['claude-code'].parse(file).session_id, 'sess-5');
  });

  it('ignores nested subagent directories', () => {
    writeSession('-Users-me-code-app', 'sess-6', [{ type: 'user', message: { content: 'top level' } }]);
    const nested = path.join(tmpDir, 'projects', '-Users-me-code-app', 'sess-6', 'subagents');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'agent-x.jsonl'), '{"type":"user"}\n');

    const files = SOURCES['claude-code'].listFiles(path.join(tmpDir, 'projects'));
    assert.equal(files.length, 1);
    assert.ok(files[0].endsWith('sess-6.jsonl'));
  });

  it('returns null for an empty transcript', () => {
    const file = writeSession('-Users-me-code-app', 'sess-7', []);
    fs.writeFileSync(file, '');
    assert.equal(SOURCES['claude-code'].parse(file), null);
  });

  it('returns no files when the history root is absent', () => {
    assert.deepEqual(SOURCES['claude-code'].listFiles(path.join(tmpDir, 'does-not-exist')), []);
  });
});

describe('import state', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('starts empty', () => {
    const state = readImportState(tmpDir);
    assert.equal(state.version, 1);
    assert.deepEqual(state.sources, {});
  });

  it('records marked sessions and is idempotent', () => {
    const known = new Set(['a', 'b', 'c']);
    const first = markImported('claude-code', ['a', 'b'], tmpDir, known);
    assert.equal(first.added, 2);
    assert.equal(first.total, 2);
    assert.deepEqual(first.unknown, []);

    const second = markImported('claude-code', ['b', 'c'], tmpDir, known);
    assert.equal(second.added, 1, 'already-marked ids should not re-count');
    assert.equal(second.total, 3);

    const state = readImportState(tmpDir);
    assert.deepEqual(Object.keys(state.sources['claude-code'].imported).sort(), ['a', 'b', 'c']);
  });

  it('refuses ids that match no real session, so a typo cannot silently retire one', () => {
    const known = new Set(['real-session-id']);
    const result = markImported('claude-code', ['real-session-id', 'typo'], tmpDir, known);

    assert.deepEqual(result.unknown, ['typo']);
    assert.equal(result.added, 1);
    assert.equal(result.total, 1);

    const state = readImportState(tmpDir);
    assert.deepEqual(Object.keys(state.sources['claude-code'].imported), ['real-session-id']);
  });

  it('accepts ids as given when the source history cannot be enumerated', () => {
    // No adapter for 'codex' yet, so there is nothing to validate against —
    // rejecting on no evidence would be worse than accepting.
    const result = markImported('codex', ['whatever'], tmpDir);
    assert.deepEqual(result.unknown, []);
    assert.equal(result.added, 1);
  });

  it('recovers from a corrupt state file instead of throwing', () => {
    const file = importStatePath(tmpDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not json');
    const state = readImportState(tmpDir);
    assert.deepEqual(state.sources, {});
  });

  it('keeps sources independent', () => {
    markImported('claude-code', ['a'], tmpDir);
    markImported('codex', ['a'], tmpDir);
    const state = readImportState(tmpDir);
    assert.deepEqual(Object.keys(state.sources).sort(), ['claude-code', 'codex']);
  });
});

describe('normalizeSince', () => {
  it('resolves relative day/month/year shorthand', () => {
    for (const input of ['30d', '6m', '1y']) {
      const out = normalizeSince(input);
      assert.ok(out, `${input} should parse`);
      assert.ok(new Date(out).getTime() < Date.now());
    }
  });

  it('accepts an absolute date', () => {
    assert.ok(normalizeSince('2026-01-01').startsWith('2026-01-01'));
  });

  it('returns null for junk and for absent input', () => {
    assert.equal(normalizeSince('not-a-date'), null);
    assert.equal(normalizeSince(null), null);
  });
});

describe('import arg parsing', () => {
  it('collects multiple ids after --mark without swallowing later flags', () => {
    const args = parseArgs(['--mark', 'a', 'b', 'c', '--source', 'claude-code']);
    assert.deepEqual(args.mark, ['a', 'b', 'c']);
    assert.equal(args.source, 'claude-code');
  });

  it('defaults to the claude-code source', () => {
    assert.equal(parseArgs([]).source, 'claude-code');
  });

  it('parses scoping flags', () => {
    const args = parseArgs(['--project', 'brain', '--since', '30d', '--limit', '5', '--all']);
    assert.equal(args.project, 'brain');
    assert.equal(args.since, '30d');
    assert.equal(args.limit, 5);
    assert.equal(args.all, true);
  });
});
