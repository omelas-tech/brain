/**
 * Brain Memory — Stress / Benchmark Tests
 *
 * Generates 500 synthetic memories with realistic variation,
 * builds an association graph, and benchmarks core operations
 * against time limits. Also validates correctness at scale.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');

const {
  rankMemories,
  discoverViaActivation,
  computeSpreadingActivation,
  computeDecayedStrength,
  computeRecencyBonus,
} = require('../src/scorer');

const {
  addMemory,
  removeMemory,
  updateMemory,
  generateId,
  decayAssociations,
} = require('../src/index-manager');

// ---------------------------------------------------------------------------
// Constants & Pools
// ---------------------------------------------------------------------------

const MEMORY_COUNT = 500;

const TYPES = [
  'decision', 'learning', 'experience', 'insight',
  'observation', 'goal', 'preference', 'relationship',
];

const COGNITIVE_TYPES = ['episodic', 'semantic', 'procedural'];

const TAG_POOL = [
  'architecture', 'scaling', 'security', 'testing', 'refactoring',
  'performance', 'database', 'api', 'frontend', 'backend',
  'deployment', 'monitoring', 'logging', 'caching', 'auth',
  'validation', 'error-handling', 'documentation', 'ci-cd', 'docker',
  'typescript', 'react', 'node', 'graphql', 'rest',
  'microservices', 'serverless', 'observability', 'accessibility', 'ux',
];

const PROJECTS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];

const TOPICS = [
  'architecture', 'performance', 'security', 'testing', 'deployment',
  'design', 'data-modeling', 'api-design', 'ux-research', 'devops',
];

const TASK_TYPES = [
  'designing', 'implementing', 'debugging', 'reviewing', 'optimizing',
  'documenting', 'testing', 'deploying',
];

const CATEGORIES = [
  'professional/skills', 'professional/decisions', 'professional/patterns',
  'projects/alpha', 'projects/beta', 'projects/gamma',
  'meta/observations', 'meta/insights',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seeded PRNG for reproducible tests (xorshift32). */
function createRng(seed) {
  let s = seed | 0 || 1;
  return function next() {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

const rng = createRng(42);

function pick(arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function pickN(arr, min, max) {
  const count = min + Math.floor(rng() * (max - min + 1));
  const shuffled = [...arr].sort(() => rng() - 0.5);
  return shuffled.slice(0, count);
}

function randomFloat(lo, hi) {
  return lo + rng() * (hi - lo);
}

function randomInt(lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** ISO string for a random date within the past N days (at least 1 day ago). */
function randomPastDate(maxDays) {
  const daysBack = 1 + Math.floor(rng() * (maxDays - 1));
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  d.setHours(Math.floor(rng() * 24), Math.floor(rng() * 60), 0, 0);
  return d.toISOString();
}

/** Generate a hex string of given length. */
function hexStr(len) {
  let h = '';
  for (let i = 0; i < len; i++) {
    h += Math.floor(rng() * 16).toString(16);
  }
  return h;
}

// ---------------------------------------------------------------------------
// Data Generation
// ---------------------------------------------------------------------------

function generateMemories(count) {
  const memories = [];
  for (let i = 0; i < count; i++) {
    const daysBack = randomInt(1, 365);
    const dateStr = new Date(Date.now() - daysBack * 86400000)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');
    const id = `mem_${dateStr}_${hexStr(6)}`;
    const tags = pickN(TAG_POOL, 1, 6);
    const category = pick(CATEGORIES);

    memories.push({
      id,
      type: pick(TYPES),
      cognitive_type: pick(COGNITIVE_TYPES),
      strength: Math.round(randomFloat(0.1, 1.0) * 1000) / 1000,
      decay_rate: Math.round(randomFloat(0.950, 0.998) * 10000) / 10000,
      last_accessed: randomPastDate(365),
      access_count: randomInt(0, 50),
      tags,
      salience: Math.round(randomFloat(0.0, 1.0) * 1000) / 1000,
      confidence: Math.round(randomFloat(0.5, 1.0) * 1000) / 1000,
      path: `${category}/${hexStr(4)}.md`,
      encoding_context: {
        project: pick(PROJECTS),
        topics: pickN(TOPICS, 1, 3),
        task_type: pick(TASK_TYPES),
      },
    });
  }
  return memories;
}

/**
 * Build associations for memories sharing 2+ tags.
 * Uses an inverted index for efficient pair discovery.
 * Targets approximately 15% connectivity density, capped to keep
 * the graph traversable within benchmark time limits.
 *
 * The 15% density target is relative to the total possible edges
 * (N*(N-1)/2 = 124,750 for 500 memories). This produces a realistically
 * connected graph while keeping BFS-based spreading activation tractable.
 */
function generateAssociations(memories) {
  const associations = { edges: {} };

  // Build inverted tag index
  const tagIndex = {};
  for (const mem of memories) {
    for (const tag of mem.tags) {
      if (!tagIndex[tag]) tagIndex[tag] = [];
      tagIndex[tag].push(mem.id);
    }
  }

  // Build ID -> tags lookup for efficient shared-tag counting
  const tagsById = new Map();
  for (const mem of memories) {
    tagsById.set(mem.id, new Set(mem.tags));
  }

  // Collect all pairs sharing at least 1 tag, count shared tags
  const pairSharedCount = new Map();
  for (const tag of Object.keys(tagIndex)) {
    const ids = tagIndex[tag];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`;
        pairSharedCount.set(key, (pairSharedCount.get(key) || 0) + 1);
      }
    }
  }

  // Filter to pairs with 2+ shared tags
  const eligiblePairs = [];
  for (const [key, shared] of pairSharedCount) {
    if (shared >= 2) eligiblePairs.push(key);
  }

  // Cap at 15% of total possible edges
  const totalPossibleEdges = (memories.length * (memories.length - 1)) / 2;
  const maxEdges = Math.floor(totalPossibleEdges * 0.15);
  const edgesToCreate = Math.min(eligiblePairs.length, maxEdges);

  // Shuffle eligible pairs and take up to the cap
  eligiblePairs.sort(() => rng() - 0.5);
  let edgeCount = 0;

  for (let i = 0; i < edgesToCreate; i++) {
    const [idA, idB] = eligiblePairs[i].split('|');
    if (!associations.edges[idA]) associations.edges[idA] = {};
    if (!associations.edges[idB]) associations.edges[idB] = {};

    const weight = Math.round(randomFloat(0.1, 0.8) * 1000) / 1000;
    const edgeData = {
      weight,
      co_retrievals: randomInt(0, 10),
      last_activated: randomPastDate(90),
      origin: 'tag_overlap',
    };

    associations.edges[idA][idB] = { ...edgeData };
    associations.edges[idB][idA] = { ...edgeData };
    edgeCount++;
  }

  return { associations, edgeCount };
}

// ---------------------------------------------------------------------------
// Generate test data (shared across all tests)
// ---------------------------------------------------------------------------

const memories = generateMemories(MEMORY_COUNT);
const { associations, edgeCount } = generateAssociations(memories);

const recallContext = {
  project: 'alpha',
  topics: ['architecture', 'performance'],
  task_type: 'designing',
};

/** Simple relevance function based on tag overlap with recall context topics. */
function relevanceFn(mem) {
  const contextTopics = new Set(recallContext.topics);
  const overlap = mem.tags.filter((t) => contextTopics.has(t)).length;
  return Math.min(1.0, overlap / Math.max(1, recallContext.topics.length));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Stress Tests — Data Generation', () => {
  it(`generates ${MEMORY_COUNT} memories`, () => {
    assert.equal(memories.length, MEMORY_COUNT);
  });

  it('memories have valid structure', () => {
    for (const mem of memories) {
      assert.ok(mem.id.startsWith('mem_'), `ID should start with mem_: ${mem.id}`);
      assert.ok(TYPES.includes(mem.type), `Invalid type: ${mem.type}`);
      assert.ok(COGNITIVE_TYPES.includes(mem.cognitive_type));
      assert.ok(mem.strength >= 0.1 && mem.strength <= 1.0, `Strength out of range: ${mem.strength}`);
      assert.ok(mem.decay_rate >= 0.950 && mem.decay_rate <= 0.998, `Decay rate out of range: ${mem.decay_rate}`);
      assert.ok(mem.tags.length >= 1 && mem.tags.length <= 6, `Tags count out of range: ${mem.tags.length}`);
      assert.ok(mem.salience >= 0.0 && mem.salience <= 1.0, `Salience out of range: ${mem.salience}`);
      assert.ok(mem.confidence >= 0.5 && mem.confidence <= 1.0, `Confidence out of range: ${mem.confidence}`);
      assert.ok(mem.encoding_context.project, 'Missing encoding_context.project');
      assert.ok(mem.encoding_context.topics.length > 0, 'Missing encoding_context.topics');
      assert.ok(mem.encoding_context.task_type, 'Missing encoding_context.task_type');
    }
  });

  it('generates associations targeting ~15% density', () => {
    const totalPossible = (MEMORY_COUNT * (MEMORY_COUNT - 1)) / 2;
    const density = edgeCount / totalPossible;
    assert.ok(edgeCount > 0, `Should have associations, got ${edgeCount}`);
    assert.ok(density <= 0.20, `Density ${(density * 100).toFixed(1)}% exceeds 20% cap`);
    console.log(`    Association edges: ${edgeCount} (density: ${(density * 100).toFixed(2)}%)`);
  });
});

// Wall-clock perf budgets are inherently noisy: a busy laptop (background
// builds, thermal throttling, GC pauses) can blow a tight budget even when the
// code is fine. CI runners are slower but more controlled, so we hard-gate
// there with generous slack. Locally — where `prerelease` also runs `npm test`
// — we measure and log but DON'T fail on the wall clock, so timing jitter can't
// flake the suite. Correctness assertions below run unconditionally either way.
const ON_CI = !!process.env.CI;
const PERF_MULTIPLIER = ON_CI ? 5 : 10;

/**
 * Assert a wall-clock performance budget without flaking locally.
 * On CI: a hard gate at `limitMs * PERF_MULTIPLIER`.
 * Locally: logs a warning when the (very generous) budget is exceeded, but
 * never fails — local timing is too noisy to gate a release-blocking suite on.
 */
function assertPerf(elapsed, limitMs, label) {
  const budget = limitMs * PERF_MULTIPLIER;
  if (elapsed < budget) return;
  const msg = `${label} took ${elapsed.toFixed(2)}ms, expected <${budget}ms`;
  if (ON_CI) {
    assert.ok(false, msg);
  } else {
    console.warn(`    ⚠ perf budget exceeded (not gated locally): ${msg}`);
  }
}

describe('Stress Tests — Performance Benchmarks', () => {
  it('rankMemories with 500 memories + associations + context completes in <500ms', () => {
    const start = performance.now();
    const ranked = rankMemories(memories, relevanceFn, {
      associations,
      recallContext,
    });
    const elapsed = performance.now() - start;

    console.log(`    rankMemories: ${elapsed.toFixed(2)}ms for ${memories.length} memories (${edgeCount} edges)`);
    assertPerf(elapsed, 500, 'rankMemories');
    assert.equal(ranked.length, MEMORY_COUNT);
  });

  it('discoverViaActivation across full graph completes in <200ms', () => {
    // Build scored memories (top 50 from ranking)
    const ranked = rankMemories(memories, relevanceFn, { associations, recallContext });
    const scoredMemories = ranked.slice(0, 50).map((m) => ({ id: m.id, score: m.score }));

    const start = performance.now();
    const discovered = discoverViaActivation(scoredMemories, associations, 2, 0.05);
    const elapsed = performance.now() - start;

    console.log(`    discoverViaActivation: ${elapsed.toFixed(2)}ms, found ${discovered.length} candidates`);
    assertPerf(elapsed, 200, 'discoverViaActivation');
  });

  it('decayAssociations on full graph completes in <100ms', () => {
    // Deep-copy associations to avoid mutating shared data
    const assocCopy = JSON.parse(JSON.stringify(associations));

    const start = performance.now();
    decayAssociations(assocCopy, 0.998, 0.05);
    const elapsed = performance.now() - start;

    console.log(`    decayAssociations: ${elapsed.toFixed(2)}ms`);
    assertPerf(elapsed, 100, 'decayAssociations');
  });

  it('index CRUD: add 500, update 100, remove 50 completes in <50ms', () => {
    const index = { memories: {}, memory_count: 0 };

    const start = performance.now();

    // Add 500
    for (const mem of memories) {
      addMemory(index, mem.id, { ...mem });
    }

    // Update 100
    const idsToUpdate = memories.slice(0, 100).map((m) => m.id);
    for (const id of idsToUpdate) {
      updateMemory(index, id, { strength: 0.99, access_count: 100 });
    }

    // Remove 50
    const idsToRemove = memories.slice(100, 150).map((m) => m.id);
    for (const id of idsToRemove) {
      removeMemory(index, id);
    }

    const elapsed = performance.now() - start;

    console.log(`    index CRUD (add 500 + update 100 + remove 50): ${elapsed.toFixed(2)}ms`);
    assertPerf(elapsed, 50, 'index CRUD');
    assert.equal(index.memory_count, 450); // 500 - 50 removed
    // Verify updates applied
    assert.equal(index.memories[idsToUpdate[0]].strength, 0.99);
    assert.equal(index.memories[idsToUpdate[0]].access_count, 100);
    // Verify removals applied
    assert.equal(index.memories[idsToRemove[0]], undefined);
  });

  it('computeSpreadingActivation for 10 random memories completes in <200ms', () => {
    const ranked = rankMemories(memories, relevanceFn, { associations, recallContext });
    const scoredMemories = ranked.slice(0, 50).map((m) => ({ id: m.id, score: m.score }));

    // Pick 10 random memories not in the scored set
    const scoredIds = new Set(scoredMemories.map((m) => m.id));
    const candidates = memories.filter((m) => !scoredIds.has(m.id)).slice(0, 10);

    const start = performance.now();
    const results = [];
    for (const mem of candidates) {
      const bonus = computeSpreadingActivation(mem.id, scoredMemories, associations, 2);
      results.push({ id: mem.id, bonus });
    }
    const elapsed = performance.now() - start;

    console.log(`    computeSpreadingActivation (10 memories): ${elapsed.toFixed(2)}ms`);
    assertPerf(elapsed, 200, 'computeSpreadingActivation');
    // All bonuses should be in [0, 1]
    for (const r of results) {
      assert.ok(r.bonus >= 0 && r.bonus <= 1.0, `Bonus out of range for ${r.id}: ${r.bonus}`);
    }
  });
});

describe('Stress Tests — Correctness at Scale', () => {
  it('all ranked scores are between 0 and 1', () => {
    const ranked = rankMemories(memories, relevanceFn, { associations, recallContext });
    for (const mem of ranked) {
      assert.ok(
        mem.score >= 0 && mem.score <= 1.0,
        `Score out of [0,1] for ${mem.id}: ${mem.score}`
      );
    }
  });

  it('ranking is monotonically non-increasing', () => {
    const ranked = rankMemories(memories, relevanceFn, { associations, recallContext });
    for (let i = 1; i < ranked.length; i++) {
      assert.ok(
        ranked[i].score <= ranked[i - 1].score,
        `Rank violation at position ${i}: ${ranked[i - 1].score} should be >= ${ranked[i].score}`
      );
    }
  });

  it('association decay reduces all weights', () => {
    // Create a controlled graph with known weights set 30 days ago
    const controlAssoc = { edges: {} };
    const memIds = memories.slice(0, 20).map((m) => m.id);

    for (let i = 0; i < memIds.length - 1; i++) {
      const idA = memIds[i];
      const idB = memIds[i + 1];
      if (!controlAssoc.edges[idA]) controlAssoc.edges[idA] = {};
      if (!controlAssoc.edges[idB]) controlAssoc.edges[idB] = {};

      const lastActivated = new Date();
      lastActivated.setDate(lastActivated.getDate() - 30);

      const edge = {
        weight: 0.5,
        co_retrievals: 3,
        last_activated: lastActivated.toISOString(),
        origin: 'tag_overlap',
      };
      controlAssoc.edges[idA][idB] = { ...edge };
      controlAssoc.edges[idB][idA] = { ...edge };
    }

    // Record weights before decay
    const weightsBefore = {};
    for (const src of Object.keys(controlAssoc.edges)) {
      for (const dst of Object.keys(controlAssoc.edges[src])) {
        weightsBefore[`${src}|${dst}`] = controlAssoc.edges[src][dst].weight;
      }
    }

    decayAssociations(controlAssoc, 0.998, 0.01);

    // Verify all remaining weights decreased
    for (const src of Object.keys(controlAssoc.edges)) {
      for (const dst of Object.keys(controlAssoc.edges[src])) {
        const key = `${src}|${dst}`;
        const before = weightsBefore[key];
        const after = controlAssoc.edges[src][dst].weight;
        assert.ok(
          after < before,
          `Weight should decrease: ${before} -> ${after} for ${key}`
        );
      }
    }
  });

  it('discovered memories via activation are not in the initial scored set', () => {
    const ranked = rankMemories(memories, relevanceFn, { associations, recallContext });
    const scoredMemories = ranked.slice(0, 50).map((m) => ({ id: m.id, score: m.score }));
    const scoredIds = new Set(scoredMemories.map((m) => m.id));

    const discovered = discoverViaActivation(scoredMemories, associations, 2, 0.05);

    for (const candidate of discovered) {
      assert.ok(
        !scoredIds.has(candidate.id),
        `Discovered memory ${candidate.id} should NOT be in the initial scored set`
      );
      assert.ok(
        candidate.spreadingBonus >= 0.05,
        `Spreading bonus should be >= minBonus threshold: ${candidate.spreadingBonus}`
      );
      assert.ok(
        candidate.spreadingBonus <= 1.0,
        `Spreading bonus should be <= 1.0: ${candidate.spreadingBonus}`
      );
    }

    console.log(`    Discovered ${discovered.length} new candidates via activation`);
  });

  it('all component scores (decayed_strength, recency_bonus) are in valid range', () => {
    for (const mem of memories) {
      const ds = computeDecayedStrength(mem.strength, mem.decay_rate, mem.last_accessed);
      const rb = computeRecencyBonus(mem.last_accessed);

      assert.ok(ds >= 0, `decayed_strength should be >= 0 for ${mem.id}: ${ds}`);
      assert.ok(
        ds <= mem.strength + 1e-9,
        `decayed_strength should be <= base strength for ${mem.id}: ${ds} > ${mem.strength}`
      );
      // recency_bonus: linear decay over 365 days, in [0, 1].
      // Allow tiny floating-point overshoot (dates very close to "now").
      assert.ok(rb >= 0, `recency_bonus should be >= 0 for ${mem.id}: ${rb}`);
      assert.ok(rb <= 1.01, `recency_bonus should be <= ~1.0 for ${mem.id}: ${rb}`);
    }
  });

  it('index maintains correct memory_count through CRUD operations', () => {
    const index = { memories: {}, memory_count: 0 };

    // Add all
    for (const mem of memories) {
      addMemory(index, mem.id, { ...mem });
    }
    assert.equal(index.memory_count, MEMORY_COUNT);

    // Remove 100
    const toRemove = memories.slice(0, 100);
    for (const mem of toRemove) {
      removeMemory(index, mem.id);
    }
    assert.equal(index.memory_count, MEMORY_COUNT - 100);

    // Add 50 new ones
    for (let i = 0; i < 50; i++) {
      addMemory(index, `mem_new_${i}`, { type: 'learning', strength: 0.5 });
    }
    assert.equal(index.memory_count, MEMORY_COUNT - 100 + 50);
  });
});
