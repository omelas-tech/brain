#!/usr/bin/env node

/**
 * Brain Memory Benchmark Runner
 *
 * Main orchestrator that runs identical coding tasks across AI agents
 * with and without brain memory context, measuring tokens, success,
 * and consistency.
 *
 * Modes:
 *   cloud (default) — Uses each agent's native cloud API
 *   ollama          — Routes all agents through local Ollama for controlled comparison
 *
 * Usage:
 *   node harness/runner.js                        # Cloud APIs, all scenarios, all agents
 *   node harness/runner.js --ollama               # Local Ollama mode
 *   node harness/runner.js --scenario continuity   # Single scenario
 *   node harness/runner.js --agent claude          # Single agent
 *   node harness/runner.js --runs 5                # Override run count
 *   node harness/runner.js --dry-run               # Show plan without executing
 */

const fs = require('fs');
const path = require('path');

const { detectAvailable, getAgent } = require('./agents');
const { createWorkspace, buildAgentEnv, copyFixtures, cleanupWorkspace } = require('./brain-setup');
const { seedMemories } = require('./seeder');
const { createRunMetrics, recordPrompt, aggregateRuns, computeSummary } = require('./metrics');
const { saveResult, saveAllResults, printResult, printSummary } = require('./reporter');
const { loadEnv } = require('./env');
const { runArms } = require('./arm-runner');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const SCENARIOS_DIR = path.join(__dirname, '..', 'scenarios');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

  // Load API keys from benchmark/.env (if present)
  const dotEnv = loadEnv();
  const envKeyCount = Object.keys(dotEnv).length;

  // Propagate .env into process.env so in-process callers (the judge HTTPS
  // calls in harness/judge.js) can see the keys. Existing process.env values
  // win — explicit shell exports take precedence over the .env file.
  for (const [k, v] of Object.entries(dotEnv)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  // Also map GOOGLE_API_KEY → GEMINI_API_KEY for the judge (Gemini side).
  if (process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
  }

  // Resolve mode: cloud (default) or ollama
  const mode = args.ollama ? 'ollama' : (config.mode || 'cloud');
  const modeConfig = config[mode] || {};

  console.log('  Brain Memory Benchmark');
  console.log('  ══════════════════════\n');
  console.log(`  Mode:   ${mode}${mode === 'ollama' ? ` (${modeConfig.model || 'default'})` : ' (native APIs)'}`);
  if (envKeyCount > 0) {
    console.log(`  Env:    ${envKeyCount} key(s) loaded from .env`);
  } else {
    console.log('  Env:    no .env file — using inherited environment');
  }
  // Detect available agents
  const availableAgents = await detectAvailable();
  const agentNames = availableAgents.map((a) => a.name);
  console.log(`  Agents: ${agentNames.join(', ') || 'none'}`);

  if (availableAgents.length === 0) {
    console.error('  No agents available. Install claude, gemini, or codex CLI.');
    process.exit(1);
  }

  // Filter agents — respect config.enabled_agents (used to drop e.g. Codex
  // when it does not report token usage), then any explicit --agent override.
  const enabledList = Array.isArray(config.enabled_agents) && config.enabled_agents.length > 0
    ? config.enabled_agents
    : null;
  let targetAgents = enabledList
    ? availableAgents.filter((a) => enabledList.includes(a.name))
    : availableAgents;
  if (args.agent) {
    // Explicit --agent bypasses the enabled_agents filter (e.g. run the local
    // `ollama` agent without adding it to the default cloud config).
    targetAgents = availableAgents.filter((a) => a.name === args.agent);
  }

  if (targetAgents.length === 0) {
    console.error(`  Agent "${args.agent}" is not available.`);
    process.exit(1);
  }

  // Discover scenarios
  const targetScenarios = args.scenario
    ? config.scenarios.filter((s) => s.includes(args.scenario))
    : config.scenarios;

  console.log(`  Scenarios: ${targetScenarios.join(', ')}`);
  console.log(`  Runs:      ${args.runs || config.runs_per_scenario}`);
  console.log('');

  if (args.dryRun) {
    console.log('  [dry-run] Would execute the above plan.');
    return;
  }

  const runsPerScenario = args.runs || config.runs_per_scenario;
  const allResults = [];

  for (const scenarioName of targetScenarios) {
    const scenarioDir = path.join(SCENARIOS_DIR, scenarioName);
    if (!fs.existsSync(scenarioDir)) {
      console.log(`  Skipping ${scenarioName}: directory not found`);
      continue;
    }

    const result = await runScenario(scenarioName, scenarioDir, targetAgents, {
      config, modeConfig, mode, runsPerScenario, dotEnv,
      armsFilter: args.arms, distractorOverride: args.distractorSize,
    });

    if (result) {
      printResult(result);
      saveResult(result);
      allResults.push(result);
    }
  }

  if (allResults.length > 0) {
    printSummary(allResults);
    const { jsonPath, markdownPath } = saveAllResults(allResults);
    console.log(`  Results saved to:`);
    console.log(`    JSON:     ${jsonPath}`);
    console.log(`    Markdown: ${markdownPath}`);
  }
}

/**
 * Run a single scenario across all agents.
 */
async function runScenario(scenarioName, scenarioDir, agents, { config, modeConfig, mode, runsPerScenario, dotEnv, armsFilter, distractorOverride }) {
  console.log(`  ── ${scenarioName} ──`);

  // Load scenario setup
  const setupPath = path.join(scenarioDir, 'setup.json');
  if (!fs.existsSync(setupPath)) {
    console.log(`    Skipping: no setup.json found`);
    return null;
  }

  const setup = JSON.parse(fs.readFileSync(setupPath, 'utf-8'));
  const fixturesDir = path.join(scenarioDir, 'fixtures');
  const evaluatePath = path.join(scenarioDir, 'evaluate.js');
  const evaluate = fs.existsSync(evaluatePath) ? require(evaluatePath) : null;

  const agentResults = {};
  const isArmScenario = Array.isArray(setup.arms) && setup.arms.length > 0;

  for (const agent of agents) {
    console.log(`    ${agent.name}:`);
    agentResults[agent.name] = {};

    // Resolve env overrides for ollama mode
    const agentEnv = mode === 'ollama'
      ? (modeConfig.agents?.[agent.name]?.env || {})
      : {};

    if (isArmScenario) {
      const armed = await runArms({
        scenarioName, agent, runsPerArm: runsPerScenario,
        setup, fixturesDir, scenarioDir, config, agentEnv, dotEnv,
        armsFilter, distractorOverride,
      });
      agentResults[agent.name] = armed;
      continue;
    }

    for (const variant of ['with_brain', 'without_brain']) {
      const runs = [];

      for (let run = 0; run < runsPerScenario; run++) {
        const runStart = Date.now();
        try {
          const result = await executeRun(
            scenarioName, agent, variant, run,
            { setup, fixturesDir, evaluate, config, agentEnv, dotEnv }
          );
          runs.push(result);
          process.stdout.write(`      ${variant} run ${run + 1}/${runsPerScenario}: ` +
            `tokens=${result.tokens.input + result.tokens.output} ` +
            `time=${result.time_ms}ms ` +
            `${result.success ? 'PASS' : 'FAIL'}\n`);
        } catch (err) {
          const elapsed = Date.now() - runStart;
          console.error(`      ${variant} run ${run + 1} failed (${elapsed}ms): ${err.message}`);
          runs.push({
            tokens: { input: 0, output: 0 },
            time_ms: elapsed,
            success: false,
            consistency: 0,
            error: err.message,
          });
        }
      }

      agentResults[agent.name][variant] = aggregateRuns(runs);
    }
  }

  // Compute cross-agent summary (skip for new arm-scenarios; reporter handles them)
  const summary = isArmScenario ? null : computeCrossAgentSummary(agentResults);

  // Model label for results
  const modelLabel = mode === 'ollama'
    ? (modeConfig.model || 'ollama')
    : 'cloud (claude-sonnet / gemini-flash / gpt)';

  return {
    scenario: scenarioName,
    model: modelLabel,
    mode,
    timestamp: new Date().toISOString(),
    results: agentResults,
    summary,
  };
}

/**
 * Execute a single benchmark run for one agent+variant.
 *
 * For "with_brain": prepend relevant memory context to each prompt.
 * This simulates what brain-memory does — surfacing past decisions,
 * preferences, and learnings as context for the agent.
 *
 * For "without_brain": use bare prompts with no memory context.
 */
async function executeRun(scenarioName, agent, variant, runIndex, { setup, fixturesDir, evaluate, config, agentEnv, dotEnv }) {
  const { workDir, homeDir, brainDir } = createWorkspace(scenarioName, agent.name, variant, runIndex);

  // Base directory for cleanup (parent of workDir and homeDir)
  const baseDir = path.dirname(workDir);

  try {
    // Copy fixture files
    copyFixtures(fixturesDir, workDir);

    // Seed memories into the isolated brain for with_brain variant
    if (variant === 'with_brain' && setup.memories && brainDir) {
      seedMemories(homeDir, setup.memories, {
        associations: setup.associations || [],
        context: setup.context || null,
      });
    }

    const metrics = createRunMetrics();

    // Build memory context prefix for with_brain variant
    // This supplements the brain system prompt with inline context
    const memoryPrefix = variant === 'with_brain'
      ? buildMemoryContext(setup.memories || [])
      : '';

    // Build isolated env: HOME points to isolated dir, API keys from .env
    const runEnv = buildAgentEnv(homeDir, agentEnv, dotEnv);

    // Run test prompts only (fixtures provide the base project)
    const testPrompts = setup.test || [];
    const testOutputs = [];

    for (const prompt of testPrompts) {
      const fullPrompt = memoryPrefix + prompt.text;
      const result = await agent.run(fullPrompt, {
        cwd: workDir,
        timeout: config.timeouts.prompt_ms,
        env: runEnv,
      });
      recordPrompt(metrics, result, prompt.label || 'test');
      testOutputs.push(result.output);
    }

    // Evaluate using both workspace files and agent output text
    let success = true;
    let consistency = 1.0;

    if (evaluate) {
      const fileContents = readGeneratedFiles(workDir, fixturesDir);
      const allOutputs = [...testOutputs, ...fileContents];
      const evalResult = evaluate.evaluate(workDir, allOutputs, setup);
      success = evalResult.success;
      consistency = evalResult.consistency || evalResult.score || 1.0;
    }

    return {
      tokens: metrics.tokens,
      time_ms: metrics.time_ms,
      success,
      consistency,
    };
  } finally {
    cleanupWorkspace(baseDir);
  }
}

/**
 * Read files generated by the agent (files in workDir that weren't in fixtures).
 */
function readGeneratedFiles(workDir, fixturesDir) {
  const contents = [];
  const fixtureFiles = new Set();

  if (fs.existsSync(fixturesDir)) {
    collectFiles(fixturesDir, fixturesDir, fixtureFiles);
  }

  collectNewFiles(workDir, workDir, fixtureFiles, contents);
  return contents;
}

function collectFiles(dir, baseDir, set) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === '.brain' || entry.name.startsWith('.')) continue;
      collectFiles(full, baseDir, set);
    } else {
      set.add(path.relative(baseDir, full));
    }
  }
}

function collectNewFiles(dir, baseDir, fixtureFiles, contents) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === '.brain' || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      collectNewFiles(full, baseDir, fixtureFiles, contents);
    } else {
      const rel = path.relative(baseDir, full);
      if (!fixtureFiles.has(rel)) {
        try {
          contents.push(fs.readFileSync(full, 'utf-8'));
        } catch { /* skip unreadable */ }
      }
    }
  }
}

/**
 * Build a memory context prefix from seeded memories.
 * This simulates brain-memory's recall — surfacing relevant past context
 * as conversational recall rather than injected instructions.
 */
function buildMemoryContext(memories) {
  if (!memories || memories.length === 0) return '';

  const TYPE_VERBS = {
    decision: 'You decided',
    preference: 'You prefer',
    learning: 'You learned',
    insight: 'You realized',
    experience: 'You experienced',
    goal: 'Your goal is',
    observation: 'You noticed',
    relationship: 'You noted',
  };

  const lines = [
    'Based on your past experience with this project, you recall:',
    '',
  ];

  for (const mem of memories) {
    const verb = TYPE_VERBS[mem.type] || 'You noted';
    const summary = mem.body || mem.title || mem.id;
    lines.push(`- ${verb}: ${summary}`);
  }

  lines.push('');

  return lines.join('\n');
}

/**
 * Compute summary across all agents.
 */
function computeCrossAgentSummary(agentResults) {
  const allWithBrain = [];
  const allWithoutBrain = [];

  for (const data of Object.values(agentResults)) {
    if (data.with_brain) allWithBrain.push(data.with_brain);
    if (data.without_brain) allWithoutBrain.push(data.without_brain);
  }

  if (allWithBrain.length === 0 || allWithoutBrain.length === 0) return null;

  const avgWith = averageResults(allWithBrain);
  const avgWithout = averageResults(allWithoutBrain);

  return computeSummary(avgWith, avgWithout);
}

function averageResults(results) {
  const n = results.length;
  return {
    tokens: {
      input: Math.round(results.reduce((s, r) => s + r.tokens.input, 0) / n),
      output: Math.round(results.reduce((s, r) => s + r.tokens.output, 0) / n),
    },
    time_ms: Math.round(results.reduce((s, r) => s + r.time_ms, 0) / n),
    success_rate: results.filter((r) => r.success).length / n,
    consistency: Math.round((results.reduce((s, r) => s + r.consistency, 0) / n) * 1000) / 1000,
  };
}

/**
 * Parse CLI arguments.
 */
function parseArgs(argv) {
  const args = { scenario: null, agent: null, runs: null, dryRun: false, ollama: false, opencodeModel: null, arms: null, distractorSize: null };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--scenario':
        args.scenario = argv[++i];
        break;
      case '--agent':
        args.agent = argv[++i];
        break;
      case '--runs':
        args.runs = parseInt(argv[++i], 10);
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--ollama':
        args.ollama = true;
        break;
      case '--opencode-model':
        args.opencodeModel = argv[++i];
        break;
      case '--arms':
        args.arms = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--distractor-size':
        args.distractorSize = parseInt(argv[++i], 10);
        break;
    }
  }

  if (args.opencodeModel) process.env.OPENCODE_BENCH_MODEL = args.opencodeModel;

  return args;
}

// Guard: only run when executed directly, never on `require` (importing this
// file for tests/tooling must not kick off a real benchmark run).
if (require.main === module) {
  main().catch((err) => {
    console.error(`\n  Fatal: ${err.message}`);
    process.exit(1);
  });
}
