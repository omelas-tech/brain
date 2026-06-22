/**
 * mem0 retriever — adapter slot for a REAL vector store / hosted embeddings.
 *
 * This is the "production dense retrieval" arm of the benchmark: a real
 * embedding model (OpenAI / hosted) feeding a real vector store (Mem0). It is
 * the apples-to-apples competitor to Brain's recall engine, where the
 * `vector-baseline` retriever is only a deterministic offline stand-in.
 *
 * It is GATED ON CONFIGURATION and ships as a wired stub:
 *   - Requires MEM0_API_KEY (and an embeddings key, e.g. OPENAI_API_KEY).
 *     Absent any key, `retrieve` throws an actionable error rather than
 *     silently degrading — the benchmark should skip this arm, not fake it.
 *   - Has NO hard npm dependency. Any client package is required lazily inside
 *     a try/catch so installing this repo never pulls in a vector-store SDK.
 *
 * Retriever interface (shared by all benchmark retrievers):
 *   retrieve(memories, query, opts) -> ranked array, highest score first
 *   - memories: Array<{id, title, body, content, tags, type, ...}>
 *   - query:    string
 *   - opts:     { top = 10 } — return at most `top` items
 *   - each item: { id, score, title, body, type }
 *
 * NB: `retrieve` is async (real ingest + embedding calls are I/O-bound).
 */

const NOT_CONFIGURED_MSG =
  'mem0 retriever not configured: set MEM0_API_KEY (and an embeddings key). ' +
  'See benchmark/README.md';

/**
 * Whether the required configuration is present to run a real mem0 retrieval.
 * Needs the Mem0 key plus at least one embeddings provider key.
 *
 * @returns {boolean}
 */
function isConfigured() {
  return Boolean(
    process.env.MEM0_API_KEY &&
    (process.env.OPENAI_API_KEY || process.env.MEM0_EMBEDDING_API_KEY),
  );
}

/**
 * Embed a corpus into a real vector store and return the top-k memories for
 * the query, ranked by cosine similarity.
 *
 * Throws an actionable error if configuration is missing or the optional
 * client package is not installed — the benchmark runner is expected to catch
 * this and skip the arm.
 *
 * @param {Object[]} memories - Full in-memory corpus (oracle + distractors).
 * @param {string} query
 * @param {Object} [opts]
 * @param {number} [opts.top=10] - Maximum number of results to return.
 * @returns {Promise<Array<{id: string, score: number, title: string, body: string, type: string}>>}
 */
async function retrieve(memories, query, opts = {}) {
  if (!isConfigured()) {
    throw new Error(NOT_CONFIGURED_MSG);
  }

  // Lazy-require the client so this module never imposes a hard dependency.
  // Any install/import failure surfaces as the same actionable error.
  let MemoryClient;
  try {
    // eslint-disable-next-line global-require
    ({ MemoryClient } = require('mem0ai'));
  } catch (err) {
    throw new Error(
      `${NOT_CONFIGURED_MSG} (failed to load 'mem0ai': ${err.message}; ` +
      "run `npm install mem0ai` to enable this arm)",
    );
  }

  const top = opts.top || 10;

  // TODO(real-implementation): wire the actual ingest → embed → top-k flow.
  //
  //   1. Instantiate the client:
  //        const client = new MemoryClient({ apiKey: process.env.MEM0_API_KEY });
  //   2. Ingest the corpus once per benchmark run, namespaced so distractor
  //      pools from different scenarios don't bleed into each other:
  //        const userId = `brain-bench-${runId}`;
  //        for (const m of memories) {
  //          await client.add(
  //            [{ role: 'user', content: `${m.title}\n${m.body || m.content}` }],
  //            { user_id: userId, metadata: { mem_id: m.id, type: m.type } },
  //          );
  //        }
  //   3. Query — mem0 embeds the query and runs top-k cosine over the store:
  //        const hits = await client.search(query, { user_id: userId, limit: top });
  //   4. Map hits back to the benchmark item shape, carrying the vector-store
  //      similarity score and resolving mem_id from metadata:
  //        return hits.map((h) => ({
  //          id: h.metadata.mem_id,
  //          score: h.score,
  //          title: <from corpus by mem_id>,
  //          body:  <from corpus by mem_id>,
  //          type:  h.metadata.type,
  //        }));
  //   5. Tear down the namespace after the run (client.deleteAll({ user_id }))
  //      so repeated benchmark runs stay isolated and idempotent.
  //
  // Until that is implemented, fail loudly rather than return wrong rankings.
  void MemoryClient;
  void memories;
  void query;
  void top;
  throw new Error(
    'mem0 retriever is a configured stub: real ingest/search not yet implemented. ' +
    'See the TODO in benchmark/harness/retrievers/mem0.js',
  );
}

module.exports = { name: 'mem0', retrieve, isConfigured };
