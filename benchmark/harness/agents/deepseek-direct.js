/**
 * Direct-to-DeepSeek agent adapter (text-only, single-shot).
 *
 * Parallel to ollama-direct: talks straight to DeepSeek's Anthropic-compatible
 * endpoint and returns the model's text output — NO agentic loop, NO file
 * editing, NO fixture access. This makes DeepSeek apples-to-apples with the
 * local Ollama models (same single-shot, code-in-the-reply framing), isolating
 * memory's effect instead of letting an agentic run rediscover conventions by
 * reading the fixture files.
 *
 * Auth: DEEPSEEK_API_KEY (export from Keychain before running).
 * Model: DEEPSEEK_BENCH_MODEL (default deepseek-v4-pro).
 * Output budget: DEEPSEEK_NUM_PREDICT (default 8192 — v4-pro emits thinking
 *   blocks, so leave room for reasoning + the actual code).
 */

const https = require('https');

const AGENT_NAME = 'deepseek';
const DEFAULT_MODEL = 'deepseek-v4-pro';

function model() { return process.env.DEEPSEEK_BENCH_MODEL || DEFAULT_MODEL; }

function isAvailable() {
  return Promise.resolve(!!process.env.DEEPSEEK_API_KEY);
}

/**
 * Cache-honest usage normalization.
 *
 * DeepSeek's context caching is AUTOMATIC: a repeated prompt prefix is served
 * from cache and, on the /anthropic endpoint, `usage.input_tokens` counts ONLY
 * the non-cached slice — the cached prefix moves to `cache_read_input_tokens`
 * (verified empirically 2026-07-05: identical prompt twice → call 1
 * {input_tokens: 4511, cache_read_input_tokens: 0}, call 2
 * {input_tokens: 31, cache_read_input_tokens: 4480}). Reading `input_tokens`
 * alone therefore undercounts repeat runs ~20x. For the benchmark, a token is
 * a token whether or not the provider discounted it: `input` is the FULL
 * prompt size (miss + cached + cache-creation), and the cache split is kept in
 * `input_cached` so cost-in-dollars analysis stays possible.
 *
 * Also handles DeepSeek's native OpenAI-style fields
 * (`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`, which partition the
 * full prompt) in case the endpoint or provider version changes.
 *
 * @param {Object} u - provider `usage` object
 * @returns {{input:number, output:number, input_cached:number}}
 */
function normalizeUsage(u = {}) {
  const cacheRead = u.cache_read_input_tokens || 0;
  const cacheCreation = u.cache_creation_input_tokens || 0;
  const hit = u.prompt_cache_hit_tokens || 0;
  const miss = u.prompt_cache_miss_tokens || 0;

  let input, cached;
  if (u.input_tokens != null) {
    // Anthropic-style: input_tokens EXCLUDES the cached prefix.
    input = (u.input_tokens || 0) + cacheRead + cacheCreation;
    cached = cacheRead;
  } else if (hit || miss) {
    // DeepSeek-native OpenAI-style: hit + miss = full prompt.
    input = hit + miss;
    cached = hit;
  } else {
    input = u.prompt_tokens || 0;
    cached = 0;
  }
  return {
    input,
    output: u.output_tokens != null ? (u.output_tokens || 0) : (u.completion_tokens || 0),
    input_cached: cached,
  };
}

function run(prompt, { timeout = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) return reject(new Error('DEEPSEEK_API_KEY not set'));

    const body = JSON.stringify({
      model: model(),
      max_tokens: parseInt(process.env.DEEPSEEK_NUM_PREDICT || '8192', 10),
      messages: [{ role: 'user', content: prompt }],
    });

    const startTime = Date.now();
    const req = https.request({
      hostname: 'api.deepseek.com',
      path: '/anthropic/v1/messages',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${key}`,
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
          return reject(new Error(`DeepSeek HTTP ${res.statusCode}: ${buf.slice(0, 300)}`));
        }
        try {
          const j = JSON.parse(buf);
          // Extract the assistant's TEXT blocks (skip "thinking" blocks).
          const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('');
          resolve({
            output: text,
            raw: j,
            tokens: normalizeUsage(j.usage),
            time_ms,
          });
        } catch (e) {
          reject(new Error(`DeepSeek JSON parse: ${e.message} — ${buf.slice(0, 200)}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`DeepSeek request failed: ${err.message}`)));
    req.on('timeout', () => { req.destroy(new Error(`DeepSeek timed out after ${timeout}ms`)); });
    req.write(body);
    req.end();
  });
}

module.exports = { name: AGENT_NAME, isAvailable, run, normalizeUsage, get model() { return model(); } };
