/**
 * Direct-to-Ollama agent adapter.
 *
 * Unlike the claude/gemini CLI adapters (which drive an agentic harness that
 * edits files in the workspace), this adapter talks straight to the local
 * Ollama HTTP API and returns the model's text output. The benchmark task asks
 * the model to PRODUCE the code; the candidate graded by the judge is that text
 * (rubric criteria like "uses Redis", "composable returns reactive state" are
 * checkable against the generated code in the reply). This keeps the local-model
 * path simple and free of CLI/LiteLLM protocol plumbing.
 *
 * Model selection: OLLAMA_BENCH_MODEL (default gemma3:12b).
 * Server: OLLAMA_URL (default http://localhost:11434).
 */

const http = require('http');

const AGENT_NAME = 'ollama';
const DEFAULT_MODEL = 'gemma3:12b';

function model() { return process.env.OLLAMA_BENCH_MODEL || DEFAULT_MODEL; }
function baseUrl() { return process.env.OLLAMA_URL || 'http://localhost:11434'; }

function isAvailable() {
  return new Promise((resolve) => {
    const u = new URL('/api/tags', baseUrl());
    const req = http.get(u, { timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Run a prompt against the local model.
 * @returns {Promise<{output:string, raw:Object, tokens:{input:number,output:number}, time_ms:number}>}
 */
function run(prompt, { timeout = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL('/api/chat', baseUrl());
    const body = JSON.stringify({
      model: model(),
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      keep_alive: '10m',
      options: { temperature: 0, num_predict: parseInt(process.env.OLLAMA_NUM_PREDICT || '2048', 10) },
    });

    const startTime = Date.now();
    const req = http.request({
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      timeout,
    }, (res) => {
      let buf = '';
      res.setEncoding('utf-8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        const time_ms = Date.now() - startTime;
        if (res.statusCode >= 400) {
          return reject(new Error(`Ollama HTTP ${res.statusCode}: ${buf.slice(0, 300)}`));
        }
        try {
          const json = JSON.parse(buf);
          resolve({
            output: (json.message && json.message.content) || '',
            raw: json,
            tokens: {
              input: json.prompt_eval_count || 0,
              output: json.eval_count || 0,
            },
            time_ms,
          });
        } catch (e) {
          reject(new Error(`Ollama JSON parse: ${e.message} — ${buf.slice(0, 200)}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`Ollama request failed: ${err.message}`)));
    req.on('timeout', () => { req.destroy(new Error(`Ollama timed out after ${timeout}ms`)); });
    req.write(body);
    req.end();
  });
}

module.exports = { name: AGENT_NAME, isAvailable, run, get model() { return model(); } };
