/**
 * Cross-family LLM judge with rubric and position-swap.
 *
 * Methodology (LongMemEval, arxiv 2410.10813):
 *   - Judge model belongs to a DIFFERENT family than the agent under test
 *     (avoids preference leakage — arxiv 2502.01534).
 *   - Rubric is per-question, explicit, and supplied with the oracle answer.
 *   - For pairwise (arm-vs-arm) judgments, the order of the two candidates
 *     is swapped on a second call; verdict is kept only if it survives swap.
 *   - Output is structured JSON so downstream aggregation is deterministic.
 *
 * The judge talks directly to the provider HTTP APIs (Anthropic + Google).
 * It does NOT shell out to the agent CLIs — those run with bypassed permissions
 * and are configured for code execution, not judgment.
 *
 * Required env (loaded by harness/env.js):
 *   ANTHROPIC_API_KEY  — for Claude judge
 *   GEMINI_API_KEY     — for Gemini judge (Google AI Studio)
 *
 * Default judge selection (see pickJudge):
 *   agent under test  →  judge family
 *   claude            →  gemini
 *   gemini            →  claude
 *   codex             →  claude   (different family from OpenAI)
 *   any (cross-agent) →  claude   (deterministic default)
 */

const https = require('https');
const http = require('http');

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const GEMINI_MODEL = 'gemini-2.5-flash';
const JUDGE_TIMEOUT_MS = 90_000;
// Must hold a full rubric verdict: up to 8 criteria, each with an evidence
// string, plus a rationale. 800 truncated Gemini mid-JSON ("no JSON object").
const JUDGE_MAX_TOKENS = 2000;
// Local Ollama judges are slower than cloud and DeepSeek-v4 emits a thinking
// block before its JSON, so both get longer budgets than the cloud judges.
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_JUDGE_TIMEOUT_MS = 240_000;
const DEEPSEEK_JUDGE_TIMEOUT_MS = 180_000;
const DEEPSEEK_JUDGE_MAX_TOKENS = 4096;

/**
 * The committed cross-family judge PANEL.
 *
 * Every member is a DIFFERENT model family from the agent under test
 * (Claude Code) — so none can preference-leak toward its own outputs
 * (arXiv 2502.01534). A candidate passes the panel only when a MAJORITY of
 * judges pass it, and each rubric criterion is decided by majority vote across
 * judges — single-judge noise (small local models drift) is averaged out.
 *
 * Overridable via config.judges (benchmark/config.json) or env (model ids).
 */
const DEFAULT_PANEL = [
  { id: 'deepseek_v4', provider: 'deepseek', model: process.env.DEEPSEEK_JUDGE_MODEL || 'deepseek-v4-pro' },
  { id: 'gemma4',      provider: 'ollama',   model: process.env.GEMMA_JUDGE_MODEL || 'gemma4:12b' },
  { id: 'qwen_35',     provider: 'ollama',   model: process.env.QWEN_JUDGE_MODEL || 'qwen3.5:9b' },
];
// Candidate-output budget handed to the judge. Raised from 12k so the judge
// grades the full generated artifact instead of a head-truncated slice that
// can hide the proof of correctness.
const CANDIDATE_MAX_CHARS = 40_000;

/**
 * Pick the appropriate judge family for an agent under test.
 * Forbids same-family judging.
 *
 * @param {string} agentName - 'claude' | 'gemini' | 'codex'
 * @returns {'claude'|'gemini'}
 */
function pickJudge(agentName) {
  // Default cross-family map. DeepSeek-via-OpenCode is judged by Claude
  // (different family). Codex (OpenAI) → Claude. Claude → Gemini.
  if (agentName === 'claude') return 'gemini';
  return 'claude';
}

/**
 * Judge a single candidate output against a rubric.
 *
 * @param {Object} params
 * @param {string} params.judge - 'claude' | 'gemini'
 * @param {string} params.question - The task the agent was given
 * @param {string} params.oracleAnswer - Reference answer / expected behavior
 * @param {string[]} params.rubric - Bullet criteria, each one a binary check
 * @param {string} params.candidate - Agent output (text + concatenated generated files)
 * @returns {Promise<{score: number, passed: boolean, criteria: Object[], rationale: string, judge: string, raw: string}>}
 */
async function judgeOne({ judge, question, oracleAnswer, rubric, candidate, includeOracle = false }) {
  // `includeOracle` defaults to FALSE: rubric-only grading. Showing the judge
  // the reference answer at grade time invites keyword-matching the oracle
  // instead of reasoning about the rubric (leakage). The oracle answer is
  // reserved for human validation of the judge, not the judge itself.
  const prompt = buildSingleRubricPrompt({ question, oracleAnswer, rubric, candidate, includeOracle });
  const raw = await callJudgeSpec(judge, prompt);
  const parsed = parseJudgeJson(raw, rubric.length);
  const label = typeof judge === 'string' ? judge : (judge.id || judge.provider);
  return { ...parsed, judge: label, raw };
}

/**
 * Run a candidate past a PANEL of judges and aggregate by majority vote.
 *
 * Aggregation (the objective core):
 *   - Each rubric criterion is decided by majority vote across the judges that
 *     returned a verdict for it → a per-criterion `met` and an overall score.
 *   - The candidate `passed` iff a strict majority of valid judges passed it.
 *   - `agreement` = fraction of valid judges siding with the majority verdict
 *     (1.0 = unanimous, ~0.5 = split) — a transparency signal, not a gate.
 *   - A judge that errors or returns unparseable JSON is excluded (recorded in
 *     `panel[].error`); the vote proceeds on the remaining valid judges.
 *
 * @param {Object} p - { judges: spec[], question, oracleAnswer, rubric, candidate }
 * @returns {Promise<{passed, score, criteria, rationale, judge, panel, agreement, n_valid}>}
 */
async function judgePanel({ judges, question, oracleAnswer, rubric, candidate }) {
  const runOne = async (spec) => {
    const id = spec.id || spec.provider;
    try {
      const v = await judgeOne({ judge: spec, question, oracleAnswer, rubric, candidate });
      return { id, passed: v.passed, score: v.score, criteria: v.criteria, rationale: v.rationale };
    } catch (e) {
      return { id, error: String(e.message).slice(0, 160) };
    }
  };

  // Ollama judges share one local backend — loading two 7GB models at once
  // thrashes memory and times out. Run them SEQUENTIALLY; let remote judges
  // (deepseek/gemini) run concurrently alongside.
  const ollama = judges.filter((j) => j.provider === 'ollama');
  const remote = judges.filter((j) => j.provider !== 'ollama');
  const [ollamaResults, remoteResults] = await Promise.all([
    (async () => { const out = []; for (const s of ollama) out.push(await runOne(s)); return out; })(),
    Promise.all(remote.map(runOne)),
  ]);
  const byId = new Map([...ollamaResults, ...remoteResults].map((r) => [r.id, r]));
  const panel = judges.map((j) => byId.get(j.id || j.provider));

  const valid = panel.filter((p) => !p.error);
  // Decide each criterion by MAJORITY vote across judges, then apply the 0.7
  // threshold to the agreed criteria — rather than voting on each judge's own
  // (noisy, sometimes self-contradicting) `passed` flag. This is both more
  // principled and tie-resistant: two judges that agree on 6/7 criteria yield a
  // pass even if they disagree on their overall verdict.
  const criteria = majorityCriteria(valid, rubric.length);
  const metCount = criteria.filter((c) => c.met).length;
  const score = rubric.length ? Math.round((metCount / rubric.length) * 1000) / 1000 : 0;
  const PASS_THRESHOLD = 0.7;
  const passed = valid.length > 0 && score >= PASS_THRESHOLD;
  // Agreement = fraction of valid judges whose own verdict matches the panel.
  const concur = valid.filter((p) => p.passed === passed).length;
  const agreement = valid.length ? Math.round((concur / valid.length) * 1000) / 1000 : 0;
  const errs = panel.length - valid.length;
  return {
    passed, score, criteria,
    rationale: `panel ${valid.filter((p) => p.passed).length}/${valid.length} pass · score ${score}`
      + (errs ? ` · ${errs} judge error` : '')
      + (valid.length ? ` · ${Math.round(agreement * 100)}% agree` : ''),
    judge: `panel:${valid.map((p) => p.id).join('+') || 'none'}`,
    panel, agreement, n_valid: valid.length,
  };
}

/** Majority-vote each rubric criterion (1..n) across the valid judges. */
function majorityCriteria(valid, n) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    let met = 0, total = 0;
    for (const p of valid) {
      const c = (p.criteria || []).find((x) => x && x.n === i);
      if (!c) continue;
      total++;
      if (c.met === true) met++;
    }
    out.push({ n: i, met: total > 0 && met > total / 2 });
  }
  return out;
}

/**
 * Pairwise judgment of two candidates (arm A vs arm B) with position swap.
 *
 * Runs the judge twice — once with (A, B), once with (B, A). Returns the
 * unswapped verdict if and only if both orderings agree. Otherwise marks
 * the result as `tied` (position-biased).
 *
 * @param {Object} params - As judgeOne, plus { candidateA, candidateB, labelA, labelB }
 * @returns {Promise<{winner: 'A'|'B'|'tie', position_bias: boolean, judge: string, ...}>}
 */
async function judgePair({ judge, question, rubric, candidateA, candidateB, labelA, labelB }) {
  const fwd = await callJudge(judge, buildPairwisePrompt({
    question, rubric, first: candidateA, second: candidateB, firstLabel: labelA, secondLabel: labelB,
  }));
  const rev = await callJudge(judge, buildPairwisePrompt({
    question, rubric, first: candidateB, second: candidateA, firstLabel: labelB, secondLabel: labelA,
  }));

  const fwdVerdict = parsePairwiseJson(fwd);
  const revVerdict = parsePairwiseJson(rev);

  // Map both verdicts onto the canonical A/B labels.
  const fwdWinsA = fwdVerdict.winner === 'first';
  const revWinsA = revVerdict.winner === 'second';

  let winner;
  let positionBias = false;
  if (fwdWinsA && revWinsA) winner = 'A';
  else if (!fwdWinsA && !revWinsA && fwdVerdict.winner !== 'tie' && revVerdict.winner !== 'tie') winner = 'B';
  else if (fwdVerdict.winner === 'tie' && revVerdict.winner === 'tie') winner = 'tie';
  else { winner = 'tie'; positionBias = true; }

  return {
    judge, winner, position_bias: positionBias,
    forward: fwdVerdict, reverse: revVerdict,
  };
}

function buildSingleRubricPrompt({ question, oracleAnswer, rubric, candidate, includeOracle = false }) {
  const rubricList = rubric.map((c, i) => `  ${i + 1}. ${c}`).join('\n');
  const referenceSection = includeOracle && oracleAnswer
    ? `\n# Reference / expected behavior\n${oracleAnswer.trim()}\n`
    : '';
  return `You are evaluating an AI coding agent's output against a rubric.

Score strictly. Do not give partial credit for criteria that are partially met — each criterion is binary (met / not met). Judge ONLY against the rubric below.

# Task given to the agent
${question.trim()}
${referenceSection}
# Rubric (${rubric.length} binary criteria)
${rubricList}

# Agent's output (text + generated files concatenated)
\`\`\`
${truncate(candidate, CANDIDATE_MAX_CHARS)}
\`\`\`

Respond with ONLY a JSON object (no prose, no markdown fence) in this exact shape:
{
  "criteria": [
    { "n": 1, "met": true,  "evidence": "<≤80 chars from output that proves it>" },
    { "n": 2, "met": false, "evidence": "<why not, ≤80 chars>" }
    // ...one per criterion
  ],
  "rationale": "<≤200 char summary>",
  "passed": <true if at least ceil(0.7 * N) criteria are met, else false>
}`;
}

function buildPairwisePrompt({ question, rubric, first, second, firstLabel, secondLabel }) {
  const rubricList = rubric.map((c, i) => `  ${i + 1}. ${c}`).join('\n');
  return `You are comparing two AI coding agents' outputs on the same task. Judge strictly by the rubric.

# Task
${question.trim()}

# Rubric
${rubricList}

# Output ${firstLabel} (FIRST)
\`\`\`
${truncate(first, 8000)}
\`\`\`

# Output ${secondLabel} (SECOND)
\`\`\`
${truncate(second, 8000)}
\`\`\`

Which output better satisfies the rubric? Respond with ONLY this JSON:
{
  "winner": "first" | "second" | "tie",
  "score_first":  <0..${rubric.length}>,
  "score_second": <0..${rubric.length}>,
  "rationale": "<≤200 chars>"
}`;
}

/* ─────────────────────────── provider calls ─────────────────────────── */

async function callJudge(family, prompt) {
  if (family === 'claude') return callAnthropic(prompt);
  if (family === 'gemini') return callGemini(prompt);
  throw new Error(`Unknown judge family: ${family}`);
}

/**
 * Dispatch a judge call by spec. Accepts either a legacy family string
 * ('claude'|'gemini') or a panel spec object { id, provider, model }.
 */
function callJudgeSpec(spec, prompt) {
  if (typeof spec === 'string') return callJudge(spec, prompt);
  switch (spec.provider) {
    case 'claude':   return callAnthropic(prompt);
    case 'gemini':   return callGemini(prompt);
    case 'deepseek': return callDeepseek(prompt, spec.model);
    case 'ollama':   return callOllama(prompt, spec.model);
    default: throw new Error(`Unknown judge provider: ${spec.provider}`);
  }
}

function callAnthropic(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set — judge cannot run');
  const body = JSON.stringify({
    model: ANTHROPIC_MODEL,
    max_tokens: JUDGE_MAX_TOKENS,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });
  return httpsJson({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-length': Buffer.byteLength(body),
    },
  }, body).then((res) => {
    if (!res.content || !Array.isArray(res.content)) {
      throw new Error(`Anthropic judge unexpected response: ${JSON.stringify(res).slice(0, 200)}`);
    }
    return res.content.map((c) => c.text || '').join('').trim();
  });
}

function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set — judge cannot run');
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: JUDGE_MAX_TOKENS },
  });
  return httpsJson({
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
  }, body).then((res) => {
    const text = res?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    if (!text) throw new Error(`Gemini judge unexpected response: ${JSON.stringify(res).slice(0, 200)}`);
    return text.trim();
  });
}

// DeepSeek via its Anthropic-compatible endpoint (Bearer DEEPSEEK_API_KEY).
function callDeepseek(prompt, model) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY not set — deepseek judge cannot run');
  const body = JSON.stringify({
    model: model || 'deepseek-v4-pro',
    max_tokens: DEEPSEEK_JUDGE_MAX_TOKENS,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });
  return httpsJson({
    hostname: 'api.deepseek.com',
    path: '/anthropic/v1/messages',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${key}`,
      'anthropic-version': '2023-06-01',
      'content-length': Buffer.byteLength(body),
    },
  }, body, DEEPSEEK_JUDGE_TIMEOUT_MS).then((res) => {
    if (!res.content || !Array.isArray(res.content)) {
      throw new Error(`DeepSeek judge unexpected response: ${JSON.stringify(res).slice(0, 200)}`);
    }
    // v4-pro emits a "thinking" block before the answer; keep only text blocks.
    return res.content.filter((c) => c.type === 'text').map((c) => c.text || '').join('').trim();
  });
}

// Local Ollama judge (gemma4:12b, qwen3.5:9b). `format: 'json'` constrains the
// model to emit a single valid JSON object — eliminating the parse noise that
// makes small local models unreliable as judges.
function callOllama(prompt, model) {
  const u = new URL('/api/chat', OLLAMA_URL);
  const body = JSON.stringify({
    model: model || 'gemma4:12b',
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    format: 'json',
    // `think: false` is essential here: reasoning models (qwen3.5) otherwise
    // spend the whole token budget in a `thinking` block and return EMPTY
    // content, and even gemma4 runs 5–15× slower. With it, both emit the JSON
    // verdict directly in ~3s (after load) instead of 15–55s.
    think: false,
    keep_alive: '10m',
    options: { temperature: 0, num_predict: 1536 },
  });
  return httpJson({
    hostname: u.hostname,
    port: u.port || 80,
    path: u.pathname,
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
  }, body, OLLAMA_JUDGE_TIMEOUT_MS).then((res) => {
    const text = (res.message && res.message.content) || '';
    if (!text) throw new Error(`Ollama judge unexpected response: ${JSON.stringify(res).slice(0, 200)}`);
    return text.trim();
  });
}

function requestJson(lib, opts, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = lib.request(opts, (res) => {
      let buf = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk) => { buf += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`judge HTTP ${res.statusCode}: ${buf.slice(0, 300)}`));
        }
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error(`judge JSON parse: ${e.message} — ${buf.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('judge timeout')));
    req.write(body);
    req.end();
  });
}

function httpsJson(opts, body, timeoutMs = JUDGE_TIMEOUT_MS) { return requestJson(https, opts, body, timeoutMs); }
function httpJson(opts, body, timeoutMs = JUDGE_TIMEOUT_MS) { return requestJson(http, opts, body, timeoutMs); }

/* ─────────────────────────── parsing ─────────────────────────── */

function parseJudgeJson(raw, rubricSize) {
  const obj = extractJson(raw);
  const criteria = Array.isArray(obj.criteria) ? obj.criteria : [];
  const metCount = criteria.filter((c) => c && c.met === true).length;
  const score = rubricSize > 0 ? metCount / rubricSize : 0;
  // Honor the judge's `passed` if present; otherwise apply the 70% threshold.
  const passed = typeof obj.passed === 'boolean' ? obj.passed : score >= 0.7;
  return {
    score: Math.round(score * 1000) / 1000,
    passed,
    criteria,
    rationale: typeof obj.rationale === 'string' ? obj.rationale : '',
  };
}

function parsePairwiseJson(raw) {
  const obj = extractJson(raw);
  const winner = ['first', 'second', 'tie'].includes(obj.winner) ? obj.winner : 'tie';
  return {
    winner,
    score_first: numberOr(obj.score_first, 0),
    score_second: numberOr(obj.score_second, 0),
    rationale: typeof obj.rationale === 'string' ? obj.rationale : '',
  };
}

function extractJson(raw) {
  // Judges occasionally wrap JSON in ```json fences despite instructions.
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : raw;
  // Trim to the outermost { ... }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`judge produced no JSON object: ${raw.slice(0, 200)}`);
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function numberOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function truncate(s, max) {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…[truncated ${s.length - max} chars]`;
}

module.exports = { pickJudge, judgeOne, judgePair, judgePanel, DEFAULT_PANEL };
