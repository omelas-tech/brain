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
  availableSources,
  harvest,
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
    // A source with no adapter has nothing to validate against — rejecting on
    // no evidence would be worse than accepting. Deliberately not 'codex': it
    // has an adapter now, which enumerates the real ~/.codex of whoever runs
    // the suite and rejects the made-up id on any machine with Codex history.
    const result = markImported('some-future-agent', ['whatever'], tmpDir);
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

// ===========================================================================
// codex adapter — $CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl
// ===========================================================================
describe('codex adapter', () => {
  beforeEach(setup);
  afterEach(teardown);

  const line = (type, payload, extra = {}) => JSON.stringify({ timestamp: '2026-09-03T14:05:12.345Z', type, payload, ...extra });
  const userMsg = (text, kinds = ['user.text']) => line('response_item', {
    type: 'message', role: 'user', content: [{ type: 'input_text', text }],
    internal_chat_message_metadata_passthrough: { content_item_kinds: kinds },
  });

  function writeRollout(name, lines, home = path.join(tmpDir, '.codex')) {
    const dir = path.join(home, 'sessions', '2026', '09', '03');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, lines.join('\n') + '\n');
    return file;
  }

  const META = line('session_meta', {
    id: 'thread-1', session_id: 'thread-1', cwd: '/Users/me/code/app', originator: 'codex_cli_rs',
    cli_version: '0.153.1', source: 'cli', thread_source: 'user', history_mode: 'paginated',
    git: { branch: 'main', commit_hash: 'abc' },
  }, { ordinal: 0 });

  it('reads prompts, cwd, branch, model, turns and patched files from a paginated rollout', () => {
    const file = writeRollout('rollout-2026-09-03T14-05-12-thread-1.jsonl', [
      META,
      line('turn_context', { cwd: '/Users/me/code/app', model: 'gpt-5.6-codex', approval_policy: 'on-request' }),
      userMsg('fix the failing test in auth.rs'),
      line('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'On it.' }] }),
      line('response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: 'c1', input: '*** Begin Patch\n*** Update File: src/auth.rs\n@@\n-a\n+b\n*** End Patch' }),
      line('response_item', { type: 'function_call', name: 'shell_command', arguments: '{"command":"cargo test"}', call_id: 'c2' }),
      userMsg('now add a regression test for it'),
      line('event_msg', { type: 'turn_complete', turn_id: 't1' }, { timestamp: '2026-09-03T14:09:00.000Z' }),
    ]);
    const session = SOURCES.codex.parse(file);
    assert.equal(session.source, 'codex');
    assert.equal(session.session_id, 'thread-1');
    assert.equal(session.cwd, '/Users/me/code/app');
    assert.equal(session.git_branch, 'main');
    assert.deepEqual([...session.models], ['gpt-5.6-codex']);
    assert.deepEqual(session.prompts, ['fix the failing test in auth.rs', 'now add a regression test for it']);
    assert.deepEqual([...session.files_touched], ['src/auth.rs']);
    assert.equal(session.turns, 1);
    assert.equal(session.started, '2026-09-03T14:05:12.345Z');
    assert.equal(session.ended, '2026-09-03T14:09:00.000Z');
    assert.equal(session.title, null);
  });

  it('ignores context Codex injects as user-role messages, by kind and by marker', () => {
    const file = writeRollout('rollout-2026-09-03T14-05-12-thread-1.jsonl', [
      META,
      userMsg('# AGENTS.md instructions for /app\n\n<INSTRUCTIONS>\nbe nice\n</INSTRUCTIONS>', ['agents_md.instructions']),
      userMsg('<environment_context>\n  <cwd>/app</cwd>\n</environment_context>', ['environments.environment_context']),
      // Pre-0.148 rollout: no passthrough at all → marker fallback.
      line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<user_instructions>\nold agents.md\n</user_instructions>' }] }),
      line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<turn_aborted>interrupted</turn_aborted>' }] }),
      line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<brain-context>\n- ◉ memory: "x"\n</brain-context>' }] }),
      line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'genuine old-format ask' }] }),
      userMsg('genuine new-format ask'),
      // Hook additionalContext arrives as a developer message, never as user text.
      line('response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'hook context' }] }),
    ]);
    assert.deepEqual(SOURCES.codex.parse(file).prompts, ['genuine old-format ask', 'genuine new-format ask']);
  });

  it('drops background threads: subagents, guardian reviews, memory consolidation', () => {
    const variants = [
      { thread_source: 'subagent', parent_thread_id: 'thread-0' },
      { thread_source: 'guardian_review' },
      { thread_source: 'memory_consolidation' },
      { source: { subagent: 'review' } },
      { source: { internal: 'memory_consolidation' } },
    ];
    variants.forEach((meta, i) => {
      const file = writeRollout(`rollout-2026-09-03T14-05-1${i}-bg-${i}.jsonl`, [
        line('session_meta', { id: `bg-${i}`, cwd: '/x', ...meta }),
        userMsg('a prompt that should never surface'),
      ]);
      assert.equal(SOURCES.codex.parse(file), null, JSON.stringify(meta));
    });
  });

  it('names sessions from session_index.jsonl, keyed by thread id even for reverted rollouts', () => {
    const home = path.join(tmpDir, '.codex');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'session_index.jsonl'), [
      JSON.stringify({ id: 'thread-9', thread_name: 'old name', updated_at: '2026-09-01T00:00:00Z' }),
      JSON.stringify({ id: 'thread-9', thread_name: 'Auth test fix', updated_at: '2026-09-02T00:00:00Z' }),
    ].join('\n') + '\n');
    const file = writeRollout('rollout-2026-09-03T14-05-12-thread-9_rollout-2.jsonl', [
      line('session_meta', { id: 'thread-9', cwd: '/x', thread_source: 'user' }),
      userMsg('first'), userMsg('second'),
    ], home);
    const session = SOURCES.codex.parse(file);
    assert.equal(session.session_id, 'thread-9_rollout-2');
    assert.equal(session.title, 'Auth test fix');
    assert.equal(SOURCES.codex.sessionIdFor(file), 'thread-9_rollout-2');
  });

  it('lists only rollout files exactly three date levels deep, skipping compressed ones', () => {
    const home = path.join(tmpDir, '.codex');
    const root = path.join(home, 'sessions');
    writeRollout('rollout-2026-09-03T14-05-12-a.jsonl', [META], home);
    writeRollout('rollout-2026-09-03T14-05-13-b.jsonl.zst', ['zstd'], home);
    writeRollout('notes.jsonl', ['{}'], home);
    fs.mkdirSync(path.join(root, '2026', '09'), { recursive: true });
    fs.writeFileSync(path.join(root, '2026', '09', 'rollout-2026-09-03T14-05-14-c.jsonl'), META + '\n');
    fs.mkdirSync(path.join(root, 'junk', '09', '03'), { recursive: true });
    fs.writeFileSync(path.join(root, 'junk', '09', '03', 'rollout-2026-09-03T14-05-15-d.jsonl'), META + '\n');
    const files = SOURCES.codex.listFiles(root).map((f) => path.basename(f));
    assert.deepEqual(files, ['rollout-2026-09-03T14-05-12-a.jsonl']);
    assert.deepEqual(SOURCES.codex.listFiles(path.join(tmpDir, 'missing')), []);
  });

  it('is discoverable through harvest() and honors the import cursor by rollout id', () => {
    const home = path.join(tmpDir, '.codex');
    const saved = process.env.CODEX_HOME;
    process.env.CODEX_HOME = home;
    try {
      writeRollout('rollout-2026-09-03T14-05-12-thread-1.jsonl', [META, userMsg('one thing'), userMsg('another thing')], home);
      const digest = harvest({ source: 'codex', projectRoot: tmpDir });
      assert.equal(digest.source, 'codex');
      assert.equal(digest.sessions.length, 1);
      assert.equal(digest.sessions[0].session_id, 'thread-1');
      const marked = markImported('codex', ['thread-1', 'nope'], tmpDir);
      assert.deepEqual(marked.unknown, ['nope']);
      assert.equal(harvest({ source: 'codex', projectRoot: tmpDir }).sessions.length, 0);
      assert.ok(availableSources().some((s) => s.id === 'codex' && s.available && s.sessions === 1));
    } finally {
      if (saved === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = saved;
    }
  });
});
