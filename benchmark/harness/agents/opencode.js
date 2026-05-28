/**
 * OpenCode agent adapter (routes to DeepSeek V4 Pro by default).
 *
 * Invokes `opencode run --model deepseek/deepseek-v4-pro --format json <prompt>`.
 * OpenCode emits a line-delimited JSON event stream — we concatenate `text`
 * events for the output and sum `tokens` from `step_finish` events.
 *
 * The provider/model is configured in ~/.config/opencode/opencode.json which
 * the benchmark harness copies into the isolated HOME via brain-setup.js.
 */

const { execFile, spawn } = require('child_process');

const AGENT_NAME = 'opencode';
const DEFAULT_MODEL_FALLBACK = 'deepseek/deepseek-v4-pro';
function resolveModel() {
  return process.env.OPENCODE_BENCH_MODEL || DEFAULT_MODEL_FALLBACK;
}

function isAvailable() {
  return new Promise((resolve) => {
    execFile('opencode', ['--version'], { timeout: 5000 }, (err) => resolve(!err));
  });
}

function run(prompt, { cwd, timeout = 300000, env = {} }) {
  return new Promise((resolve, reject) => {
    const args = [
      'run',
      '--model', resolveModel(),
      '--format', 'json',
      prompt,
    ];

    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;

    const proc = spawn('opencode', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env && env.HOME ? env : { ...process.env, ...env },
    });

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGTERM');
      // Force-kill after a 5-second grace; without this the rmSync in
      // cleanupWorkspace can block for minutes on file handles held by
      // the still-living subprocess.
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 5000);
      reject(new Error(`OpenCode timed out after ${timeout}ms`));
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const time_ms = Date.now() - startTime;

      if (code !== 0 && !stdout) {
        return reject(new Error(`OpenCode exited with code ${code}\n${stderr.slice(0, 400)}`));
      }

      try {
        const parsed = parseStream(stdout);
        resolve({
          output: parsed.output,
          raw: parsed.events,
          tokens: parsed.tokens,
          time_ms,
          cost: parsed.cost,
        });
      } catch (e) {
        reject(new Error(`OpenCode stream parse failed: ${e.message}\nfirst 400 chars of stdout:\n${stdout.slice(0, 400)}`));
      }
    });
  });
}

/**
 * Parse OpenCode's JSON event stream (one JSON object per line).
 * - Concatenate text from `text` events
 * - Sum tokens across `step_finish` events
 * - Sum cost
 */
function parseStream(raw) {
  const events = [];
  let output = '';
  let input = 0, outputTok = 0, reasoning = 0, totalCost = 0;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt;
    try { evt = JSON.parse(trimmed); } catch { continue; /* skip non-JSON lines */ }
    events.push(evt);

    if (evt.type === 'text' && evt.part?.text) {
      output += evt.part.text;
    } else if (evt.type === 'step_finish' && evt.part?.tokens) {
      const t = evt.part.tokens;
      input += t.input || 0;
      outputTok += t.output || 0;
      reasoning += t.reasoning || 0;
      totalCost += evt.part.cost || 0;
    }
  }

  return {
    events,
    output,
    tokens: { input, output: outputTok + reasoning },
    cost: totalCost,
  };
}

module.exports = { name: AGENT_NAME, isAvailable, run, get model() { return resolveModel(); } };
