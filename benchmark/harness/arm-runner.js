/**
 * N-arm scenario runner.
 *
 * Replaces the old `with_brain` vs `without_brain` binary split with a
 * configurable list of "arms" — each arm describes exactly how a run is
 * set up (which memories to seed, whether to invoke session-start, what
 * memory injection format to use). This lets a single scenario run
 * `brain-real`, `brain-no-pin`, `context-dump`, and `bare` side-by-side.
 *
 * Arm shape (declared in scenario setup.json under `arms[]`):
 *
 *   {
 *     "name": "brain-real",              // canonical id; used in reports
 *     "label": "Brain (production)",     // human-readable
 *     "seed": "scenario+distractors",    // see SEED_MODES below
 *     "distractor_size": 200,            // applies when seed includes distractors
 *     "memory_injection": "session-start"  // see INJECTION_MODES below
 *     "pin": true,                       // enable Pinned Tier (Phase 1)
 *     "skills": true                     // enable Skills (Phase 2)
 *   }
 *
 * Recommended ablation arms (see README §"Arm matrix"):
 *
 *   bare              | nothing seeded, no memory injection
 *   fixture-only      | fixtures only, no memory
 *   brain-real        | session-start payload, distractors, pin+skills enabled
 *   brain-no-recall   | all oracle memories dumped verbatim (today's behaviour)
 *   brain-no-pin      | brain-real but Pinned Tier disabled
 *   brain-no-skills   | brain-real but Skills disabled
 *   context-dump      | full memory CONTENTS (not bodies) concatenated → upper bound
 */

const fs = require('fs');
const path = require('path');

const { createWorkspace, buildAgentEnv, copyFixtures, cleanupWorkspace, installPromptsForAgent } = require('./brain-setup');
const { seedMemories } = require('./seeder');
const installer = require('../../src/installer');
const { generateDistractors } = require('./distractors');
const { sessionStart, recall, scoreRetrieval, formatSessionStartForPrompt } = require('./recall-probe');
const { createRunMetrics, recordPrompt, aggregateRuns } = require('./metrics');
const { pickJudge, judgeOne } = require('./judge');

const SEED_MODES = new Set([
  'none',                   // no memories at all
  'scenario',               // oracle memories from setup.memories only
  'scenario+distractors',   // oracle + N distractors (LongMemEval-style haystack)
  'distractors-only',       // distractors but no oracle (negative control)
]);

const INJECTION_MODES = new Set([
  'none',                   // no memory text in prompt
  'session-start',          // run `brain session-start` and prepend its payload
  'recall',                 // run `brain recall <query>` per prompt, inline top-k
  'dump-bodies',            // legacy: prepend every memory.body (today's behavior)
  'dump-contents',          // upper-bound: prepend every memory.content (long-context baseline)
]);

/**
 * Run all configured arms for a scenario across one agent.
 *
 * @param {Object} ctx - { scenarioName, agent, runsPerArm, setup, fixturesDir, scenarioDir, config, agentEnv, dotEnv }
 * @returns {Promise<Object<string, Object>>} arm name → aggregated metrics
 */
async function runArms(ctx) {
  const { scenarioName, agent, setup, runsPerArm } = ctx;
  const arms = setup.arms;
  if (!Array.isArray(arms) || arms.length === 0) {
    throw new Error(`${scenarioName}: setup.arms[] must declare at least one arm`);
  }

  const armResults = {};
  const continual = setup.continual === true && Array.isArray(setup.tasks);

  for (const arm of arms) {
    validateArm(arm);
    process.stdout.write(`      arm: ${arm.name}\n`);
    const runs = [];

    for (let i = 0; i < runsPerArm; i++) {
      const runStart = Date.now();
      try {
        const result = continual
          ? await executeContinualArm({ ...ctx, arm, runIndex: i })
          : await executeArmRun({ ...ctx, arm, runIndex: i });
        runs.push(result);
        const tokens = result.tokens.input + result.tokens.output;
        if (continual) {
          process.stdout.write(
            `        run ${i + 1}/${runsPerArm}: ` +
            `tokens=${tokens} tasks=${result.tasks.length} ` +
            `passed=${result.tasks.filter((t) => t.success).length}/${result.tasks.length}\n`
          );
        } else {
          process.stdout.write(
            `        run ${i + 1}/${runsPerArm}: ` +
            `tokens=${tokens} ` +
            `R@5=${formatRecall(result.retrieval, 5)} ` +
            `${result.success ? 'PASS' : 'FAIL'}\n`
          );
        }
      } catch (err) {
        const elapsed = Date.now() - runStart;
        console.error(`        run ${i + 1} failed (${elapsed}ms): ${err.message}`);
        runs.push({
          tokens: { input: 0, output: 0 }, time_ms: elapsed,
          success: false, consistency: 0, error: err.message,
          ...(continual ? { tasks: [] } : {}),
        });
      }
    }

    armResults[arm.name] = continual ? aggregateContinualArm(runs) : aggregateArm(runs);
  }

  return armResults;
}

/**
 * One run of one arm — isolated workspace, seed memories per arm config,
 * optionally invoke session-start/recall, run the prompts, judge.
 */
async function executeArmRun(ctx) {
  const { scenarioName, agent, arm, runIndex, setup, fixturesDir, config, agentEnv, dotEnv } = ctx;
  const { workDir, homeDir, brainDir } = createWorkspace(scenarioName, agent.name, arm.name, runIndex);
  const baseDir = path.dirname(workDir);

  try {
    if (fs.existsSync(fixturesDir)) copyFixtures(fixturesDir, workDir);

    // Seed memories per arm.seed mode
    await applySeeding({ arm, homeDir, setup, agentName: agent.name });

    const metrics = createRunMetrics();
    let retrieval = null;
    let memoryPrefix = '';

    // Build memory context per arm.memory_injection mode
    if (arm.memory_injection !== 'none' && arm.memory_injection !== undefined) {
      const ctxBlock = await buildMemoryBlock({ arm, homeDir, setup });
      memoryPrefix = ctxBlock.text;
      retrieval = ctxBlock.retrieval;
    }

    // Optional: prepend full skill bodies for ablation (default is index-only via session-start)
    if (arm.skill_load && Array.isArray(setup.skills)) {
      const block = buildSkillLoadBlock(arm.skill_load, setup.skills);
      if (block) memoryPrefix = (memoryPrefix || '') + block;
    }

    const runEnv = buildAgentEnv(homeDir, agentEnv, dotEnv);

    // Run the test prompts
    const outputs = [];
    for (const prompt of setup.test || []) {
      const fullPrompt = memoryPrefix + prompt.text;
      const result = await agent.run(fullPrompt, {
        cwd: workDir, timeout: config.timeouts.prompt_ms, env: runEnv,
      });
      recordPrompt(metrics, result, prompt.label || 'test');
      outputs.push(result.output);
    }

    // Read generated files for the judge
    const generatedFiles = readGeneratedFiles(workDir, fixturesDir);
    const candidate = [...outputs, ...generatedFiles.map((g) => `\n# ${g.path}\n${g.content}`)].join('\n\n');

    // Judge via cross-family LLM with rubric
    const judgeResult = setup.judge
      ? await judgeViaLlm({ agent, setup, candidate })
      : { passed: true, score: 1, criteria: [], rationale: 'no judge defined' };

    return {
      tokens: metrics.tokens,
      time_ms: metrics.time_ms,
      success: judgeResult.passed,
      score: judgeResult.score,
      consistency: judgeResult.score, // back-compat with old reporters
      retrieval,
      judge: { score: judgeResult.score, rationale: judgeResult.rationale, family: judgeResult.judge },
      output_chars: candidate.length,
    };
  } finally {
    cleanupWorkspace(baseDir);
  }
}

/**
 * Continual arm: ONE persistent workspace; iterate setup.tasks in order.
 * Between tasks, the agent is asked to memorize lessons learned via the
 * brain CLI — exercising the WRITE side end-to-end.
 *
 * The brain CLI path is injected into the memorize prompt so the agent
 * can invoke it regardless of $PATH in the isolated environment.
 */
async function executeContinualArm(ctx) {
  const { scenarioName, agent, arm, runIndex, setup, fixturesDir, config, agentEnv, dotEnv } = ctx;
  const path = require('path');
  const { workDir, homeDir, brainDir } = createWorkspace(scenarioName, agent.name, arm.name, runIndex);
  const baseDir = path.dirname(workDir);

  try {
    if (fs.existsSync(fixturesDir)) copyFixtures(fixturesDir, workDir);
    await applySeeding({ arm, homeDir, setup, agentName: agent.name });

    const runEnv = buildAgentEnv(homeDir, agentEnv, dotEnv);
    const totalMetrics = createRunMetrics();
    const taskResults = [];
    const brainBin = path.join(__dirname, '..', '..', 'bin', 'brain.js');

    for (let t = 0; t < setup.tasks.length; t++) {
      const task = setup.tasks[t];

      // Build memory injection per-task (fresh recall + session-start each time)
      let memoryPrefix = '';
      let retrieval = null;
      if (arm.memory_injection && arm.memory_injection !== 'none') {
        const block = await buildMemoryBlock({ arm, homeDir, setup });
        memoryPrefix = block.text;
        retrieval = block.retrieval;
      }

      const fullPrompt = memoryPrefix + task.text;
      const result = await agent.run(fullPrompt, {
        cwd: workDir, timeout: config.timeouts.prompt_ms, env: runEnv,
      });
      recordPrompt(totalMetrics, result, task.label || `task-${t + 1}`);

      // Capture this task's generated files (deltas)
      const generated = readGeneratedFiles(workDir, fixturesDir);
      const candidate = [result.output, ...generated.map((g) => `\n# ${g.path}\n${g.content}`)].join('\n\n');

      const judged = task.judge
        ? await judgeViaLlm({ agent, setup: { judge: task.judge, test: [task] }, candidate })
        : { passed: true, score: 1, rationale: 'no judge' };

      taskResults.push({
        label: task.label,
        success: judged.passed,
        score: judged.score,
        tokens: result.tokens.input + result.tokens.output,
        time_ms: result.time_ms,
        retrieval,
        judge_rationale: judged.rationale,
      });

      // Memorize step — only for arms that actually use brain
      if (arm.memorize !== false && arm.memory_injection !== 'none' && t < setup.tasks.length - 1) {
        const memorizePrompt = buildMemorizePrompt(brainBin, task, setup);
        try {
          const memResult = await agent.run(memorizePrompt, {
            cwd: workDir, timeout: config.timeouts.prompt_ms, env: runEnv,
          });
          recordPrompt(totalMetrics, memResult, `${task.label}-memorize`);
        } catch (err) {
          console.error(`        memorize step failed for ${task.label}: ${err.message}`);
        }
      }
    }

    return {
      tokens: totalMetrics.tokens,
      time_ms: totalMetrics.time_ms,
      tasks: taskResults,
      success: taskResults.every((t) => t.success),
    };
  } finally {
    cleanupWorkspace(baseDir);
  }
}

function buildMemorizePrompt(brainBin, task, setup) {
  return `You just completed: "${task.label}". Before moving on, capture one or two short, durable lessons from this task as brain memories so future sessions benefit.

Use the brain CLI (it is available at: node ${brainBin} memorize). Pass a JSON object on stdin or as an arg with shape:

  { "type": "<learning|decision|insight|preference>",
    "title": "<short title>",
    "body": "<one or two sentence summary>",
    "tags": ["tag1", "tag2"],
    "encoding_context": { "project": "${setup.context?.project || ''}", "topics": [], "task_type": "implementing" } }

Store at most 2 memories. Then stop — no other actions. Keep it concise. Do NOT re-read source files or re-explain the fix.`;
}

async function applySeeding({ arm, homeDir, setup, agentName }) {
  const mode = arm.seed || 'scenario';
  if (!SEED_MODES.has(mode)) throw new Error(`Unknown seed mode: ${mode}`);
  if (mode === 'none') return;

  // createWorkspace only initializes the brain for legacy "with_brain" variants;
  // arm-mode bypasses that, so we init here before seeding.
  const fs = require('fs');
  const path = require('path');
  if (!fs.existsSync(path.join(homeDir, '.brain', 'index.json'))) {
    installer.initializeBrain(homeDir);
    if (agentName) installPromptsForAgent(homeDir, agentName);
  }

  const oracle = (mode === 'scenario' || mode === 'scenario+distractors') ? (setup.memories || []) : [];
  const distractors = (mode === 'scenario+distractors' || mode === 'distractors-only')
    ? generateDistractors(arm.distractor_size || 200, arm.distractor_seed || 42)
    : [];

  const all = [...oracle, ...distractors];
  if (all.length === 0) return;

  seedMemories(homeDir, all, {
    associations: setup.associations || [],
    context: setup.context || null,
  });

  // Phase 1: pinning. Pin the oracle memories that the scenario marks `pin: true`,
  // *unless* the arm explicitly disables pinning.
  if (arm.pin !== false) {
    const toPin = oracle.filter((m) => m.pin === true);
    for (const m of toPin) {
      try { writePinned(homeDir, m); }
      catch (e) { console.error(`pin failed for ${m.id}: ${e.message}`); }
    }
  }

  // Phase 2: skills. If arm.skills !== false, install scenario.skills into ~/.brain/_skills/
  if (arm.skills !== false && Array.isArray(setup.skills)) {
    installSkills(homeDir, setup.skills);
  }
}

function writePinned(homeDir, mem) {
  const pinnedPath = path.join(homeDir, '.brain', 'pinned.json');
  let pinned = { version: 1, entries: [] };
  if (fs.existsSync(pinnedPath)) pinned = JSON.parse(fs.readFileSync(pinnedPath, 'utf-8'));
  pinned.entries = pinned.entries.filter((e) => e.id !== mem.id);
  pinned.entries.push({
    id: mem.id,
    scope: mem.pin_scope || 'global',
    priority: mem.pin_priority || 5,
    pinned_at: new Date().toISOString(),
  });
  fs.writeFileSync(pinnedPath, JSON.stringify(pinned, null, 2));
}

function installSkills(homeDir, skills) {
  const skillsDir = path.join(homeDir, '.brain', '_skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  const indexPath = path.join(homeDir, '.brain', 'skills-index.json');
  let idx = { version: 1, skills: [] };
  if (fs.existsSync(indexPath)) idx = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

  for (const s of skills) {
    const dir = path.join(skillsDir, s.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'),
      `# ${s.name}\n\n${s.description}\n\n${s.body || ''}\n`);
    idx.skills = idx.skills.filter((x) => x.name !== s.name);
    idx.skills.push({
      name: s.name,
      description: s.description,
      strength: s.strength || 0.6,
      use_count: s.use_count || 0,
      created: new Date().toISOString(),
    });
  }
  fs.writeFileSync(indexPath, JSON.stringify(idx, null, 2));
}

/**
 * Build the memory text block prepended to test prompts AND, if oracle IDs
 * are declared, score Recall@k from the retrieved IDs.
 */
async function buildMemoryBlock({ arm, homeDir, setup }) {
  const mode = arm.memory_injection;
  if (!INJECTION_MODES.has(mode)) throw new Error(`Unknown memory_injection: ${mode}`);

  if (mode === 'none') return { text: '', retrieval: null };

  if (mode === 'session-start') {
    const payload = await sessionStart({
      homeDir,
      project: setup.context?.project,
      topics: (setup.context?.topics || []).join(','),
      task: setup.context?.task_type,
      top: arm.session_start_top || 5,
    });
    const text = formatSessionStartForPrompt(payload);
    const retrieval = scoreRetrievalFromSessionStart(payload, setup.oracle_memory_ids);
    return { text, retrieval };
  }

  if (mode === 'recall') {
    const query = setup.recall_query || setup.test?.[0]?.text || '';
    const ranked = await recall({
      homeDir, query,
      project: setup.context?.project,
      topics: (setup.context?.topics || []).join(','),
      task: setup.context?.task_type,
      top: arm.recall_top || 10,
    });
    const text = formatRecallForPrompt(ranked.slice(0, arm.recall_top || 5));
    const retrieval = setup.oracle_memory_ids
      ? scoreRetrieval(ranked, setup.oracle_memory_ids)
      : null;
    return { text, retrieval };
  }

  if (mode === 'dump-bodies') {
    return { text: dumpBodies(setup.memories || []), retrieval: null };
  }

  if (mode === 'dump-contents') {
    return { text: dumpContents(setup.memories || []), retrieval: null };
  }

  return { text: '', retrieval: null };
}

function scoreRetrievalFromSessionStart(payload, oracleIds) {
  if (!Array.isArray(oracleIds) || oracleIds.length === 0) return null;
  const surfaced = [
    ...(payload.pinned || []).map((p) => ({ id: p.id })),
    ...(payload.context_recall || []).map((m) => ({ id: m.id })),
  ];
  return scoreRetrieval(surfaced, oracleIds);
}

function formatRecallForPrompt(ranked) {
  if (!ranked || ranked.length === 0) return '';
  const lines = ['Relevant memories from your past sessions:\n'];
  for (const m of ranked) {
    lines.push(`  • ${m.title || m.id}: ${m.body || ''}`.trim());
  }
  lines.push('');
  return lines.join('\n');
}

function dumpBodies(memories) {
  if (memories.length === 0) return '';
  const lines = ['Based on your past experience with this project, you recall:\n'];
  for (const m of memories) lines.push(`- ${m.body || m.title || m.id}`);
  lines.push('');
  return lines.join('\n');
}

function dumpContents(memories) {
  if (memories.length === 0) return '';
  const lines = ['Full memory contents from your past sessions:\n'];
  for (const m of memories) {
    lines.push(`\n## ${m.title || m.id}`);
    lines.push(m.content || m.body || '');
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Build a prompt block carrying full SKILL.md bodies.
 *
 * mode = 'relevant' — load only skills where setup-author marked `relevant: true`
 *        (simulates: agent looked at L0 index and chose to load the matching skill)
 * mode = 'all'      — load every skill body (naïve baseline; quantifies token waste)
 */
function buildSkillLoadBlock(mode, skills) {
  let targets = [];
  if (mode === 'relevant') targets = skills.filter((s) => s.relevant === true);
  else if (mode === 'all') targets = skills;
  if (targets.length === 0) return '';

  const lines = ['', 'Full skill bodies (loaded into context):', ''];
  for (const s of targets) {
    lines.push(`# Skill: ${s.name}`);
    lines.push(s.body || s.description || '');
    lines.push('');
  }
  return lines.join('\n');
}

async function judgeViaLlm({ agent, setup, candidate }) {
  const judge = setup.judge.family || pickJudge(agent.name);
  return judgeOne({
    judge,
    question: setup.judge.question || setup.test?.[0]?.text || '',
    oracleAnswer: setup.judge.oracle_answer || '',
    rubric: setup.judge.rubric || [],
    candidate,
  });
}

/* ─────────────────────────── helpers ─────────────────────────── */

function validateArm(arm) {
  if (!arm.name) throw new Error('arm.name required');
  if (arm.seed && !SEED_MODES.has(arm.seed)) {
    throw new Error(`arm.seed must be one of ${[...SEED_MODES].join(', ')}`);
  }
  if (arm.memory_injection && !INJECTION_MODES.has(arm.memory_injection)) {
    throw new Error(`arm.memory_injection must be one of ${[...INJECTION_MODES].join(', ')}`);
  }
}

function aggregateArm(runs) {
  const base = aggregateRuns(runs);
  if (!base) return null;

  // tokens_per_success = total tokens / successes  (∞ → reported as null)
  const successes = runs.filter((r) => r.success).length;
  const totalTokens = runs.reduce((s, r) => s + r.tokens.input + r.tokens.output, 0);
  const tokensPerSuccess = successes > 0 ? Math.round(totalTokens / successes) : null;

  // Median Recall@k across runs (skip arms without retrieval)
  const withRetrieval = runs.filter((r) => r.retrieval && r.retrieval.recall);
  const recallByK = {};
  if (withRetrieval.length > 0) {
    const ks = Object.keys(withRetrieval[0].retrieval.recall);
    for (const k of ks) {
      const vals = withRetrieval.map((r) => r.retrieval.recall[k]).sort((a, b) => a - b);
      recallByK[k] = vals[Math.floor(vals.length / 2)];
    }
  }

  return {
    ...base,
    tokens_per_success: tokensPerSuccess,
    retrieval: Object.keys(recallByK).length > 0 ? { recall: recallByK } : null,
    judge_pass_rate: runs.filter((r) => r.success).length / runs.length,
  };
}

/**
 * Aggregate a continual-arm's runs. Reports:
 *   - per-task pass rate (across runs)
 *   - cumulative tokens
 *   - forward-transfer Δ: (task 1 tokens) - (task N tokens)
 */
function aggregateContinualArm(runs) {
  if (runs.length === 0) return null;

  const taskCount = runs[0].tasks?.length || 0;
  const perTaskPass = Array(taskCount).fill(0);
  const perTaskTokens = Array.from({ length: taskCount }, () => []);
  const perTaskTime = Array.from({ length: taskCount }, () => []);

  for (const run of runs) {
    (run.tasks || []).forEach((t, i) => {
      if (i >= taskCount) return;
      if (t.success) perTaskPass[i]++;
      perTaskTokens[i].push(t.tokens || 0);
      perTaskTime[i].push(t.time_ms || 0);
    });
  }

  const median = (arr) => {
    const sorted = arr.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  };

  const taskMedians = perTaskTokens.map(median);
  const forwardTransfer = taskMedians.length >= 2
    ? taskMedians[0] - taskMedians[taskMedians.length - 1]
    : 0;

  const totalRuns = runs.length;
  const totalTokens = runs.reduce((s, r) => s + (r.tokens?.input || 0) + (r.tokens?.output || 0), 0);
  const totalTime = runs.reduce((s, r) => s + (r.time_ms || 0), 0);
  const allTaskPass = runs.every((r) => r.success);
  const completedRuns = runs.filter((r) => r.success).length;

  return {
    tokens: {
      input: Math.round(runs.reduce((s, r) => s + (r.tokens?.input || 0), 0) / totalRuns),
      output: Math.round(runs.reduce((s, r) => s + (r.tokens?.output || 0), 0) / totalRuns),
    },
    time_ms: Math.round(totalTime / totalRuns),
    runs: totalRuns,
    success_rate: completedRuns / totalRuns,
    judge_pass_rate: completedRuns / totalRuns,
    tokens_per_success: completedRuns > 0 ? Math.round(totalTokens / completedRuns) : null,
    per_task_pass_rate: perTaskPass.map((c) => Math.round((c / totalRuns) * 100) / 100),
    per_task_median_tokens: taskMedians,
    per_task_median_time_ms: perTaskTime.map(median),
    forward_transfer_tokens: forwardTransfer,
    success: allTaskPass,
    consistency: completedRuns / totalRuns,
  };
}

function formatRecall(retrieval, k) {
  if (!retrieval || !retrieval.recall) return '—';
  return (retrieval.recall[k] ?? 0).toFixed(2);
}

function readGeneratedFiles(workDir, fixturesDir) {
  const out = [];
  const fixtureRel = new Set();
  if (fs.existsSync(fixturesDir)) walk(fixturesDir, fixturesDir, (rel) => fixtureRel.add(rel));
  walk(workDir, workDir, (rel, abs) => {
    if (!fixtureRel.has(rel)) {
      try { out.push({ path: rel, content: fs.readFileSync(abs, 'utf-8') }); }
      catch { /* skip binaries */ }
    }
  });
  return out;
}

function walk(dir, base, cb) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, base, cb);
    else cb(path.relative(base, abs), abs);
  }
}

module.exports = { runArms };
