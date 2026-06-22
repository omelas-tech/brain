/**
 * Vector-baseline retriever — dense-retrieval stand-in with LOCAL embeddings.
 *
 * Dense retrieval (embed query + corpus, rank by cosine similarity) is the
 * canonical baseline for memory systems built on a vector store. Running a
 * *real* embedding model in CI is slow, non-deterministic, and needs an API
 * key — none of which belong in a unit-tested benchmark harness.
 *
 * So this module ships a DETERMINISTIC LOCAL EMBEDDING: a hashed bag-of-words
 * vector (FNV-1a hashing trick) of fixed dimension, L2-normalized. It is a
 * stand-in, not a semantic model — it captures lexical overlap in a vector
 * geometry, giving us a dense-retrieval-shaped baseline that runs offline with
 * zero dependencies and identical results on every machine.
 *
 * The PRODUCTION embedding model (OpenAI / hosted) is swapped in via the
 * `mem0` adapter (see ./mem0.js), which talks to a real vector store. This
 * module deliberately stays offline so the harness self-test never flakes.
 *
 * Retriever interface (shared by all benchmark retrievers):
 *   retrieve(memories, query, opts) -> ranked array, highest score first
 *   - memories: Array<{id, title, body, content, tags, type, ...}>
 *   - query:    string
 *   - opts:     { top = 10 } — return at most `top` items
 *   - each item: { id, score, title, body, type }
 */

// Embedding dimension. Larger = fewer hash collisions, more faithful to a
// real dense vector. 256 keeps the math cheap while staying well above the
// vocabulary size of a small benchmark corpus.
const EMBED_DIM = 256;

// FNV-1a 32-bit constants.
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a 32-bit string hash. Deterministic, fast, no dependencies.
 *
 * @param {string} str
 * @returns {number} unsigned 32-bit hash
 */
function fnv1a(str) {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // Multiply by FNV prime mod 2^32 via Math.imul to avoid float precision loss.
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * Tokenize text into a lowercased word list (split on non-alphanumeric).
 *
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length > 0);
}

/**
 * Embed text into a fixed-dimension, L2-normalized Float64Array.
 *
 * Each token is hashed into a bucket in [0, EMBED_DIM); term counts accumulate
 * into that bucket, then the vector is L2-normalized so cosine similarity is a
 * plain dot product. The all-zero vector (empty text) stays zero.
 *
 * @param {string} text
 * @returns {Float64Array} normalized embedding of length EMBED_DIM
 */
function embed(text) {
  const vec = new Float64Array(EMBED_DIM);
  for (const tok of tokenize(text)) {
    const bucket = fnv1a(tok) % EMBED_DIM;
    vec[bucket] += 1;
  }

  // L2-normalize.
  let norm = 0;
  for (let i = 0; i < EMBED_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < EMBED_DIM; i++) vec[i] /= norm;
  }
  return vec;
}

/**
 * Cosine similarity of two equal-length vectors. Since `embed` returns
 * L2-normalized vectors, this is just the dot product.
 *
 * @param {Float64Array} a
 * @param {Float64Array} b
 * @returns {number}
 */
function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Build the text embedded for a memory: title + body (falls back to content).
 *
 * @param {Object} mem
 * @returns {string}
 */
function memoryText(mem) {
  return [mem.title || '', mem.body || mem.content || ''].join(' ');
}

/**
 * Rank the corpus against the query by cosine similarity of local embeddings.
 *
 * @param {Object[]} memories - Full in-memory corpus (oracle + distractors).
 * @param {string} query
 * @param {Object} [opts]
 * @param {number} [opts.top=10] - Maximum number of results to return.
 * @returns {Array<{id: string, score: number, title: string, body: string, type: string}>}
 */
function retrieve(memories, query, opts = {}) {
  const top = opts.top || 10;
  const queryVec = embed(query);

  const ranked = memories.map((mem) => ({
    id: mem.id,
    score: cosine(queryVec, embed(memoryText(mem))),
    title: mem.title || '',
    body: mem.body || mem.content || '',
    type: mem.type || '',
  }));

  // Sort by score desc; tie-break by id asc for determinism.
  ranked.sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return ranked.slice(0, top);
}

module.exports = { name: 'vector-baseline', retrieve, embed, EMBED_DIM };
