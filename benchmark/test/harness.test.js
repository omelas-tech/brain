/**
 * Unit tests for benchmark harness modules.
 * Tests metrics, evaluator, seeder, formatter, and brain-setup.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Harness modules
const {
  createRunMetrics,
  recordPrompt,
  totalTokens,
  aggregateRuns,
  computeSummary,
  median,
  OUTCOME,
  classifyRun,
  summarizeOutcomes,
} = require('../harness/metrics');

const {
  containsPattern,
  scorePatterns,
  computeConsistency,
  evaluateFiles,
  jaccard,
} = require('../harness/evaluator');

const { seedMemories, buildMemoryMarkdown, createRng } = require('../harness/seeder');
const { createWorkspace, buildAgentEnv, copyFixtures, cleanupWorkspace } = require('../harness/brain-setup');
const { renderConsoleTable, renderMarkdownReport, formatDelta } = require('../harness/formatter');
const { getAllNames } = require('../harness/agents');

// ─────────────────────────────────────────────────────────
// Metrics
// ─────────────────────────────────────────────────────────

describe('Metrics', () => {
  it('createRunMetrics returns empty container', () => {
    const m = createRunMetrics();
    assert.equal(m.tokens.input, 0);
    assert.equal(m.tokens.output, 0);
    assert.equal(m.time_ms, 0);
    assert.equal(m.prompts.length, 0);
  });

  it('recordPrompt accumulates tokens and time', () => {
    const m = createRunMetrics();
    recordPrompt(m, { tokens: { input: 100, output: 50 }, time_ms: 500 }, 'p1');
    recordPrompt(m, { tokens: { input: 200, output: 100 }, time_ms: 300 }, 'p2');

    assert.equal(m.tokens.input, 300);
    assert.equal(m.tokens.output, 150);
    assert.equal(m.time_ms, 800);
    assert.equal(m.prompts.length, 2);
    assert.equal(m.prompts[0].label, 'p1');
  });

  it('totalTokens sums input and output', () => {
    assert.equal(totalTokens({ input: 100, output: 50 }), 150);
    assert.equal(totalTokens({ input: 0, output: 0 }), 0);
  });

  it('median calculates correctly for odd and even arrays', () => {
    assert.equal(median([1, 2, 3]), 2);
    assert.equal(median([1, 2, 3, 4]), 3); // rounds (2+3)/2
    assert.equal(median([5]), 5);
    assert.equal(median([10, 20]), 15);
  });

  it('aggregateRuns returns single run unchanged', () => {
    const run = { tokens: { input: 100, output: 50 }, time_ms: 500, success: true, consistency: 0.9 };
    const result = aggregateRuns([run]);
    assert.equal(result.tokens.input, 100);
    assert.equal(result.consistency, 0.9);
  });

  it('aggregateRuns computes median across 3 runs', () => {
    const runs = [
      { tokens: { input: 100, output: 50 }, time_ms: 500, success: true, consistency: 0.8 },
      { tokens: { input: 200, output: 100 }, time_ms: 700, success: true, consistency: 0.9 },
      { tokens: { input: 150, output: 75 }, time_ms: 600, success: false, consistency: 0.85 },
    ];
    const result = aggregateRuns(runs);
    // Token/time medians from successful runs only (100,200 → 150; 50,100 → 75; 500,700 → 600)
    assert.equal(result.tokens.input, 150);
    assert.equal(result.tokens.output, 75);
    assert.equal(result.time_ms, 600);
    assert.equal(result.success, true); // 2/3 succeeded
    assert.equal(result.consistency, 0.85); // consistency uses all runs
    assert.equal(result.runs, 3);
  });

  it('aggregateRuns excludes failed runs from token/time medians', () => {
    const runs = [
      { tokens: { input: 0, output: 0 }, time_ms: 300000, success: false, consistency: 0 },
      { tokens: { input: 0, output: 0 }, time_ms: 300000, success: false, consistency: 0 },
      { tokens: { input: 30000, output: 2000 }, time_ms: 45000, success: true, consistency: 0.9 },
    ];
    const result = aggregateRuns(runs);
    // Only the 1 successful run contributes to token/time medians
    assert.equal(result.tokens.input, 30000);
    assert.equal(result.tokens.output, 2000);
    assert.equal(result.time_ms, 45000);
    assert.equal(result.success, false); // 1/3 < majority
    assert.equal(result.success_rate, 0.33);
    assert.equal(result.consistency, 0); // median of [0, 0, 0.9]
  });

  it('aggregateRuns falls back to all runs when none succeeded', () => {
    const runs = [
      { tokens: { input: 0, output: 0 }, time_ms: 300000, success: false, consistency: 0 },
      { tokens: { input: 0, output: 0 }, time_ms: 300000, success: false, consistency: 0 },
      { tokens: { input: 0, output: 0 }, time_ms: 300000, success: false, consistency: 0 },
    ];
    const result = aggregateRuns(runs);
    assert.equal(result.tokens.input, 0);
    assert.equal(result.time_ms, 300000);
    assert.equal(result.success, false);
    assert.equal(result.success_rate, 0);
  });

  it('aggregateRuns returns null for empty array', () => {
    assert.equal(aggregateRuns([]), null);
  });

  it('computeSummary calculates improvement percentages', () => {
    const withBrain = {
      tokens: { input: 1000, output: 500 },
      time_ms: 3000,
      success_rate: 0.9,
      consistency: 0.85,
    };
    const withoutBrain = {
      tokens: { input: 2000, output: 1000 },
      time_ms: 5000,
      success_rate: 0.5,
      consistency: 0.4,
    };
    const summary = computeSummary(withBrain, withoutBrain);
    assert.equal(summary.token_reduction_pct, 50);
    assert.equal(summary.success_improvement_pct, 40);
    assert.equal(summary.consistency_improvement_pct, 45);
    assert.equal(summary.time_reduction_pct, 40);
  });
});

// ─────────────────────────────────────────────────────────
// Outcome taxonomy (3-state: PASS / FAIL / NO_COMPLETION)
// ─────────────────────────────────────────────────────────

describe('Outcome taxonomy', () => {
  it('classifyRun honors an explicit outcome', () => {
    assert.equal(classifyRun({ outcome: OUTCOME.PASS }), OUTCOME.PASS);
    assert.equal(classifyRun({ outcome: OUTCOME.NONE }), OUTCOME.NONE);
  });

  it('classifyRun infers from legacy fields when outcome is absent', () => {
    assert.equal(classifyRun({ success: true }), OUTCOME.PASS);
    assert.equal(classifyRun({ success: false }), OUTCOME.FAIL);
    // an errored run is NO_COMPLETION, never a "fail"
    assert.equal(classifyRun({ success: false, error: 'timed out' }), OUTCOME.NONE);
  });

  it('summarizeOutcomes separates completion from success', () => {
    const runs = [
      { outcome: OUTCOME.PASS },
      { outcome: OUTCOME.FAIL },
      { outcome: OUTCOME.NONE, error: 'timeout' },
      { outcome: OUTCOME.PASS },
    ];
    const s = summarizeOutcomes(runs);
    assert.equal(s.total, 4);
    assert.equal(s.passes, 2);
    assert.equal(s.completed, 3);          // 2 PASS + 1 FAIL
    assert.equal(s.no_completion, 1);
    assert.equal(s.success_rate, 0.5);     // 2/4
    assert.equal(s.completion_rate, 0.75); // 3/4
    assert.equal(s.no_completion_rate, 0.25);
  });

  it('a timeout dents completion, not the token economy', () => {
    // All NO_COMPLETION → success and completion both 0, but no crash / no ∞.
    const runs = [
      { outcome: OUTCOME.NONE, error: 'timed out' },
      { outcome: OUTCOME.NONE, error: 'timed out' },
    ];
    const s = summarizeOutcomes(runs);
    assert.equal(s.success_rate, 0);
    assert.equal(s.completion_rate, 0);
    assert.equal(s.no_completion_rate, 1);
  });
});

// ─────────────────────────────────────────────────────────
// Evaluator
// ─────────────────────────────────────────────────────────

describe('Evaluator', () => {
  it('containsPattern matches string and regex', () => {
    assert.ok(containsPattern('hello world', 'hello'));
    assert.ok(!containsPattern('hello world', 'xyz'));
    assert.ok(containsPattern('async function()', /async\s/));
    assert.ok(!containsPattern('sync function()', /async\s/));
  });

  it('scorePatterns returns correct score', () => {
    const result = scorePatterns('const x = async () => await fetch()', [
      /async/,
      /await/,
      /const/,
      /class/,
    ]);
    assert.equal(result.matched, 3);
    assert.equal(result.total, 4);
    assert.equal(result.score, 0.75);
  });

  it('scorePatterns handles empty patterns', () => {
    const result = scorePatterns('anything', []);
    assert.equal(result.score, 1);
  });

  it('jaccard similarity is correct', () => {
    assert.equal(jaccard([1, 1, 0], [1, 1, 0]), 1.0);
    assert.equal(jaccard([1, 0, 0], [0, 0, 1]), 0);
    // [1,1,0] vs [1,0,1]: intersection=1 (index 0), union=3 (indices 0,1,2) → 1/3
    assert.ok(Math.abs(jaccard([1, 1, 0], [1, 0, 1]) - 1/3) < 0.001);
  });

  it('computeConsistency scores identical outputs as 1.0', () => {
    const outputs = [
      'const x = async () => await fetch()',
      'const x = async () => await fetch()',
    ];
    const result = computeConsistency(outputs, [/async/, /await/, /const/]);
    assert.equal(result.score, 1.0);
  });

  it('computeConsistency handles single output', () => {
    const result = computeConsistency(['anything'], [/test/]);
    assert.equal(result.score, 1.0);
  });

  it('evaluateFiles checks file existence and patterns', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-test-'));
    fs.writeFileSync(path.join(tmpDir, 'test.js'), 'const x = async () => await fetch();\n');

    const result = evaluateFiles(tmpDir, [
      { file: 'test.js', patterns: [/async/, /await/, /const/] },
      { file: 'missing.js', patterns: [/anything/] },
    ]);

    assert.equal(result.files[0].exists, true);
    assert.equal(result.files[0].score, 1.0);
    assert.equal(result.files[1].exists, false);
    assert.equal(result.files[1].score, 0);
    assert.equal(result.success, false); // missing.js doesn't exist

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ─────────────────────────────────────────────────────────
// Seeder
// ─────────────────────────────────────────────────────────

describe('Seeder', () => {
  let tmpDir; // acts as homeDir (brain lives at tmpDir/.brain/)

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seeder-test-'));
    const installer = require('../../src/installer');
    installer.initializeBrain(tmpDir);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('createRng produces deterministic sequence', () => {
    const rng1 = createRng(42);
    const rng2 = createRng(42);
    for (let i = 0; i < 100; i++) {
      assert.equal(rng1(), rng2());
    }
  });

  it('createRng with different seeds produces different sequences', () => {
    const rng1 = createRng(42);
    const rng2 = createRng(99);
    let allEqual = true;
    for (let i = 0; i < 10; i++) {
      if (rng1() !== rng2()) allEqual = false;
    }
    assert.ok(!allEqual);
  });

  it('seedMemories writes memories to brain directory', () => {
    const memories = [
      {
        id: 'mem_test_001',
        type: 'learning',
        cognitive_type: 'semantic',
        title: 'Test Memory',
        body: 'This is a test memory.',
        path: 'professional/learning/test_001.md',
        strength: 0.8,
        decay_rate: 0.995,
        salience: 0.7,
        confidence: 0.9,
        tags: ['test'],
      },
    ];

    const result = seedMemories(tmpDir, memories);
    assert.equal(result.memoriesSeeded, 1);

    // Verify index was updated
    const indexManager = require('../../src/index-manager');
    const index = indexManager.readIndex(tmpDir);
    assert.ok(index.memories['mem_test_001']);
    assert.equal(index.memories['mem_test_001'].type, 'learning');

    // Verify markdown file was written
    const memPath = path.join(tmpDir, '.brain', 'professional', 'learning', 'test_001.md');
    assert.ok(fs.existsSync(memPath));
    const content = fs.readFileSync(memPath, 'utf-8');
    assert.ok(content.includes('Test Memory'));
  });

  it('seedMemories writes associations', () => {
    const memories = [
      {
        id: 'mem_test_002',
        type: 'decision',
        path: 'professional/decisions/test_002.md',
        strength: 0.85,
        decay_rate: 0.997,
        tags: ['test'],
      },
    ];

    const result = seedMemories(tmpDir, memories, {
      associations: [
        { idA: 'mem_test_001', idB: 'mem_test_002', weight: 0.6, origin: 'test' },
      ],
    });

    assert.equal(result.associationsSeeded, 1);

    const indexManager = require('../../src/index-manager');
    const assoc = indexManager.readAssociations(tmpDir);
    assert.ok(assoc.edges['mem_test_001']['mem_test_002']);
    assert.equal(assoc.edges['mem_test_001']['mem_test_002'].weight, 0.6);
  });

  it('buildMemoryMarkdown generates valid frontmatter', () => {
    const md = buildMemoryMarkdown({
      id: 'mem_test_003',
      type: 'insight',
      cognitive_type: 'episodic',
      title: 'Test Insight',
      body: 'An important insight.',
      strength: 0.9,
      decay_rate: 0.997,
      tags: ['insight', 'test'],
    });

    assert.ok(md.startsWith('---'));
    assert.ok(md.includes('"mem_test_003"'));
    assert.ok(md.includes('"insight"'));
    assert.ok(md.includes('Test Insight'));
  });
});

// ─────────────────────────────────────────────────────────
// Brain Setup
// ─────────────────────────────────────────────────────────

describe('Brain Setup', () => {
  it('createWorkspace creates isolated temp directories', () => {
    const { workDir, homeDir, brainDir } = createWorkspace('test', 'claude', 'without_brain', 0);
    assert.ok(fs.existsSync(workDir));
    assert.ok(fs.existsSync(homeDir));
    assert.equal(brainDir, null);
    // workDir and homeDir are siblings under a base dir
    assert.equal(path.dirname(workDir), path.dirname(homeDir));
    cleanupWorkspace(path.dirname(workDir));
    assert.ok(!fs.existsSync(workDir));
  });

  it('createWorkspace with brain initializes .brain in isolated HOME', () => {
    const { workDir, homeDir, brainDir } = createWorkspace('test', 'claude', 'with_brain', 0);
    assert.ok(fs.existsSync(workDir));
    assert.ok(brainDir);
    assert.ok(fs.existsSync(brainDir));
    assert.ok(fs.existsSync(path.join(brainDir, 'index.json')));
    assert.ok(fs.existsSync(path.join(brainDir, 'associations.json')));
    // Brain is inside isolated HOME, not workDir
    assert.ok(brainDir.startsWith(homeDir));
    // Agent prompt should be installed in isolated HOME
    assert.ok(fs.existsSync(path.join(homeDir, '.claude', 'CLAUDE.md')));
    cleanupWorkspace(path.dirname(workDir));
  });

  it('without_brain HOME has no .brain and no brain prompts', () => {
    const { workDir, homeDir } = createWorkspace('test', 'claude', 'without_brain', 0);
    assert.ok(!fs.existsSync(path.join(homeDir, '.brain')));
    // .claude dir may exist (for auth), but should have no brain commands
    assert.ok(!fs.existsSync(path.join(homeDir, '.claude', 'commands', 'brain')));
    cleanupWorkspace(path.dirname(workDir));
  });

  it('copyFixtures copies files to workspace', () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'fixtures-src-'));
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'fixtures-dest-'));

    fs.writeFileSync(path.join(src, 'test.txt'), 'hello');
    fs.mkdirSync(path.join(src, 'sub'));
    fs.writeFileSync(path.join(src, 'sub', 'nested.txt'), 'world');

    copyFixtures(src, dest);

    assert.ok(fs.existsSync(path.join(dest, 'test.txt')));
    assert.ok(fs.existsSync(path.join(dest, 'sub', 'nested.txt')));
    assert.equal(fs.readFileSync(path.join(dest, 'test.txt'), 'utf-8'), 'hello');

    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  });
});

// ─────────────────────────────────────────────────────────
// Formatter
// ─────────────────────────────────────────────────────────

describe('Formatter', () => {
  const sampleResult = {
    scenario: 'test-scenario',
    model: 'qwen2.5-coder:14b',
    results: {
      claude: {
        with_brain: { tokens: { input: 1000, output: 500 }, time_ms: 3000, success: true, consistency: 0.9 },
        without_brain: { tokens: { input: 2000, output: 1000 }, time_ms: 5000, success: false, consistency: 0.4 },
      },
    },
    summary: {
      token_reduction_pct: 50,
      success_improvement_pct: 40,
      consistency_improvement_pct: 50,
      time_reduction_pct: 40,
    },
  };

  it('renderConsoleTable produces output', () => {
    const table = renderConsoleTable(sampleResult);
    assert.ok(table.includes('test-scenario'));
    assert.ok(table.includes('qwen2.5-coder:14b'));
    assert.ok(table.includes('+brain'));
    assert.ok(table.includes('-brain'));
    assert.ok(table.includes('50'));
  });

  it('renderMarkdownReport produces valid markdown', () => {
    const md = renderMarkdownReport([sampleResult]);
    assert.ok(md.includes('# Brain Memory Benchmark Results'));
    assert.ok(md.includes('| Scenario'));
    assert.ok(md.includes('test-scenario'));
    assert.ok(md.includes('PASS'));
    assert.ok(md.includes('FAIL'));
  });

  it('formatDelta handles positive, negative, and null', () => {
    assert.equal(formatDelta(50), '+50');
    assert.equal(formatDelta(-10), '-10');
    assert.equal(formatDelta(0), '0');
    assert.equal(formatDelta(null), 'N/A');
  });

  it('arm-shape table shows completion/success split and a single null symbol', () => {
    const armResult = {
      scenario: 'scenario-A',
      model: 'cloud',
      results: {
        gemini: {
          'brain-full': {
            tokens: { input: 18000, output: 1800 }, time_ms: 40000,
            completion_rate: 1, success_rate: 0.7, no_completion_rate: 0,
            tokens_per_success: 27900, retrieval: { recall: { '5': 0.92 } },
          },
          'context-dump-unbounded': {
            tokens: { input: 0, output: 0 }, time_ms: 600000,
            completion_rate: 0, success_rate: 0, no_completion_rate: 1,
            tokens_per_success: null, retrieval: null,
          },
        },
      },
    };
    const table = renderConsoleTable(armResult);
    assert.ok(table.includes('brain-full'));
    assert.ok(table.includes('compl%'));
    assert.ok(table.includes('70%'));    // success rate split out
    assert.ok(table.includes('0.92'));   // recall rendered
    assert.ok(table.includes('—'));      // single null symbol for the timed-out arm
    assert.ok(!table.includes('∞'));     // never the infinity glyph

    const md = renderMarkdownReport([{ ...armResult, summary: null }]);
    assert.ok(md.includes('| Completion | Success |'));
    assert.ok(md.includes('brain-full'));
    assert.ok(!md.includes('∞'));
  });
});

// ─────────────────────────────────────────────────────────
// Agent Registry
// ─────────────────────────────────────────────────────────

describe('Agent Registry', () => {
  it('getAllNames returns expected agent names', () => {
    const names = getAllNames();
    assert.deepEqual(names, ['claude', 'gemini', 'codex', 'opencode', 'ollama', 'deepseek']);
  });
});
