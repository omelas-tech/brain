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
const { pinMemory } = require('../../src/pinning');
const { generateDistractors, generateHardNegatives } = require('./distractors');
const { sessionStart, recall, scoreRetrieval, formatSessionStartForPrompt } = require('./recall-probe');
const { createRunMetrics, recordPrompt, aggregateRuns, summarizeOutcomes, classifyRun, OUTCOME } = require('./metrics');
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
  'dump-bodies',            // prepend memory.body for the seeded corpus
  'dump-contents',          // prepend memory.content for the seeded corpus (long-context baseline)
  'oracle',                 // upper bound: inject exactly the labeled oracle memories
  'keyword',                // baseline retriever: lexical/BM25 over the corpus
  'vector',                 // baseline retriever: local dense embeddings (vector-store stand-in)
  'mem0',                   // baseline retriever: real hosted vector store (gated on keys)
]);

/**
 * Run all configured arms for a scenario across one agent.
 *
 * @param {Object} ctx - { scenarioName, agent, runsPerArm, setup, fixturesDir, scenarioDir, config, agentEnv, dotEnv }
 * @returns {Promise<Object<string, Object>>} arm name → aggregated metrics
 */
async function runArms(ctx) {
  const { scenarioName, agent, setup, runsPerArm } = ctx;
  if (!Array.isArray(setup.arms) || setup.arms.length === 0) {
    throw new Error(`${scenarioName}: setup.arms[] must declare at least one arm`);
  }
  let arms = setup.arms;
  // Optional --arms subset filter and --distractor-size override (fast pilots).
  if (Array.isArray(ctx.armsFilter) && ctx.armsFilter.length) {
    arms = arms.filter((a) => ctx.armsFilter.includes(a.name));
  }
  if (ctx.distractorOverride != null && !Number.isNaN(ctx.distractorOverride)) {
    arms = arms.map((a) => (a.distractor_size ? { ...a, distractor_size: ctx.distractorOverride } : a));
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
          outcome: OUTCOME.NONE, reason: classifyError(err),
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

    // Build memory context per arm.memory_injection mode. Every arm injects
    // into ONE canonical wrapper (uniform header/delimiters/position) — only
    // the CONTENT differs, never the structure. This removes the prompt-shape
    // confound between session-start / dump / retriever arms.
    if (arm.memory_injection !== 'none' && arm.memory_injection !== undefined) {
      const ctxBlock = await buildMemoryBlock({ arm, homeDir, setup });
      memoryPrefix = wrapContextBlock(ctxBlock.text);
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
      const result = await runAgentWithRetry(agent, fullPrompt, {
        cwd: workDir, timeout: config.timeouts.prompt_ms, env: runEnv,
      });
      recordPrompt(metrics, result, prompt.label || 'test');
      outputs.push(result.output);
    }

    // Read generated files for the judge
    const generatedFiles = readGeneratedFiles(workDir, fixturesDir);
    const candidate = [...outputs, ...generatedFiles.map((g) => `\n# ${g.path}\n${g.content}`)].join('\n\n');

    // Judge via cross-family LLM with rubric — OR, in defer mode, export the
    // candidate + rubric to a JSONL for an external judge (e.g. a Claude
    // workflow grading a local-model agent) and mark the run as deferred.
    let judgeResult;
    if (process.env.BENCH_DEFER_JUDGE && setup.judge) {
      exportCandidate({
        scenario: scenarioName, agent: agent.name, model: process.env.OLLAMA_BENCH_MODEL || agent.name,
        arm: arm.name, run: runIndex,
        question: setup.judge.question || setup.test?.[0]?.text || '',
        rubric: setup.judge.rubric || [],
        candidate,
        tokens: metrics.tokens,
        retrieval,
      });
      judgeResult = { passed: false, score: 0, criteria: [], rationale: 'DEFERRED', deferred: true };
    } else if (setup.judge) {
      judgeResult = await judgeViaLlm({ agent, setup, candidate });
    } else {
      judgeResult = { passed: true, score: 1, criteria: [], rationale: 'no judge defined' };
    }

    return {
      tokens: metrics.tokens,
      time_ms: metrics.time_ms,
      outcome: judgeResult.passed ? OUTCOME.PASS : OUTCOME.FAIL,
      success: judgeResult.passed,
      score: judgeResult.score,
      consistency: judgeResult.score, // back-compat with old reporters
      retrieval,
      judge: {
        score: judgeResult.score,
        rationale: judgeResult.rationale,
        family: judgeResult.judge,
        criteria: judgeResult.criteria || [],
      },
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
      const result = await runAgentWithRetry(agent, fullPrompt, {
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

    const allPass = taskResults.length > 0 && taskResults.every((t) => t.success);
    return {
      tokens: totalMetrics.tokens,
      time_ms: totalMetrics.time_ms,
      tasks: taskResults,
      success: allPass,
      outcome: allPass ? OUTCOME.PASS : OUTCOME.FAIL,
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
  const seedsDistractors = (mode === 'scenario+distractors' || mode === 'distractors-only');
  const distractors = seedsDistractors
    ? generateDistractors(arm.distractor_size || 200, arm.distractor_seed || 42)
    : [];
  // Hard negatives are seeded alongside distractors so the brain arms face the
  // SAME haystack the retriever-baseline arms see (buildCorpus mirrors this).
  const hardNegs = (setup.hard_negatives && seedsDistractors)
    ? generateHardNegatives(setup.memories || [], setup.hard_negatives, (arm.distractor_seed || 42) + 1)
    : [];

  const all = [...oracle, ...distractors, ...hardNegs];
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
      // Use the real pin API: session-start reads `entry.pinned` from the INDEX
      // as the source of truth, so writing pinned.json alone is a silent no-op.
      const res = pinMemory(homeDir, m.id, { scope: m.pin_scope || 'global', priority: m.pin_priority || 5 });
      if (res && res.error) console.error(`pin failed for ${m.id}: ${res.error}`);
    }
  }

  // Phase 2: skills. If arm.skills !== false, install scenario.skills into ~/.brain/_skills/
  if (arm.skills !== false && Array.isArray(setup.skills)) {
    installSkills(homeDir, setup.skills);
  }
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

  if (mode === 'dump-bodies' || mode === 'dump-contents') {
    // "Dump everything" baselines. When the arm seeds distractors, dump the
    // WHOLE haystack (oracle + distractors) — that's what makes the unbounded
    // variant blow the context budget. A `dump_budget_tokens` cap turns this
    // into the FAIR bounded baseline that stops at a realistic budget.
    const corpus = (arm.seed && arm.seed.includes('distractors'))
      ? buildCorpus(arm, setup)
      : (setup.memories || []);
    const budget = arm.dump_budget_tokens || null;
    const text = mode === 'dump-bodies' ? dumpBodies(corpus, budget) : dumpContents(corpus, budget);
    return { text, retrieval: null };
  }

  if (mode === 'oracle') {
    // Upper bound: inject exactly the labeled oracle memories (perfect retrieval).
    const ids = setup.oracle_memory_ids || (setup.memories || []).map((m) => m.id);
    const oracleMems = (setup.memories || []).filter((m) => ids.includes(m.id));
    const retrieval = setup.oracle_memory_ids
      ? scoreRetrieval(oracleMems.map((m) => ({ id: m.id })), setup.oracle_memory_ids)
      : null;
    return { text: formatMemItemsForPrompt(oracleMems), retrieval };
  }

  if (mode === 'keyword' || mode === 'vector' || mode === 'mem0') {
    // Baseline retrievers over the same corpus Brain sees. Only the retrieval
    // METHOD differs from the brain-real arm — same wrapper, same budget.
    const retriever = loadRetriever(mode);
    const corpus = buildCorpus(arm, setup);
    const query = setup.recall_query || setup.test?.[0]?.text || '';
    const top = arm.recall_top || 5;
    const ranked = await retriever.retrieve(corpus, query, { top: Math.max(top, 10) });
    const text = formatMemItemsForPrompt(ranked.slice(0, top));
    const retrieval = setup.oracle_memory_ids ? scoreRetrieval(ranked, setup.oracle_memory_ids) : null;
    return { text, retrieval };
  }

  return { text: '', retrieval: null };
}

/* ─────────────── context-block wrapper & retriever plumbing ─────────────── */

/**
 * Wrap injected memory in ONE canonical envelope. All arms share this exact
 * header/delimiters/position so the only thing varying across arms is the
 * memory CONTENT, not the prompt structure (removes the framing confound).
 */
function wrapContextBlock(inner) {
  if (!inner || !inner.trim()) return '';
  return `=== BEGIN MEMORY CONTEXT ===\n` +
    `The following is what you recall that may be relevant to the task. Use it where appropriate.\n\n` +
    `${inner.trim()}\n` +
    `=== END MEMORY CONTEXT ===\n\n`;
}

/** Uniform, header-less item list (the wrapper supplies the header). */
function formatMemItemsForPrompt(mems) {
  if (!mems || mems.length === 0) return '';
  return mems.map((m) => `  • ${m.title || m.id}: ${m.body || ''}`.trim()).join('\n');
}

/** Lazily load a baseline retriever module by injection mode. */
function loadRetriever(mode) {
  if (mode === 'keyword') return require('./retrievers/keyword');
  if (mode === 'vector') return require('./retrievers/vector-baseline');
  if (mode === 'mem0') return require('./retrievers/mem0');
  throw new Error(`no retriever for mode: ${mode}`);
}

/** Reconstruct the seeded corpus (oracle + distractors + hard negatives) for retrievers/dumps. */
function buildCorpus(arm, setup) {
  const oracle = setup.memories || [];
  const distractors = (arm.distractor_size && arm.distractor_size > 0)
    ? generateDistractors(arm.distractor_size, arm.distractor_seed || 42)
    : [];
  const hardNegs = setup.hard_negatives
    ? generateHardNegatives(oracle, setup.hard_negatives, (arm.distractor_seed || 42) + 1)
    : [];
  return [...oracle, ...distractors, ...hardNegs];
}

/** Map a thrown agent error to a coarse reason code for NO_COMPLETION runs. */
function classifyError(err) {
  const m = (err && err.message || '').toLowerCase();
  if (m.includes('timed out') || m.includes('timeout')) return 'timeout';
  if (/econnreset|etimedout|enotfound|socket|network|exited with code|stream parse/.test(m)) return 'infra';
  if (m.includes('parse')) return 'parse';
  return 'other';
}

/**
 * Run an agent prompt, retrying ONCE on transient infra errors. A genuine
 * timeout (model couldn't finish in budget) is a real result and is NOT
 * retried — we don't want to mask the scaling wall a dump baseline hits.
 */
async function runAgentWithRetry(agent, prompt, opts, retries = 1) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await agent.run(prompt, opts);
    } catch (err) {
      lastErr = err;
      if (classifyError(err) !== 'infra' || attempt === retries) throw err;
      process.stdout.write(`        infra error, retrying once: ${String(err.message).slice(0, 80)}\n`);
    }
  }
  throw lastErr;
}

function scoreRetrievalFromSessionStart(payload, oracleIds) {
  if (!Array.isArray(oracleIds) || oracleIds.length === 0) return null;
  const surfaced = [
    ...(payload.pinned || []).map((p) => ({ id: p.id })),
    ...(payload.context_recall || []).map((m) => ({ id: m.id })),
  ];
  return scoreRetrieval(surfaced, oracleIds);
}

// All three formatters below are HEADER-LESS — wrapContextBlock() supplies the
// single canonical header so prompt structure is uniform across arms.

function formatRecallForPrompt(ranked) {
  if (!ranked || ranked.length === 0) return '';
  return ranked.map((m) => `  • ${m.title || m.id}: ${m.body || ''}`.trim()).join('\n');
}

// estimate tokens for a string (chars/4 heuristic, matching distractors.js)
function estTokens(s) { return Math.ceil((s || '').length / 4); }

function dumpBodies(memories, budgetTokens = null) {
  if (!memories || memories.length === 0) return '';
  const lines = [];
  let used = 0;
  for (const m of memories) {
    const line = `- ${m.body || m.title || m.id}`;
    const cost = estTokens(line);
    if (budgetTokens && used + cost > budgetTokens) break;
    used += cost;
    lines.push(line);
  }
  return lines.join('\n');
}

function dumpContents(memories, budgetTokens = null) {
  if (!memories || memories.length === 0) return '';
  const lines = [];
  let used = 0;
  for (const m of memories) {
    const block = `\n## ${m.title || m.id}\n${m.content || m.body || ''}`;
    const cost = estTokens(block);
    if (budgetTokens && used + cost > budgetTokens) break;
    used += cost;
    lines.push(block);
  }
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

/** Append a candidate + rubric record to the defer-judge JSONL (BENCH_DEFER_JUDGE=path). */
function exportCandidate(rec) {
  const file = process.env.BENCH_DEFER_JUDGE;
  try { fs.appendFileSync(file, JSON.stringify(rec) + '\n'); }
  catch (e) { console.error(`defer-judge export failed: ${e.message}`); }
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
  if (runs.length === 0) return null;

  const outcomes = summarizeOutcomes(runs);
  // Token/time medians come from COMPLETED runs only — a NO_COMPLETION run has
  // zero tokens and must not deflate the economy. Fall back to all runs if none
  // completed (so the row still renders, as `—`).
  const completedRuns = runs.filter((r) => classifyRun(r) !== OUTCOME.NONE);
  const metricsRuns = completedRuns.length > 0 ? completedRuns : runs;
  const med = (vals) => {
    const s = vals.slice().sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };

  const inputs = metricsRuns.map((r) => r.tokens.input || 0);
  const outputs = metricsRuns.map((r) => r.tokens.output || 0);
  const times = metricsRuns.map((r) => r.time_ms || 0);
  const tokenTotals = metricsRuns.map((r) => (r.tokens.input || 0) + (r.tokens.output || 0));

  // tokens-per-success = total tokens spent across ALL attempts / passes.
  const totalTokensAll = runs.reduce((s, r) => s + (r.tokens.input || 0) + (r.tokens.output || 0), 0);
  const tokensPerSuccess = outcomes.passes > 0 ? Math.round(totalTokensAll / outcomes.passes) : null;

  // Median Recall@k across runs that scored retrieval (skip arms without it).
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
    tokens: { input: med(inputs), output: med(outputs) },
    time_ms: med(times),
    runs: runs.length,
    ...outcomes, // total, passes, completed, no_completion, completion_rate, success_rate, no_completion_rate
    success: outcomes.passes > runs.length / 2,   // back-compat with old reporters
    consistency: outcomes.success_rate,            // back-compat
    judge_pass_rate: outcomes.success_rate,        // back-compat
    median_tokens: med(tokenTotals),
    token_samples: tokenTotals,                    // raw, for stats.js bootstrap CI
    tokens_per_success: tokensPerSuccess,
    retrieval: Object.keys(recallByK).length > 0 ? { recall: recallByK } : null,
    criteria_pass_rate: computeCriteriaPassRate(runs),
  };
}

/** Per-criterion pass rate across runs (which rubric items Brain helps with). */
function computeCriteriaPassRate(runs) {
  const byN = new Map();
  for (const r of runs) {
    const crit = r.judge && r.judge.criteria;
    if (!Array.isArray(crit)) continue;
    for (const c of crit) {
      if (typeof c.n !== 'number') continue;
      if (!byN.has(c.n)) byN.set(c.n, { met: 0, total: 0 });
      const e = byN.get(c.n);
      e.total++;
      if (c.met === true) e.met++;
    }
  }
  if (byN.size === 0) return null;
  return [...byN.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, e]) => ({ n, pass_rate: Math.round((e.met / e.total) * 1000) / 1000 }));
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
