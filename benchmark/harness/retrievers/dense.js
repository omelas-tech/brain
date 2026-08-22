/**
 * Dense retriever — REAL semantic embeddings, isolated from any vector store.
 *
 * This arm answers one question the rest of the matrix cannot: **does semantic
 * similarity actually beat lexical matching on OUR corpus?**
 *
 *   - `keyword` is BM25 — pure lexical, the floor.
 *   - `vector-baseline` is a hashed bag-of-words in vector geometry. Its own
 *     docstring says it is "a stand-in, not a semantic model" — it captures
 *     lexical overlap, so it cannot answer the question either.
 *   - `mem0` is a real embedding model AND a real hosted vector store AND
 *     mem0's own extraction/summarization layer. When it wins, you cannot tell
 *     which of the three did the work.
 *
 * This module is the missing control: the SAME corpus text that `keyword`
 * scores (it imports `memoryText` from keyword.js rather than reimplementing
 * it, so the composition can never drift), embedded by a real model, ranked by
 * plain cosine. Nothing else. A win here is attributable to semantics alone.
 *
 * ── Configuration ────────────────────────────────────────────────────────
 * Speaks the OpenAI `/v1/embeddings` wire format, which every serious runtime
 * implements — so this works against OpenAI, Ollama, llama.cpp, LM Studio,
 * vLLM, or HF text-embeddings-inference without a code change.
 *
 *   BRAIN_EMBED_URL    endpoint (default https://api.openai.com/v1/embeddings)
 *   BRAIN_EMBED_MODEL  model id (default text-embedding-3-small)
 *   BRAIN_EMBED_KEY    bearer token (falls back to OPENAI_API_KEY)
 *   BRAIN_EMBED_BATCH  inputs per request (default 128)
 *
 * A local server needs no key, so setting BRAIN_EMBED_URL alone is enough to
 * configure the arm. Absent both a URL and a key, `retrieve` throws an
 * actionable error rather than silently degrading — the runner skips the arm
 * instead of faking it, exactly like the mem0 adapter.
 *
 * ── Determinism ──────────────────────────────────────────────────────────
 * Embeddings are cached to disk keyed by sha256(model + text), so a rerun of
 * the same corpus re-reads vectors instead of re-embedding them: reruns are
 * free, offline, and byte-identical. Ties break by id. The cache is the reason
 * this arm can sit in a benchmark that claims reproducibility — delete
 * `.embed-cache/` to force a fresh pull.
 *
 * NO hard npm dependency: uses global fetch (Node >= 18).
 *
 * Retriever interface (shared by all benchmark retrievers):
 *   retrieve(memories, query, opts) -> ranked array, highest score first
 *   - memories: Array<{id, title, body, content, tags, type, ...}>
 *   - query:    string
 *   - opts:     { top = 10 } — return at most `top` items
 *   - each item: { id, score, title, body, type }
 *
 * NB: `retrieve` is async (embedding calls are I/O-bound).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { memoryText } = require('./keyword');

const DEFAULT_URL = 'https://api.openai.com/v1/embeddings';
const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_BATCH = 128;

// Cache lives beside the harness so a checkout can ship warm vectors if we
// ever choose to commit them (they are deterministic, so that is safe).
const CACHE_DIR = path.join(__dirname, '..', '..', '.embed-cache');

const NOT_CONFIGURED_MSG =
  'dense retriever not configured: set BRAIN_EMBED_URL (local server) or ' +
  'OPENAI_API_KEY / BRAIN_EMBED_KEY (hosted). See benchmark/README.md';

/** Resolved config, read fresh each call so tests can flip env vars. */
function config() {
  return {
    url: process.env.BRAIN_EMBED_URL || DEFAULT_URL,
    model: process.env.BRAIN_EMBED_MODEL || DEFAULT_MODEL,
    key: process.env.BRAIN_EMBED_KEY || process.env.OPENAI_API_KEY || '',
    batch: Number(process.env.BRAIN_EMBED_BATCH) || DEFAULT_BATCH,
  };
}

/**
 * Whether this arm can run. A custom endpoint implies a local/self-hosted
 * server that needs no credential; the default hosted endpoint needs a key.
 *
 * @returns {boolean}
 */
function isConfigured() {
  const { key } = config();
  return Boolean(process.env.BRAIN_EMBED_URL || key);
}

/* ───────────────────────────── cache ───────────────────────────── */

/** Cache file for a model — one JSON object of {sha256(text): vector}. */
function cachePath(model) {
  const safe = model.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(CACHE_DIR, `${safe}.json`);
}

function readCache(model) {
  try {
    return JSON.parse(fs.readFileSync(cachePath(model), 'utf-8'));
  } catch {
    return {};
  }
}

function writeCache(model, cache) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const p = cachePath(model);
  const tmp = `${p}.tmp.${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, p);
}

function textKey(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/* ───────────────────────────── math ───────────────────────────── */

/**
 * L2-normalize in place. A zero vector stays zero (cosine with it is 0, which
 * is the honest answer for empty text).
 *
 * @param {number[]} v
 * @returns {number[]} the same array, normalized
 */
function l2normalize(v) {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

/**
 * Cosine similarity of two L2-normalized vectors (a plain dot product).
 * Mismatched dimensions score 0 rather than throwing — a corpus embedded by a
 * previous model should degrade the arm, not crash the suite.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/* ───────────────────────────── embedding ───────────────────────────── */

/** Sleep helper for the retry ladder. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST one batch to the embeddings endpoint, retrying transient failures.
 * Rate limits and 5xx get an exponential backoff; 4xx (other than 429) are
 * permanent and throw immediately so a bad key fails fast.
 *
 * @param {string[]} inputs
 * @param {Object} cfg - resolved config()
 * @returns {Promise<number[][]>} one vector per input, input order preserved
 */
async function embedBatch(inputs, cfg) {
  const headers = { 'content-type': 'application/json' };
  if (cfg.key) headers.authorization = `Bearer ${cfg.key}`;

  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await delay(500 * 2 ** (attempt - 1));
    let res;
    try {
      res = await fetch(cfg.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: cfg.model, input: inputs }),
      });
    } catch (err) {
      lastErr = err;           // network blip — retry
      continue;
    }
    if (res.ok) {
      const json = await res.json();
      if (!Array.isArray(json.data)) {
        throw new Error(`dense retriever: unexpected response shape from ${cfg.url}`);
      }
      // The API may return out of order; `index` is authoritative.
      const out = new Array(inputs.length);
      for (const item of json.data) out[item.index] = l2normalize(item.embedding);
      return out;
    }
    const bodyText = await res.text().catch(() => '');
    if (res.status !== 429 && res.status < 500) {
      throw new Error(`dense retriever: ${res.status} from ${cfg.url} — ${bodyText.slice(0, 200)}`);
    }
    lastErr = new Error(`dense retriever: ${res.status} from ${cfg.url} — ${bodyText.slice(0, 200)}`);
  }
  throw lastErr;
}

/**
 * Embed many texts, serving what the cache already knows and requesting only
 * the misses. Returns vectors in the order the texts were given.
 *
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embedAll(texts) {
  const cfg = config();
  const cache = readCache(cfg.model);

  const missing = [];
  const missingIdx = [];
  texts.forEach((text, i) => {
    if (!cache[textKey(text)]) {
      missing.push(text);
      missingIdx.push(i);
    }
  });

  if (missing.length > 0) {
    for (let i = 0; i < missing.length; i += cfg.batch) {
      const slice = missing.slice(i, i + cfg.batch);
      const vectors = await embedBatch(slice, cfg);
      slice.forEach((text, j) => { cache[textKey(text)] = vectors[j]; });
    }
    writeCache(cfg.model, cache);
  }

  return texts.map((text) => cache[textKey(text)]);
}

/* ───────────────────────────── retrieve ───────────────────────────── */

/**
 * Rank the corpus by cosine similarity between the query embedding and each
 * memory's embedding.
 *
 * @param {Object[]} memories - Full in-memory corpus (oracle + distractors).
 * @param {string} query
 * @param {Object} [opts]
 * @param {number} [opts.top=10] - Maximum number of results to return.
 * @returns {Promise<Array<{id: string, score: number, title: string, body: string, type: string}>>}
 */
async function retrieve(memories, query, opts = {}) {
  if (!isConfigured()) throw new Error(NOT_CONFIGURED_MSG);

  const top = opts.top || 10;
  if (!Array.isArray(memories) || memories.length === 0) return [];

  // memoryText is imported from keyword.js on purpose: the lexical arm and the
  // dense arm MUST see byte-identical text, or the comparison measures text
  // composition instead of retrieval method.
  const docTexts = memories.map(memoryText);
  const [queryVec, ...docVecs] = await embedAll([query, ...docTexts]);

  const ranked = memories.map((mem, i) => ({
    id: mem.id,
    score: cosine(queryVec, docVecs[i]),
    title: mem.title || '',
    body: mem.body || mem.content || '',
    type: mem.type || '',
  }));

  // Sort by score desc; tie-break by id asc for determinism.
  ranked.sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return ranked.slice(0, top);
}

module.exports = {
  name: 'dense',
  retrieve,
  isConfigured,
  embedAll,
  l2normalize,
  cosine,
  NOT_CONFIGURED_MSG,
  CACHE_DIR,
};
