/**
 * Keyword retriever — lexical baseline & corpus-hardness validator.
 *
 * This is the floor: a classic BM25 ranker over a bag-of-words built from
 * each memory's `title + body + tags`. It exists for two reasons:
 *   1) As a benchmark baseline to compare Brain's recall engine against a
 *      pure-lexical retriever (no embeddings, no spreading activation).
 *   2) As a corpus-hardness validator — if plain BM25 already nails Recall@k,
 *      the distractor set is too easy and the scenario isn't measuring much.
 *
 * Deterministic, zero external dependencies. Ties broken by id so two runs
 * over the same corpus + query always produce the identical ranking.
 *
 * Retriever interface (shared by all benchmark retrievers):
 *   retrieve(memories, query, opts) -> ranked array, highest score first
 *   - memories: Array<{id, title, body, content, tags, type, ...}>
 *   - query:    string
 *   - opts:     { top = 10 } — return at most `top` items
 *   - each item: { id, score, title, body, type }
 */

// Small English stopword set — enough to drop the highest-frequency noise
// without needing a dependency. Kept intentionally short for determinism.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'for',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this',
  'that', 'these', 'those', 'with', 'as', 'at', 'by', 'from', 'into', 'out',
  'up', 'so', 'no', 'not', 'do', 'does', 'did', 'has', 'have', 'had', 'we',
  'you', 'they', 'he', 'she', 'i', 'me', 'my', 'our', 'your', 'their', 'will',
  'can', 'should', 'would', 'could', 'all', 'any', 'each', 'than', 'then',
]);

// BM25 free parameters (Robertson/Zaragoza defaults).
const BM25_K1 = 1.5;
const BM25_B = 0.75;

/**
 * Tokenize text into a lowercased bag of words.
 * Splits on any non-alphanumeric run; drops tokens < 2 chars and stopwords.
 *
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length >= 2 && !STOPWORDS.has(tok));
}

/**
 * Build the searchable text for a memory: title + body + tags.
 * Falls back to `content` for body when body is absent.
 *
 * @param {Object} mem
 * @returns {string}
 */
function memoryText(mem) {
  const tags = Array.isArray(mem.tags) ? mem.tags.join(' ') : '';
  return [mem.title || '', mem.body || mem.content || '', tags].join(' ');
}

/**
 * BM25 ranking over the corpus for a single query.
 *
 * @param {Object[]} memories - Full in-memory corpus (oracle + distractors).
 * @param {string} query
 * @param {Object} [opts]
 * @param {number} [opts.top=10] - Maximum number of results to return.
 * @returns {Array<{id: string, score: number, title: string, body: string, type: string}>}
 */
function retrieve(memories, query, opts = {}) {
  const top = opts.top || 10;
  const queryTokens = tokenize(query);

  // Per-document token counts + corpus document-frequency table.
  const docs = memories.map((mem) => {
    const tokens = tokenize(memoryText(mem));
    const tf = new Map();
    for (const tok of tokens) tf.set(tok, (tf.get(tok) || 0) + 1);
    return { mem, tf, len: tokens.length };
  });

  const N = docs.length;
  const avgdl = N > 0 ? docs.reduce((sum, d) => sum + d.len, 0) / N : 0;

  // Document frequency for each query term only (all we need to score).
  const df = new Map();
  for (const term of new Set(queryTokens)) {
    let count = 0;
    for (const d of docs) if (d.tf.has(term)) count++;
    df.set(term, count);
  }

  // IDF with the BM25 +0.5 smoothing; floor at 0 so common-everywhere terms
  // can't pull a score negative.
  const idf = new Map();
  for (const [term, n] of df.entries()) {
    const raw = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    idf.set(term, Math.max(0, raw));
  }

  const ranked = docs.map((d) => {
    let score = 0;
    for (const term of queryTokens) {
      const tf = d.tf.get(term);
      if (!tf) continue;
      const denom = tf + BM25_K1 * (1 - BM25_B + (BM25_B * d.len) / (avgdl || 1));
      score += (idf.get(term) || 0) * ((tf * (BM25_K1 + 1)) / denom);
    }
    return {
      id: d.mem.id,
      score,
      title: d.mem.title || '',
      body: d.mem.body || d.mem.content || '',
      type: d.mem.type || '',
    };
  });

  // Sort by score desc; tie-break by id asc for determinism.
  ranked.sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return ranked.slice(0, top);
}

module.exports = { name: 'keyword', retrieve, tokenize };
