/**
 * Unit tests for benchmark baseline retrievers.
 *
 * Covers the three alternative retrievers (keyword, vector-baseline, mem0)
 * that the harness benchmarks against Brain's own recall engine. Each runnable
 * retriever must:
 *   - rank clearly-relevant memories above distractors,
 *   - respect the `top` cutoff,
 *   - be deterministic,
 *   - return items shaped { id, score, title, body, type } compatible with
 *     scoreRetrieval() so Recall@k can be computed.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const keyword = require('../harness/retrievers/keyword');
const vectorBaseline = require('../harness/retrievers/vector-baseline');
const mem0 = require('../harness/retrievers/mem0');
const { scoreRetrieval } = require('../harness/recall-probe');

// ─────────────────────────────────────────────────────────
// Fixture corpus — ~8 memories, 3 relevant to the query, rest distractors.
// Query targets Redis caching + TTL on list endpoints.
// ─────────────────────────────────────────────────────────

const QUERY = 'redis cache ttl for list endpoints';

const RELEVANT_IDS = ['mem_cache_redis', 'mem_cache_ttl', 'mem_list_endpoint_cache'];

const CORPUS = [
  // --- relevant ---
  {
    id: 'mem_cache_redis',
    type: 'decision',
    title: 'Cache layer uses Redis',
    body: 'All list endpoints cache responses in Redis with a short TTL. Invalidate the cache key on write.',
    tags: ['redis', 'cache', 'performance'],
  },
  {
    id: 'mem_cache_ttl',
    type: 'decision',
    title: 'TTL convention for cached list responses',
    body: 'Cached list endpoint responses use a 60 second TTL in Redis; individual records use 300 seconds.',
    tags: ['cache', 'ttl', 'redis'],
  },
  {
    id: 'mem_list_endpoint_cache',
    type: 'learning',
    title: 'List endpoint caching pattern',
    body: 'Every list endpoint reads through the Redis cache before hitting the database, keyed by page.',
    tags: ['list', 'endpoint', 'cache'],
  },
  // --- distractors ---
  {
    id: 'mem_vue_router',
    type: 'preference',
    title: 'Vue router navigation guards',
    body: 'Use beforeEach navigation guards to check auth state before rendering protected routes.',
    tags: ['vue', 'router', 'frontend'],
  },
  {
    id: 'mem_grpc_streaming',
    type: 'decision',
    title: 'gRPC streaming for telemetry',
    body: 'Telemetry ingestion uses bidirectional gRPC streaming with protobuf payloads.',
    tags: ['grpc', 'protobuf', 'streaming'],
  },
  {
    id: 'mem_pytorch_training',
    type: 'experience',
    title: 'PyTorch training loop checkpointing',
    body: 'Save a checkpoint every epoch and log loss to tensorboard during the training loop.',
    tags: ['pytorch', 'training', 'ml'],
  },
  {
    id: 'mem_terraform_modules',
    type: 'observation',
    title: 'Terraform module naming',
    body: 'Infrastructure modules are lowercase-kebab with no version suffix in the directory name.',
    tags: ['terraform', 'iac', 'naming'],
  },
  {
    id: 'mem_i18n_keys',
    type: 'preference',
    title: 'i18n translation key structure',
    body: 'Localization keys are namespaced by feature, e.g. checkout.button.submit, for all supported locales.',
    tags: ['i18n', 'localization'],
  },
];

/**
 * Rank position (1-based) of an id in a ranked result list, or Infinity.
 *
 * @param {Array<{id: string}>} ranked
 * @param {string} id
 * @returns {number}
 */
function rankOf(ranked, id) {
  const idx = ranked.findIndex((r) => r.id === id);
  return idx === -1 ? Infinity : idx + 1;
}

/**
 * Assert that every returned item has the scoreRetrieval-compatible shape.
 *
 * @param {Array<Object>} ranked
 */
function assertItemShape(ranked) {
  for (const item of ranked) {
    assert.equal(typeof item.id, 'string', 'item.id is a string');
    assert.equal(typeof item.score, 'number', 'item.score is a number');
    assert.equal(typeof item.title, 'string', 'item.title is a string');
    assert.equal(typeof item.body, 'string', 'item.body is a string');
    assert.equal(typeof item.type, 'string', 'item.type is a string');
  }
}

// ─────────────────────────────────────────────────────────
// Keyword retriever
// ─────────────────────────────────────────────────────────

describe('Keyword retriever', () => {
  it('exports name and retrieve', () => {
    assert.equal(keyword.name, 'keyword');
    assert.equal(typeof keyword.retrieve, 'function');
  });

  it('ranks relevant memories above distractors', () => {
    const ranked = keyword.retrieve(CORPUS, QUERY, { top: 10 });
    const worstRelevantRank = Math.max(...RELEVANT_IDS.map((id) => rankOf(ranked, id)));
    const bestDistractorRank = Math.min(
      ...CORPUS
        .filter((m) => !RELEVANT_IDS.includes(m.id))
        .map((m) => rankOf(ranked, m.id)),
    );
    assert.ok(
      worstRelevantRank < bestDistractorRank,
      `all relevant ranked above all distractors (worst relevant=${worstRelevantRank}, best distractor=${bestDistractorRank})`,
    );
  });

  it('respects the top cutoff', () => {
    const ranked = keyword.retrieve(CORPUS, QUERY, { top: 3 });
    assert.equal(ranked.length, 3);
  });

  it('is deterministic across two calls', () => {
    const a = keyword.retrieve(CORPUS, QUERY, { top: 10 });
    const b = keyword.retrieve(CORPUS, QUERY, { top: 10 });
    assert.deepEqual(
      a.map((r) => r.id),
      b.map((r) => r.id),
    );
    assert.deepEqual(
      a.map((r) => r.score),
      b.map((r) => r.score),
    );
  });

  it('returns scoreRetrieval-compatible items', () => {
    const ranked = keyword.retrieve(CORPUS, QUERY, { top: 10 });
    assertItemShape(ranked);
  });

  it('achieves positive Recall@k against the relevant set', () => {
    const ranked = keyword.retrieve(CORPUS, QUERY, { top: 10 });
    const { recall } = scoreRetrieval(ranked, RELEVANT_IDS, [3, 5]);
    assert.ok(recall[5] > 0, `Recall@5 should be > 0, got ${recall[5]}`);
    assert.equal(recall[5], 1, 'all 3 relevant memories within top 5');
  });
});

// ─────────────────────────────────────────────────────────
// Vector-baseline retriever
// ─────────────────────────────────────────────────────────

describe('Vector-baseline retriever', () => {
  it('exports name, retrieve, and embed', () => {
    assert.equal(vectorBaseline.name, 'vector-baseline');
    assert.equal(typeof vectorBaseline.retrieve, 'function');
    assert.equal(typeof vectorBaseline.embed, 'function');
  });

  it('embed is deterministic', () => {
    const a = vectorBaseline.embed('redis cache ttl');
    const b = vectorBaseline.embed('redis cache ttl');
    assert.deepEqual(Array.from(a), Array.from(b));
  });

  it('embed produces an L2-normalized vector (norm ≈ 1)', () => {
    const v = vectorBaseline.embed('redis cache ttl for list endpoints');
    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    assert.ok(Math.abs(norm - 1) < 1e-9, `norm should be ≈1, got ${norm}`);
  });

  it('embed of empty text is the zero vector (norm 0)', () => {
    const v = vectorBaseline.embed('');
    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
    assert.equal(Math.sqrt(norm), 0);
  });

  it('ranks relevant memories above distractors', () => {
    const ranked = vectorBaseline.retrieve(CORPUS, QUERY, { top: 10 });
    const worstRelevantRank = Math.max(...RELEVANT_IDS.map((id) => rankOf(ranked, id)));
    const bestDistractorRank = Math.min(
      ...CORPUS
        .filter((m) => !RELEVANT_IDS.includes(m.id))
        .map((m) => rankOf(ranked, m.id)),
    );
    assert.ok(
      worstRelevantRank < bestDistractorRank,
      `all relevant ranked above all distractors (worst relevant=${worstRelevantRank}, best distractor=${bestDistractorRank})`,
    );
  });

  it('respects the top cutoff', () => {
    const ranked = vectorBaseline.retrieve(CORPUS, QUERY, { top: 3 });
    assert.equal(ranked.length, 3);
  });

  it('is deterministic across two calls', () => {
    const a = vectorBaseline.retrieve(CORPUS, QUERY, { top: 10 });
    const b = vectorBaseline.retrieve(CORPUS, QUERY, { top: 10 });
    assert.deepEqual(
      a.map((r) => r.id),
      b.map((r) => r.id),
    );
  });

  it('returns scoreRetrieval-compatible items', () => {
    const ranked = vectorBaseline.retrieve(CORPUS, QUERY, { top: 10 });
    assertItemShape(ranked);
  });

  it('achieves positive Recall@k against the relevant set', () => {
    const ranked = vectorBaseline.retrieve(CORPUS, QUERY, { top: 10 });
    const { recall } = scoreRetrieval(ranked, RELEVANT_IDS, [3, 5]);
    assert.ok(recall[5] > 0, `Recall@5 should be > 0, got ${recall[5]}`);
  });
});

// ─────────────────────────────────────────────────────────
// mem0 retriever (gated stub)
// ─────────────────────────────────────────────────────────

describe('mem0 retriever', () => {
  it('exports name and an async retrieve', () => {
    assert.equal(mem0.name, 'mem0');
    assert.equal(typeof mem0.retrieve, 'function');
  });

  it('rejects with the configured-absence error when no key is set', async () => {
    const savedMem0 = process.env.MEM0_API_KEY;
    const savedOpenai = process.env.OPENAI_API_KEY;
    const savedEmbed = process.env.MEM0_EMBEDDING_API_KEY;
    delete process.env.MEM0_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.MEM0_EMBEDDING_API_KEY;
    try {
      await assert.rejects(
        () => mem0.retrieve(CORPUS, QUERY, { top: 10 }),
        /mem0 retriever not configured: set MEM0_API_KEY/,
      );
    } finally {
      if (savedMem0 !== undefined) process.env.MEM0_API_KEY = savedMem0;
      if (savedOpenai !== undefined) process.env.OPENAI_API_KEY = savedOpenai;
      if (savedEmbed !== undefined) process.env.MEM0_EMBEDDING_API_KEY = savedEmbed;
    }
  });
});
