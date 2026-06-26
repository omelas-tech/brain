/**
 * Brain Memory — TF-IDF Search Engine
 *
 * Lightweight, zero-dependency TF-IDF implementation for semantic search
 * across brain memories. Builds a search index at memorize time and
 * computes cosine similarity at recall time.
 *
 * This replaces the "agent eyeballs relevance" approach with deterministic
 * math: tokenize → TF-IDF weights → cosine similarity → numeric score.
 */

const fs = require('fs');
const path = require('path');

const SEARCH_INDEX_FILE = 'search-index.json';

// Common English stopwords — filtered out during tokenization
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'must',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we',
  'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them',
  'their', 'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'about', 'above', 'after', 'again', 'also', 'any', 'because',
  'before', 'between', 'during', 'if', 'into', 'then', 'there', 'up',
  'out', 'over', 'under', 'here', 'as', 'like', 'use', 'used', 'using',
]);

/**
 * Simple suffix stemmer — strips common English suffixes.
 * Not as thorough as Porter/Snowball but zero-dependency and good enough
 * for matching "connection" → "connect", "pooling" → "pool", etc.
 *
 * @param {string} word - Lowercase word
 * @returns {string} Stemmed word
 */
function stem(word) {
  if (word.length <= 3) return word;

  // Two-pass stemmer: strip compound suffixes first, then simple ones.
  // Pass 1: long compound suffixes
  const longSuffixes = [
    'izations', 'ational', 'fulness', 'ousness', 'iveness',
    'ization', 'isation', 'tional', 'ations', 'ments',
    'ation', 'ness', 'ment', 'ence', 'ance', 'ible', 'able',
    'ally', 'ious', 'eous', 'ings', 'ions',
    'ity', 'ful', 'ous', 'ive', 'ize', 'ise', 'ion',
    'ing', 'ies',
  ];

  for (const suffix of longSuffixes) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, -suffix.length);
    }
  }

  // Pass 2: short suffixes (conservative — skip ambiguous word endings)
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('er') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('ly') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('al') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);

  // Strip trailing 's' only for likely plurals (not ss, us, is endings)
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') &&
      !word.endsWith('is') && word.length > 4) {
    return word.slice(0, -1);
  }

  return word;
}

/**
 * Tokenize text into stemmed terms, filtering stopwords.
 *
 * @param {string} text - Input text
 * @returns {string[]} Array of stemmed tokens
 */
function tokenize(text) {
  if (!text) return [];

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')   // strip punctuation
    .split(/\s+/)                       // split on whitespace
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w))
    .map(stem);
}

/**
 * Compute term frequencies for a token list.
 *
 * @param {string[]} tokens - Array of tokens
 * @returns {Object} Map of term → count
 */
function termFrequencies(tokens) {
  const tf = {};
  for (const token of tokens) {
    tf[token] = (tf[token] || 0) + 1;
  }
  return tf;
}

/**
 * Compute TF-IDF vector for a document given corpus-wide IDF values.
 *
 * TF = (term count in doc) / (total terms in doc)
 * IDF = log(N / df) where df = docs containing the term
 *
 * @param {Object} tf - Term frequency map for this document
 * @param {Object} idf - IDF values (term → idf weight)
 * @param {number} docLength - Total number of tokens in document
 * @returns {Object} Sparse TF-IDF vector (term → weight)
 */
function computeTfidfVector(tf, idf, docLength) {
  const vector = {};
  if (docLength === 0) return vector;

  for (const [term, count] of Object.entries(tf)) {
    const tfNorm = count / docLength;
    const idfVal = idf[term] || 0;
    const weight = tfNorm * idfVal;
    if (weight > 0) {
      vector[term] = Math.round(weight * 10000) / 10000;
    }
  }
  return vector;
}

/**
 * Cosine similarity between two sparse vectors.
 *
 * @param {Object} a - Sparse vector (term → weight)
 * @param {Object} b - Sparse vector (term → weight)
 * @returns {number} Similarity (0.0-1.0)
 */
function cosineSimilarity(a, b) {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (const [term, weight] of Object.entries(a)) {
    magA += weight * weight;
    if (b[term]) {
      dot += weight * b[term];
    }
  }

  for (const weight of Object.values(b)) {
    magB += weight * weight;
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Build text content from a memory for indexing.
 * Concatenates title, body, and tags with appropriate weighting
 * (title terms appear 3x, tags 2x, body 1x).
 *
 * @param {Object} memory - Memory object with title, body, tags
 * @returns {string} Combined text for tokenization
 */
function buildMemoryText(memory) {
  const parts = [];

  // Title gets 3x weight (repeat it)
  if (memory.title) {
    parts.push(memory.title, memory.title, memory.title);
  }

  // Tags get 2x weight
  if (memory.tags && Array.isArray(memory.tags)) {
    const tagText = memory.tags.join(' ');
    parts.push(tagText, tagText);
  }

  // Body gets 1x weight
  if (memory.body) {
    parts.push(memory.body);
  }

  // Content field (used in some memories)
  if (memory.content && memory.content !== memory.body) {
    parts.push(memory.content);
  }

  return parts.join(' ');
}

// ─────────────────────────────────────────────────────────
// Search Index Management
// ─────────────────────────────────────────────────────────

/**
 * Read the search index from disk.
 *
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @returns {Object|null} Search index or null if not found
 */
function readSearchIndex(brainDir) {
  const indexPath = path.join(brainDir, SEARCH_INDEX_FILE);
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Write the search index to disk (atomically).
 *
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @param {Object} searchIndex - The search index object
 */
function writeSearchIndex(brainDir, searchIndex) {
  const indexPath = path.join(brainDir, SEARCH_INDEX_FILE);
  const crypto = require('crypto');
  const tmpPath = indexPath + '.tmp.' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmpPath, JSON.stringify(searchIndex, null, 2) + '\n');
  fs.renameSync(tmpPath, indexPath);
}

/**
 * Create a new empty search index.
 *
 * @returns {Object} Empty search index
 */
function createSearchIndex() {
  return {
    version: 1,
    doc_count: 0,
    documents: {},    // memoryId → { tf: {term→count}, length: N }
    df: {},           // term → number of documents containing it
  };
}

/**
 * Recompute IDF values from the current document frequencies.
 *
 * @param {Object} searchIndex - The search index
 * @returns {Object} IDF map (term → idf weight)
 */
function computeIdf(searchIndex) {
  const N = searchIndex.doc_count;
  if (N === 0) return {};

  const idf = {};
  for (const [term, df] of Object.entries(searchIndex.df)) {
    // Smoothed IDF: ensures terms present in all docs still get a small positive weight
    idf[term] = Math.log(1 + N / df);
  }
  return idf;
}

/**
 * Add a memory document to the search index.
 *
 * @param {Object} searchIndex - The search index (mutated)
 * @param {string} memoryId - Memory ID
 * @param {Object} memory - Memory object (title, body, tags, content)
 * @returns {Object} The mutated search index
 */
function addDocument(searchIndex, memoryId, memory) {
  // Remove old version if re-indexing
  if (searchIndex.documents[memoryId]) {
    removeDocument(searchIndex, memoryId);
  }

  const text = buildMemoryText(memory);
  const tokens = tokenize(text);
  const tf = termFrequencies(tokens);

  searchIndex.documents[memoryId] = {
    tf,
    length: tokens.length,
  };
  searchIndex.doc_count++;

  // Update document frequencies
  for (const term of Object.keys(tf)) {
    searchIndex.df[term] = (searchIndex.df[term] || 0) + 1;
  }

  return searchIndex;
}

/**
 * Remove a memory document from the search index.
 *
 * @param {Object} searchIndex - The search index (mutated)
 * @param {string} memoryId - Memory ID
 * @returns {Object} The mutated search index
 */
function removeDocument(searchIndex, memoryId) {
  const doc = searchIndex.documents[memoryId];
  if (!doc) return searchIndex;

  // Decrement document frequencies
  for (const term of Object.keys(doc.tf)) {
    if (searchIndex.df[term]) {
      searchIndex.df[term]--;
      if (searchIndex.df[term] <= 0) {
        delete searchIndex.df[term];
      }
    }
  }

  delete searchIndex.documents[memoryId];
  searchIndex.doc_count--;

  return searchIndex;
}

/**
 * Compute TF-IDF relevance scores for a query against all indexed memories.
 *
 * @param {Object} searchIndex - The search index
 * @param {string} query - The search query
 * @returns {Object} Map of memoryId → relevance score (0.0-1.0)
 */
function search(searchIndex, query) {
  if (!searchIndex || searchIndex.doc_count === 0) return {};

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return {};

  const queryTf = termFrequencies(queryTokens);
  const idf = computeIdf(searchIndex);
  const queryVector = computeTfidfVector(queryTf, idf, queryTokens.length);

  const scores = {};

  for (const [memoryId, doc] of Object.entries(searchIndex.documents)) {
    const docVector = computeTfidfVector(doc.tf, idf, doc.length);
    const sim = cosineSimilarity(queryVector, docVector);
    if (sim > 0) {
      scores[memoryId] = Math.round(sim * 1000) / 1000;
    }
  }

  return scores;
}

/**
 * BM25 relevance scoring for a query against all indexed memories.
 *
 * Fixes two TF-IDF-cosine weaknesses that buried long, detailed memories under
 * short distractors: BM25 SATURATES term frequency (k1) and normalizes document
 * length GENTLY (b), instead of dividing TF by full length and cosine by full
 * magnitude (which penalized the richer oracle memories for being longer). The
 * field weighting baked into the index (title 3x, tags 2x via buildMemoryText)
 * is preserved. Scores are normalized to 0..1 by the top score so they blend
 * cleanly into the scorer's recall formula (which expects relevance in [0,1]).
 *
 * @param {Object} searchIndex - The search index
 * @param {string} query - The search query
 * @param {Object} [opts] - { k1 = 1.5, b = 0.75 }
 * @returns {Object} Map of memoryId → normalized relevance score (0.0-1.0)
 */
function bm25Search(searchIndex, query, opts = {}) {
  if (!searchIndex || searchIndex.doc_count === 0) return {};

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return {};

  const k1 = opts.k1 != null ? opts.k1 : 1.5;
  const b = opts.b != null ? opts.b : 0.75;
  const N = searchIndex.doc_count;

  // Average document length (for length normalization).
  let totalLen = 0;
  for (const d of Object.values(searchIndex.documents)) totalLen += d.length || 0;
  const avgdl = N > 0 ? totalLen / N : 0;

  // BM25 IDF per (deduped) query term, floored at 0 so a term present in nearly
  // every document can't contribute a negative score.
  const qTerms = [...new Set(queryTokens)];
  const idf = {};
  for (const t of qTerms) {
    const df = searchIndex.df[t] || 0;
    idf[t] = Math.max(0, Math.log(1 + (N - df + 0.5) / (df + 0.5)));
  }

  const raw = {};
  let maxScore = 0;
  for (const [memoryId, doc] of Object.entries(searchIndex.documents)) {
    const dl = doc.length || 0;
    let score = 0;
    for (const t of qTerms) {
      const f = doc.tf[t] || 0;
      if (f === 0) continue;
      const denom = f + k1 * (1 - b + b * (avgdl > 0 ? dl / avgdl : 0));
      score += idf[t] * (f * (k1 + 1)) / denom;
    }
    if (score > 0) {
      raw[memoryId] = score;
      if (score > maxScore) maxScore = score;
    }
  }

  // Normalize to 0..1 by the top score — preserves ranking and keeps the [0,1]
  // contract the recall scorer's relevance blend expects.
  const scores = {};
  if (maxScore > 0) {
    for (const [id, s] of Object.entries(raw)) {
      scores[id] = Math.round((s / maxScore) * 1000) / 1000;
    }
  }
  return scores;
}

/**
 * Rebuild the entire search index from memory files on disk.
 *
 * @param {string} brainDir - Absolute path to ~/.brain/
 * @param {Object} index - The brain index (index.json)
 * @returns {Object} Fresh search index
 */
function rebuildIndex(brainDir, index) {
  const searchIndex = createSearchIndex();

  if (!index || !index.memories) return searchIndex;

  for (const [memoryId, entry] of Object.entries(index.memories)) {
    // Read the actual memory file for full content
    const memPath = path.join(brainDir, entry.path);
    let body = '';
    let content = '';
    try {
      const raw = fs.readFileSync(memPath, 'utf-8');
      // Extract body from markdown (after frontmatter)
      const fmEnd = raw.indexOf('---', raw.indexOf('---') + 3);
      if (fmEnd !== -1) {
        body = raw.slice(fmEnd + 3).trim();
      }
    } catch { /* skip unreadable files */ }

    addDocument(searchIndex, memoryId, {
      title: entry.title || '',
      body,
      tags: entry.tags || [],
      content,
    });
  }

  return searchIndex;
}

/**
 * Is the persisted search index out of sync with index.json?
 *
 * The search index drifts whenever memories change outside memorize's
 * addDocument path (forget, sleep/consolidate, sync pull, manual edit) — and a
 * present-but-empty index silently makes every relevance score 0. Both `recall`
 * and `session-start` must rebuild when the doc SET (not mere presence) drifts.
 *
 * @param {Object|null} searchIndex - parsed search-index.json (or null if absent)
 * @param {Object} index - parsed index.json
 * @returns {boolean} true when a rebuild is required
 */
function isSearchIndexStale(searchIndex, index) {
  if (!searchIndex || !searchIndex.documents) return true;
  const memIds = Object.keys((index && index.memories) || {});
  const docCount = searchIndex.doc_count != null
    ? searchIndex.doc_count
    : Object.keys(searchIndex.documents).length;
  if (docCount !== memIds.length) return true;
  for (const id of memIds) if (!(id in searchIndex.documents)) return true;
  return false;
}

module.exports = {
  // Core primitives
  tokenize,
  stem,
  termFrequencies,
  computeTfidfVector,
  cosineSimilarity,
  buildMemoryText,
  // Index management
  createSearchIndex,
  readSearchIndex,
  writeSearchIndex,
  addDocument,
  removeDocument,
  computeIdf,
  search,
  bm25Search,
  rebuildIndex,
  isSearchIndexStale,
  // Constants
  SEARCH_INDEX_FILE,
  STOPWORDS,
};
