/**
 * Claude Code agent adapter.
 *
 * Runs prompts via `claude -p` in headless mode with JSON output.
 * Uses spawn (not execFile) to avoid buffering issues.
 */

const { execFile, spawn } = require('child_process');

const AGENT_NAME = 'claude';

/**
 * Check if Claude Code CLI is installed and accessible.
 * @returns {Promise<boolean>}
 */
function isAvailable() {
  return new Promise((resolve) => {
    execFile('claude', ['--version'], { timeout: 5000 }, (err) => {
      resolve(!err);
    });
  });
}

/**
 * Run a prompt through Claude Code CLI.
 *
 * @param {string} prompt - The prompt text to send
 * @param {Object} options
 * @param {string} options.cwd - Working directory for the agent
 * @param {number} options.timeout - Timeout in milliseconds
 * @param {Object} [options.env] - Additional environment variables
 * @returns {Promise<{output: string, raw: Object, tokens: {input: number, output: number}, time_ms: number}>}
 */
function run(prompt, { cwd, timeout = 300000, env = {} }) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', prompt,
      '--output-format', 'json',
      '--permission-mode', 'bypassPermissions',
      '--model', 'sonnet',
      '--max-turns', '15',
    ];

    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;

    // env already includes process.env + HOME override from buildAgentEnv
    const proc = spawn('claude', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env && env.HOME ? env : { ...process.env, ...env },
    });

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill();
        reject(new Error(`Claude timed out after ${timeout}ms`));
      }
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;

      const time_ms = Date.now() - startTime;

      if (code !== 0 && !stdout) {
        return reject(new Error(`Claude exited with code ${code}\n${stderr}`));
      }

      try {
        const raw = JSON.parse(stdout);
        // Claude Code signals failures in-band: { is_error: true } or a
        // subtype like "error_during_execution" / "error_max_turns". These
        // carry NO usage (tokens=0) and an error string in `result`. Surfacing
        // them as a THROW (instead of silently resolving with tokens=0) lets the
        // retry/backoff path handle transient rate-limit/overload errors — and
        // stops a 429 from being mis-scored as a genuine task FAIL.
        const subtype = typeof raw.subtype === 'string' ? raw.subtype : '';
        if (raw.is_error === true || subtype.startsWith('error')) {
          const detail = String(raw.result || raw.error || subtype || 'unknown').slice(0, 400);
          return reject(new Error(`Claude result error [${subtype || 'is_error'}]: ${detail}`));
        }
        const tokens = extractTokens(raw);
        const output = extractOutput(raw);
        resolve({ output, raw, tokens, time_ms });
      } catch (parseErr) {
        // Unparseable stdout — if the process also failed, treat as an error so
        // it can be retried rather than judged as an empty (failing) candidate.
        if (code !== 0 || !stdout.trim()) {
          return reject(new Error(`Claude produced no parseable result (code ${code}): ${stderr.slice(0, 300) || stdout.slice(0, 300)}`));
        }
        resolve({
          output: stdout.trim(),
          raw: { stdout, stderr },
          tokens: { input: 0, output: 0 },
          time_ms,
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new Error(`Claude failed to start: ${err.message}`));
      }
    });
  });
}

/**
 * Extract token usage from Claude's JSON output.
 * Claude format: { usage: { input_tokens, cache_creation_input_tokens,
 *                           cache_read_input_tokens, output_tokens } }
 *
 * `input` counts every prompt token the model PROCESSED, regardless of whether
 * it was served fresh, written to cache, or read from cache:
 *   input = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
 *
 * Why count cache_read (the ~10%-billed re-reads) at full weight? Because it is
 * the only CACHE-WARMTH-IMMUNE choice. The constant ~30K Claude Code system
 * prompt is `cache_creation` on a cold run but `cache_read` on a warm one;
 * excluding cache_read would make the metric depend on which arm warmed the
 * cache first — i.e. arm ORDER would bias results. Counting all processed tokens
 * identically makes the number reproducible and the cross-arm comparison fair.
 * It is a "total tokens processed across the agentic loop" metric: more turns /
 * larger context legitimately cost more (latency + 10% billing), which is
 * exactly the inefficiency Brain aims to reduce. Reported `token_samples` feed
 * the bootstrap-CI / Mann–Whitney analysis, so stability matters more than a
 * smaller headline number.
 */
function extractTokens(raw) {
  if (raw && raw.usage) {
    const u = raw.usage;
    return {
      input: (u.input_tokens || 0) +
             (u.cache_creation_input_tokens || 0) +
             (u.cache_read_input_tokens || 0),
      output: u.output_tokens || 0,
    };
  }
  return { input: 0, output: 0 };
}

/**
 * Extract the text output from Claude's JSON response.
 */
function extractOutput(raw) {
  if (raw && typeof raw.result === 'string') return raw.result;
  if (raw && raw.result && typeof raw.result.text === 'string') return raw.result.text;
  if (raw && typeof raw.text === 'string') return raw.text;
  return JSON.stringify(raw);
}

module.exports = { name: AGENT_NAME, isAvailable, run };
