/**
 * Plugin hook scripts (hooks/*.mjs) — run under Claude Code and Codex plugin
 * hosts. Tested both in-process (handlers) and as child processes (the
 * fail-soft stdin/stdout contract), always against a throwaway brain.
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const { initializeBrain } = require('../src/installer');

const ROOT = path.resolve(__dirname, '..');
const HOOKS = path.join(ROOT, 'hooks');

let tmpBase;
let brainDir;
let savedBrainDir;
let lib;
let sessionStart;
let sessionEnd;

/** Env for child hook processes: no host markers, throwaway brain. */
function childEnv(extra = {}) {
  const env = { ...process.env, BRAIN_DIR: brainDir, ...extra };
  for (const key of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CODEX_HOME', 'CODEX_SANDBOX', 'PLUGIN_ROOT', 'CLAUDE_PLUGIN_ROOT']) {
    if (!(key in extra)) delete env[key];
  }
  return env;
}

function runHookScript(script, input, extraEnv) {
  const out = execFileSync(process.execPath, [path.join(HOOKS, script)], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: childEnv(extraEnv),
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(out);
}

before(async () => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-hooks-'));
  brainDir = path.join(tmpBase, '.brain');
  savedBrainDir = process.env.BRAIN_DIR;
  process.env.BRAIN_DIR = brainDir;
  initializeBrain(tmpBase);
  lib = await import(pathToFileURL(path.join(HOOKS, 'lib.mjs')));
  sessionStart = await import(pathToFileURL(path.join(HOOKS, 'session-start.mjs')));
  sessionEnd = await import(pathToFileURL(path.join(HOOKS, 'session-end.mjs')));
});

after(() => {
  if (savedBrainDir === undefined) delete process.env.BRAIN_DIR;
  else process.env.BRAIN_DIR = savedBrainDir;
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

describe('hooks/lib.mjs', () => {
  it('resolves PLUGIN_ROOT to the repository root', () => {
    assert.equal(lib.PLUGIN_ROOT, ROOT);
  });

  it('detects the host from the env the hosts actually export', () => {
    assert.equal(lib.detectHost({ CLAUDECODE: '1', CLAUDE_PLUGIN_ROOT: '/p' }), 'claude-code');
    assert.equal(lib.detectHost({ CLAUDE_PLUGIN_ROOT: '/p' }), 'claude-code');
    // Codex exports PLUGIN_ROOT and, for compatibility, CLAUDE_PLUGIN_ROOT too.
    assert.equal(lib.detectHost({ PLUGIN_ROOT: '/p', CLAUDE_PLUGIN_ROOT: '/p' }), 'codex');
    assert.equal(lib.detectHost({ CODEX_HOME: '/h' }), 'codex');
    assert.equal(lib.detectHost({}), 'unknown');
  });

  it('parses hook input leniently and derives the project from cwd', () => {
    assert.deepEqual(lib.parseHookInput('not json'), {});
    assert.deepEqual(lib.parseHookInput(''), {});
    assert.equal(lib.projectFromInput({ cwd: '/Users/me/code/my-app/' }), 'my-app');
    assert.equal(lib.projectFromInput({}, '/tmp/fallback'), 'fallback');
  });

  it('reports whether the BRAIN_DIR brain exists', () => {
    assert.equal(lib.hasBrain(), true);
    process.env.BRAIN_DIR = path.join(tmpBase, 'nope');
    assert.equal(lib.hasBrain(), false);
    process.env.BRAIN_DIR = brainDir;
  });
});

describe('hooks/session-start.mjs', () => {
  it('renders the status line, alerts, host vocabulary and the JSON payload', () => {
    const payload = {
      memory_count: 12, context_recall: [{ id: 'a' }, { id: 'b' }], pinned: [], skills_index: [],
      due_for_review: 2, expired_pins: 1, pending_verification: 3, low_confidence_alerts: [{ id: 'x' }],
    };
    const claude = sessionStart.buildContext(payload, { project: 'app', host: 'claude-code' });
    assert.match(claude, /◉ Brain active — 12 memories \(2 in project context\)/);
    assert.match(claude, /📋 2 due for review/);
    assert.match(claude, /⌛ 1 pinned memories expired/);
    assert.match(claude, /⊘ 3 pending verification/);
    assert.match(claude, /⚠️ 1 low-confidence/);
    assert.match(claude, /Commands: \/brain:remember/);
    assert.ok(claude.startsWith('<brain-session-context>\n'));
    assert.ok(claude.endsWith('```json\n' + JSON.stringify(payload) + '\n```\n</brain-session-context>'));

    const codex = sessionStart.buildContext(payload, { project: 'app', host: 'codex' });
    assert.match(codex, /Skills: brain-remember/);
    assert.doesNotMatch(codex, /Commands: \/brain:remember/);
  });

  it('omits alert lines when there is nothing to report', () => {
    const text = sessionStart.buildContext({ memory_count: 0 }, { project: 'p', host: 'unknown' });
    assert.match(text, /status line exactly: `◉ Brain active — 0 memories \(0 in project context\)`\.\n/);
    assert.doesNotMatch(text, /due for review|pending verification|low-confidence|expired/);
  });

  it('computes a real payload from the brain and wraps it as SessionStart context', async () => {
    const out = await sessionStart.handleSessionStart({ cwd: tmpBase }, { env: { CLAUDECODE: '1' } });
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.equal(out.suppressOutput, true);
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.match(ctx, /project: .*brain-hooks-/);
    assert.match(ctx, /"memory_count":0/);
    assert.match(ctx, /"budget":\{"cap":3000/);
  });

  it('returns {} when no brain exists', async () => {
    process.env.BRAIN_DIR = path.join(tmpBase, 'nope');
    try {
      assert.deepEqual(await sessionStart.handleSessionStart({ cwd: tmpBase }), {});
    } finally {
      process.env.BRAIN_DIR = brainDir;
    }
  });

  it('as a child process: valid JSON on stdout, exit 0, even on garbage stdin', () => {
    const ok = runHookScript('session-start.mjs', { cwd: tmpBase, session_id: 's1' });
    assert.equal(ok.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.deepEqual(runHookScript('session-start.mjs', 'not json'), JSON.parse(JSON.stringify(
      runHookScript('session-start.mjs', {}),
    )));
    assert.deepEqual(runHookScript('session-start.mjs', {}, { BRAIN_DIR: path.join(tmpBase, 'nope') }), {});
  });

  it('as a child process: labels Codex when only PLUGIN_ROOT is exported', () => {
    const out = runHookScript('session-start.mjs', { cwd: tmpBase }, { PLUGIN_ROOT: ROOT, CLAUDE_PLUGIN_ROOT: ROOT });
    assert.match(out.hookSpecificOutput.additionalContext, /Skills: brain-remember/);
  });
});

describe('hooks/session-end.mjs', () => {
  beforeEach(() => {
    fs.writeFileSync(path.join(brainDir, 'contexts.json'), JSON.stringify({ version: 1, sessions: [] }, null, 2) + '\n');
  });

  it('builds an entry in the session-end schema keyed by the host session id', () => {
    const entry = sessionEnd.buildContextEntry({ session_id: 'thr/ab c', cwd: '/x/proj' }, new Date('2026-09-03T10:11:12.000Z'));
    assert.equal(entry.session_id, '20260903101112-thr_ab_c');
    assert.equal(entry.project, 'proj');
    assert.equal(entry.ended, '2026-09-03T10:11:12.000Z');
    assert.deepEqual(entry.topics, []);
    assert.equal(entry.source, 'session-end-hook');
  });

  it('appends and trims to the newest 20, preserving the wrapper shape', () => {
    const many = { version: 1, extra: true, sessions: Array.from({ length: 20 }, (_, i) => ({ session_id: String(i) })) };
    const next = sessionEnd.appendContextEntry(many, { session_id: 'new' });
    assert.equal(next.sessions.length, 20);
    assert.equal(next.sessions[0].session_id, '1');
    assert.equal(next.sessions[19].session_id, 'new');
    assert.equal(next.extra, true);
    const bare = sessionEnd.appendContextEntry([{ session_id: 'a' }], { session_id: 'b' });
    assert.deepEqual(bare, { version: 1, sessions: [{ session_id: 'a' }, { session_id: 'b' }] });
    assert.deepEqual(sessionEnd.appendContextEntry(null, { session_id: 'z' }).sessions.length, 1);
  });

  it('writes the entry into contexts.json of the BRAIN_DIR brain', () => {
    assert.deepEqual(sessionEnd.handleSessionEnd({ session_id: 'end-1', cwd: tmpBase }), {});
    const contexts = JSON.parse(fs.readFileSync(path.join(brainDir, 'contexts.json'), 'utf-8'));
    assert.equal(contexts.sessions.length, 1);
    assert.match(contexts.sessions[0].session_id, /-end-1$/);
  });

  it('as a child process: writes the entry and prints {}', () => {
    assert.deepEqual(runHookScript('session-end.mjs', { session_id: 'end-2', cwd: tmpBase }), {});
    const contexts = JSON.parse(fs.readFileSync(path.join(brainDir, 'contexts.json'), 'utf-8'));
    assert.match(contexts.sessions.at(-1).session_id, /-end-2$/);
    assert.deepEqual(runHookScript('session-end.mjs', {}, { BRAIN_DIR: path.join(tmpBase, 'nope') }), {});
  });
});

describe('hooks/prompt-recall.mjs', () => {
  let promptRecall;
  const MEMORIZE = path.join(ROOT, 'bin', 'memorize.js');

  before(async () => {
    promptRecall = await import(pathToFileURL(path.join(HOOKS, 'prompt-recall.mjs')));
    const payload = {
      title: 'Postgres pooling decision',
      type: 'decision',
      cognitive_type: 'semantic',
      path: 'professional/projects/app/postgres-pooling.md',
      content: 'We chose pgbouncer in transaction mode for the API. Session mode broke prepared statements under load.',
      tags: ['postgres', 'pooling'],
      origin: 'user',
    };
    execFileSync(process.execPath, [MEMORIZE], { input: JSON.stringify({ memories: [payload] }), env: childEnv(), encoding: 'utf-8' });
  });

  it('skips short prompts, bare slash commands and acknowledgements', () => {
    assert.equal(promptRecall.shouldRecall('ok'), false);
    assert.equal(promptRecall.shouldRecall('/brain:status'), false);
    assert.equal(promptRecall.shouldRecall('yes please'), false);
    assert.equal(promptRecall.shouldRecall('thanks!'), false);
    assert.equal(promptRecall.shouldRecall(undefined), false);
    assert.equal(promptRecall.shouldRecall('why did we pick pgbouncer for postgres?'), true);
  });

  it('excerpts the body without frontmatter or heading, on a word boundary', () => {
    const file = '---\nid: x\n---\n# Title\n\nFirst   sentence here.\nSecond line.';
    assert.equal(promptRecall.excerptOf(file), 'First sentence here. Second line.');
    const long = 'word '.repeat(100);
    const cut = promptRecall.excerptOf(long);
    assert.ok(cut.length <= promptRecall.EXCERPT_CHARS + 1);
    assert.ok(cut.endsWith('…'));
  });

  it('renders receipts, trust flags and excerpts under the token budget', () => {
    const entries = [
      { id: 'a', receipt: '◉ memory: "A" (decision, 2d)', excerpt: 'alpha', low_trust: true },
      { id: 'b', receipt: '◉ memory: "B" (learning, 1d)', excerpt: 'beta', quarantine_pending: true, expired: true },
    ];
    const text = promptRecall.buildContext(entries, { budget: 10_000 });
    assert.ok(text.startsWith('<brain-context>\n'));
    assert.ok(text.endsWith('\n</brain-context>'));
    assert.match(text, /- ◉ memory: "A" \(decision, 2d\) \[⚠ low-trust\] — alpha \(id a\)/);
    assert.match(text, /\[⊘ unverified, ⌛ expired\]/);
    const tight = promptRecall.buildContext(entries, { budget: 60 });
    assert.equal(tight, null, 'header alone exceeds a tiny budget');
    const one = promptRecall.buildContext(entries, { budget: 75 });
    assert.ok(one === null || !one.includes('(id b)'));
  });

  it('injects the matching memory for a relevant prompt and nothing for an unrelated one', async () => {
    const hit = await promptRecall.handlePrompt({ prompt: 'why did we pick pgbouncer for postgres pooling?', cwd: '/x/app' });
    assert.equal(hit.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    const ctx = hit.hookSpecificOutput.additionalContext;
    assert.match(ctx, /Postgres pooling decision/);
    assert.match(ctx, /pgbouncer in transaction mode/);
    assert.match(ctx, /^<brain-context>/);

    const miss = await promptRecall.handlePrompt({ prompt: 'translate this haiku into finnish for me', cwd: '/x/app' });
    assert.deepEqual(miss, {});
    assert.deepEqual(await promptRecall.handlePrompt({ prompt: 'ok' }), {});
  });

  it('honors prompt_recall_top = 0 as an off switch', async () => {
    const im = require(path.join(ROOT, 'src', 'index-manager.js'));
    im.writeConfig({ prompt_recall_top: 0 });
    try {
      assert.deepEqual(await promptRecall.handlePrompt({ prompt: 'why did we pick pgbouncer for postgres pooling?' }), {});
    } finally {
      im.writeConfig({});
    }
  });

  it('as a child process: injects for a relevant prompt, {} otherwise, exit 0 always', () => {
    const out = runHookScript('prompt-recall.mjs', { prompt: 'pgbouncer transaction mode postgres', cwd: '/x/app' });
    assert.match(out.hookSpecificOutput.additionalContext, /Postgres pooling decision/);
    assert.deepEqual(runHookScript('prompt-recall.mjs', { prompt: 'ok' }), {});
    assert.deepEqual(runHookScript('prompt-recall.mjs', 'garbage'), {});
    assert.deepEqual(runHookScript('prompt-recall.mjs', { prompt: 'pgbouncer postgres' }, { BRAIN_DIR: path.join(tmpBase, 'nope') }), {});
  });
});
