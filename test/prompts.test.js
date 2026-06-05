const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  BRAIN_MARKER_START,
  BRAIN_MARKER_END,
  injectPrompt,
  installForRuntime,
  initializeBrain,
  RUNTIMES,
} = require('../src/installer');

const PACKAGE_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-prompts-'));
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function readPrompt(name) {
  return fs.readFileSync(path.join(PACKAGE_ROOT, 'prompts', name), 'utf-8');
}

function readHook(name) {
  return fs.readFileSync(path.join(PACKAGE_ROOT, 'hooks', name), 'utf-8');
}

// ===========================================================================
// Prompt source file content validation
// ===========================================================================
describe('Prompt source files — session lifecycle sections', () => {
  const promptFiles = [
    { file: 'claude.md', prefix: '/brain:' },
    { file: 'gemini.md', prefix: '/brain:' },
    { file: 'openai.md', prefix: '/brain-' },
  ];

  for (const { file, prefix } of promptFiles) {
    describe(`prompts/${file}`, () => {
      let content;

      beforeEach(() => {
        content = readPrompt(file);
      });

      it('contains Session Start Behavior section', () => {
        assert.ok(
          content.includes('## Session Start Behavior'),
          `${file} missing "## Session Start Behavior"`
        );
      });

      it('contains session start directive', () => {
        assert.ok(
          content.includes('Perform these steps at session start'),
          `${file} missing session start directive`
        );
      });

      it('contains brain status output format', () => {
        assert.ok(
          content.includes('Brain active'),
          `${file} missing brain status output`
        );
      });

      it('contains review queue mention', () => {
        assert.ok(
          content.includes('due for review'),
          `${file} missing review queue mention`
        );
      });

      it('contains low-confidence alert instruction', () => {
        assert.ok(
          content.includes('low-confidence'),
          `${file} missing low-confidence alert`
        );
      });

      it('contains Session End Behavior section', () => {
        assert.ok(
          content.includes('## Session End Behavior'),
          `${file} missing "## Session End Behavior"`
        );
      });

      it('contains memorize suggestion with correct command prefix', () => {
        assert.ok(
          content.includes(`${prefix}memorize`),
          `${file} should reference ${prefix}memorize`
        );
      });

      it('contains session end content categories', () => {
        assert.ok(content.includes('**Decisions**'), `${file} missing Decisions category`);
        assert.ok(content.includes('**Learnings**'), `${file} missing Learnings category`);
        assert.ok(content.includes('**Insights**'), `${file} missing Insights category`);
        assert.ok(content.includes('**Experiences**'), `${file} missing Experiences category`);
        assert.ok(content.includes('**Goals**'), `${file} missing Goals category`);
      });

      it('contains no-auto-memorize rule', () => {
        assert.ok(
          content.includes('Do NOT auto-memorize without user consent'),
          `${file} missing no-auto-memorize rule`
        );
      });

      it('contains contexts.json persistence instruction', () => {
        assert.ok(
          content.includes('contexts.json'),
          `${file} missing contexts.json instruction`
        );
      });

      it('does NOT contain old "Auto-Memorize Guidance" section', () => {
        assert.ok(
          !content.includes('## Auto-Memorize Guidance'),
          `${file} still has old Auto-Memorize Guidance section`
        );
      });

      it('contains memorize command with correct prefix', () => {
        assert.ok(
          content.includes(`${prefix}memorize`),
          `${file} should reference ${prefix}memorize`
        );
      });

      it('contains recall engine reference', () => {
        assert.ok(
          content.includes('brain recall') || content.includes('recall engine'),
          `${file} missing recall engine reference`
        );
      });

      it('lists the six-verb core and omits every removed command', () => {
        // The refactor's intent, asserted directly: the survivors are advertised
        // and the six removed/folded commands no longer appear AS COMMANDS.
        // (Bare words like "consolidate"/"review" still appear in the sleep
        // description; we only forbid the `${prefix}<cmd>` command form.)
        for (const cmd of ['remember', 'memorize', 'status', 'pin', 'forget', 'sync', 'sleep']) {
          assert.ok(content.includes(`${prefix}${cmd}`), `${file} should advertise ${prefix}${cmd}`);
        }
        for (const removed of ['init', 'explore', 'consolidate', 'review', 'sunshine', 'unpin']) {
          assert.ok(
            !content.includes(`${prefix}${removed}`),
            `${file} must not reference removed command ${prefix}${removed}`
          );
        }
      });
    });
  }
});

// ===========================================================================
// Prompt content consistency across runtimes
// ===========================================================================
describe('Prompt content consistency across runtimes', () => {
  it('all prompts contain the same core sections', () => {
    const claude = readPrompt('claude.md');
    const gemini = readPrompt('gemini.md');
    const openai = readPrompt('openai.md');

    const coreSections = [
      '# Brain Memory System',
      '## How It Works',
      '## Session Start Behavior',
      '## Session End Behavior',
      '## When Recalling Memories',
      '## Portable Sync',
    ];

    for (const section of coreSections) {
      assert.ok(claude.includes(section), `claude.md missing "${section}"`);
      assert.ok(gemini.includes(section), `gemini.md missing "${section}"`);
      assert.ok(openai.includes(section), `openai.md missing "${section}"`);
    }
  });

  it('openai prompt uses /brain- prefix while others use /brain:', () => {
    const claude = readPrompt('claude.md');
    const gemini = readPrompt('gemini.md');
    const openai = readPrompt('openai.md');

    // Claude and Gemini use /brain: prefix
    assert.ok(claude.includes('/brain:memorize'));
    assert.ok(gemini.includes('/brain:memorize'));

    // OpenAI uses /brain- prefix
    assert.ok(openai.includes('/brain-memorize'));
    assert.ok(!openai.includes('/brain:memorize'));
  });
});

// ===========================================================================
// Hook files — reference notes
// ===========================================================================
describe('Hook files — reference notes', () => {
  it('session-start.md contains reference note about prompt delivery', () => {
    const content = readHook('session-start.md');
    assert.ok(
      content.includes('reference definition'),
      'session-start.md should note it is a reference definition'
    );
    assert.ok(
      content.includes('prompts/claude.md'),
      'session-start.md should reference the prompt files'
    );
  });

  it('session-end.md contains reference note about prompt delivery', () => {
    const content = readHook('session-end.md');
    assert.ok(
      content.includes('reference definition'),
      'session-end.md should note it is a reference definition'
    );
    assert.ok(
      content.includes('prompts/claude.md'),
      'session-end.md should reference the prompt files'
    );
  });
});

// ===========================================================================
// Integration: full install + brain init round-trip
// ===========================================================================
describe('Integration: install + init round-trip', () => {
  beforeEach(() => {
    setup();
    RUNTIMES.claude.localDir = path.join(tmpDir, '.claude');
    RUNTIMES.gemini.localDir = path.join(tmpDir, '.gemini');
    RUNTIMES.openai.localDir = path.join(tmpDir, '.codex');
  });
  afterEach(() => {
    RUNTIMES.claude.localDir = '.claude';
    RUNTIMES.gemini.localDir = '.gemini';
    RUNTIMES.openai.localDir = '.codex';
    teardown();
  });

  it('full Claude install creates commands + prompt with session lifecycle', () => {
    installForRuntime('claude', 'local');

    // Commands copied
    const commandsDir = path.join(tmpDir, '.claude', 'commands', 'brain');
    const commands = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.md'));
    assert.ok(commands.length >= 8, `Expected >= 8 commands, got ${commands.length}`);
    assert.ok(commands.includes('memorize.md'));
    assert.ok(commands.includes('remember.md'));
    assert.ok(commands.includes('sleep.md'));
    assert.ok(commands.includes('sync.md'));
    assert.ok(commands.includes('status.md'));
  });

  it('full OpenAI install creates skill directories', () => {
    installForRuntime('openai', 'local');

    const skillsDir = path.join(tmpDir, '.codex', 'skills');
    const skills = fs.readdirSync(skillsDir);
    assert.ok(skills.length >= 8, `Expected >= 8 skills, got ${skills.length}`);
    assert.ok(skills.includes('brain-remember'));
    assert.ok(skills.includes('brain-memorize'));
    assert.ok(skills.includes('brain-sync'));

    // Each skill has SKILL.md
    for (const skill of skills) {
      assert.ok(
        fs.existsSync(path.join(skillsDir, skill, 'SKILL.md')),
        `${skill} missing SKILL.md`
      );
    }
  });

  it('brain init + prompt injection gives a working system', () => {
    // Initialize brain
    const result = initializeBrain(tmpDir);
    assert.equal(result.alreadyExists, false);

    // Inject prompt
    injectPrompt(tmpDir, 'CLAUDE.md', 'claude.md');

    // Verify brain structure exists
    const index = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.brain', 'index.json'), 'utf-8')
    );
    assert.equal(index.version, 2);
    assert.equal(index.memory_count, 0);

    // Verify prompt has session lifecycle
    const prompt = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    assert.ok(prompt.includes('## Session Start Behavior'));
    assert.ok(prompt.includes('## Session End Behavior'));
    assert.ok(prompt.includes('.brain/index.json'));

    // Verify review queue exists (referenced in session start)
    const queue = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.brain', 'review-queue.json'), 'utf-8')
    );
    assert.deepEqual(queue.items, []);

    // Verify contexts.json exists (referenced in session end)
    const ctx = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.brain', 'contexts.json'), 'utf-8')
    );
    assert.deepEqual(ctx.sessions, []);
  });

  it('double install is idempotent — no duplicate markers or commands', () => {
    // First install
    installForRuntime('claude', 'local');
    injectPrompt(tmpDir, 'CLAUDE.md', 'claude.md');

    // Second install
    installForRuntime('claude', 'local');
    injectPrompt(tmpDir, 'CLAUDE.md', 'claude.md');

    const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    const startCount = content.split(BRAIN_MARKER_START).length - 1;
    assert.equal(startCount, 1, 'Should have exactly one start marker after double install');
  });

  it('all three runtimes can be installed simultaneously', () => {
    installForRuntime('claude', 'local');
    installForRuntime('gemini', 'local');
    installForRuntime('openai', 'local');

    // Claude
    assert.ok(fs.existsSync(path.join(tmpDir, '.claude', 'commands', 'brain', 'memorize.md')));
    // Gemini
    assert.ok(fs.existsSync(path.join(tmpDir, '.gemini', 'commands', 'brain', 'memorize.md')));
    // OpenAI
    assert.ok(fs.existsSync(path.join(tmpDir, '.codex', 'skills', 'brain-memorize', 'SKILL.md')));
  });
});
