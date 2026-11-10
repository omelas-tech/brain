/**
 * Direct-to-Anthropic agent adapter (text-only, single-shot).
 *
 * The sibling of deepseek-direct: one Messages API call, the model's text
 * reply returned as the candidate. NO Claude Code CLI — that would bring its
 * own system prompt, tools, hooks, CLAUDE.md and auto memory into every arm and
 * confound exactly what the benchmark measures. Single-shot keeps the arms
 * comparable: the only thing that varies is the memory block the arm injects.
 *
 * Auth:   ANTHROPIC_API_KEY (benchmark/.env — the brain-benchmark workspace key).
 * Model:  CLAUDE_BENCH_MODEL (default claude-sonnet-5-5).
 * Budget: CLAUDE_NUM_PREDICT (default 16384). No extended thinking is requested,
 *         so the budget is all answer. A run that hits it with no text is
 *         rejected (→ NO_COMPLETION, reason 'budget'), never scored.
 * Sampling: no temperature is sent — newer Claude models reject the parameter.
 */

const https = require('https');

const AGENT_NAME = 'claude-direct';
const DEFAULT_MODEL = 'claude-sonnet-5-5';

function model() { return process.env.CLAUDE_BENCH_MODEL || DEFAULT_MODEL; }

function isAvailable() {
  return Promise.resolve(!!process.env.ANTHROPIC_API_KEY);
}

/**
 * Cache-honest usage: `input` is the full prompt (uncached + cache read +
 * cache creation), with the cached slice kept separately — same contract as
 * deepseek-direct, so tokens compare across agents.
 */
function normalizeUsage(u = {}) {
  const cacheRead = u.cache_read_input_tokens || 0;
  const cacheCreation = u.cache_creation_input_tokens || 0;
  return {
    input: (u.input_tokens || 0) + cacheRead + cacheCreation,
    output: u.output_tokens || 0,
    input_cached: cacheRead,
  };
}

function run(prompt, { timeout = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return reject(new Error('ANTHROPIC_API_KEY not set'));

    const body = JSON.stringify({
      model: model(),
      max_tokens: parseInt(process.env.CLAUDE_NUM_PREDICT || '16384', 10),
      messages: [{ role: 'user', content: prompt }],
    });

    const startTime = Date.now();
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-length': Buffer.byteLength(body),
      },
      timeout,
    }, (res) => {
      let buf = '';
      res.setEncoding('utf-8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        const time_ms = Date.now() - startTime;
        if (res.statusCode >= 400) {
          return reject(new Error(`Anthropic HTTP ${res.statusCode}: ${buf.slice(0, 300)}`));
        }
        try {
          const j = JSON.parse(buf);
          const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('');
          if (!text.trim() && j.stop_reason === 'max_tokens') {
            return reject(new Error('Claude output budget exhausted (max_tokens) before any answer text — raise CLAUDE_NUM_PREDICT'));
          }
          resolve({ output: text, raw: j, tokens: normalizeUsage(j.usage), time_ms });
        } catch (e) {
          reject(new Error(`Anthropic JSON parse: ${e.message} — ${buf.slice(0, 200)}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`Anthropic request failed: ${err.message}`)));
    req.on('timeout', () => { req.destroy(new Error(`Anthropic timed out after ${timeout}ms`)); });
    req.write(body);
    req.end();
  });
}

module.exports = { name: AGENT_NAME, isAvailable, run, normalizeUsage, get model() { return model(); } };
