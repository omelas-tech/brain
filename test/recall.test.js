const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createSearchIndex, addDocument, search } = require('../src/tfidf');
const { rankMemories } = require('../src/scorer');
const {
  reinforceStrength,
  improveDecayRate,
  computeSpacedBoost,
} = require('../src/scorer');
const {
  readIndex,
  writeIndex,
  readAssociations,
  writeAssociations,
  reinforceEdge,
} = require('../src/index-manager');

// ===========================================================================
// End-to-end recall scoring (tfidf + scorer integration)
// ===========================================================================
describe('End-to-end recall scoring', () => {
  it('ranks memories by TF-IDF relevance + v4 formula', () => {
    const searchIndex = createSearchIndex();

    // Add documents
    addDocument(searchIndex, 'mem_db', {
      title: 'Database Connection Pooling',
      body: 'Use pg pool with parameterized queries. Connection pooling pattern.',
      tags: ['database', 'postgres', 'pooling'],
    });
    addDocument(searchIndex, 'mem_auth', {
      title: 'JWT Authentication',
      body: 'Use JWT tokens with refresh rotation and bcrypt.',
      tags: ['auth', 'jwt', 'security'],
    });
    addDocument(searchIndex, 'mem_error', {
      title: 'Error Handling Pattern',
      body: 'Custom AppError class with statusCode. Centralized error middleware.',
      tags: ['error-handling', 'patterns'],
    });

    // Get TF-IDF scores
    const tfidfScores = search(searchIndex, 'database connection pool');

    // Build memory entries (as they'd appear in index.json)
    const now = new Date();
    const recent = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
    const old = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago

    const memories = [
      {
        id: 'mem_db',
        strength: 0.80,
        decay_rate: 0.995,
        last_accessed: recent,
        salience: 0.7,
        encoding_context: { project: 'my-app', topics: ['database'], task_type: 'implementing' },
      },
      {
        id: 'mem_auth',
        strength: 0.85,
        decay_rate: 0.997,
        last_accessed: recent,
        salience: 0.6,
        encoding_context: { project: 'my-app', topics: ['auth'], task_type: 'implementing' },
      },
      {
        id: 'mem_error',
        strength: 0.70,
        decay_rate: 0.993,
        last_accessed: old,
        salience: 0.5,
        encoding_context: { project: 'other', topics: ['errors'], task_type: 'debugging' },
      },
    ];

    // Rank with TF-IDF relevance
    const ranked = rankMemories(
      memories,
      (mem) => tfidfScores[mem.id] || 0,
      {
        recallContext: { project: 'my-app', topics: ['database'], task_type: 'implementing' },
      }
    );

    // Database memory should be #1 (highest TF-IDF relevance + context match)
    assert.equal(ranked[0].id, 'mem_db');
    assert.ok(ranked[0].score > ranked[1].score);

    // All scores should be numeric and between 0-1
    for (const mem of ranked) {
      assert.ok(typeof mem.score === 'number');
      assert.ok(mem.score >= 0 && mem.score <= 1, `Score ${mem.score} out of range`);
    }
  });

  it('spreading activation boosts connected memories', () => {
    const searchIndex = createSearchIndex();
    addDocument(searchIndex, 'mem_pool', {
      title: 'Connection Pool',
      body: 'Database connection pooling.',
      tags: ['database'],
    });
    addDocument(searchIndex, 'mem_migrate', {
      title: 'Migration Pattern',
      body: 'Sequential migration files.',
      tags: ['database', 'migrations'],
    });

    const tfidfScores = search(searchIndex, 'connection pool');

    const now = new Date().toISOString();
    // origin: 'user' pins trust to the neutral 1.0 factor — this test isolates
    // spreading-activation mechanics; trust weighting has its own suite
    // (trust-recall.test.js). Without it, the default-origin source damping
    // (×0.95) pushes this fixture's bonus below the weighted-average
    // break-even and the with-associations score dips instead of rising.
    const memories = [
      { id: 'mem_pool', strength: 0.80, decay_rate: 0.995, last_accessed: now, salience: 0.7, origin: 'user' },
      { id: 'mem_migrate', strength: 0.60, decay_rate: 0.990, last_accessed: now, salience: 0.5, origin: 'user' },
    ];

    // Without associations
    const withoutAssoc = rankMemories(memories, (m) => tfidfScores[m.id] || 0);

    // With associations (pool → migrate)
    const associations = { edges: {
      'mem_pool': { 'mem_migrate': { weight: 0.7, co_retrievals: 2, last_activated: now, origin: 'tag_overlap' } },
      'mem_migrate': { 'mem_pool': { weight: 0.7, co_retrievals: 2, last_activated: now, origin: 'tag_overlap' } },
    }};
    const withAssoc = rankMemories(memories, (m) => tfidfScores[m.id] || 0, { associations });

    // Migration memory should get a spreading bonus
    const migrateWithout = withoutAssoc.find((m) => m.id === 'mem_migrate');
    const migrateWith = withAssoc.find((m) => m.id === 'mem_migrate');
    assert.ok(migrateWith.spreading_bonus > 0, 'Should have spreading bonus');
    assert.ok(migrateWith.score >= migrateWithout.score, 'Score should be equal or higher with associations');
  });
});

// ===========================================================================
// Reinforcement (spaced boost + Hebbian)
// ===========================================================================
describe('Reinforcement', () => {
  it('reinforceStrength applies spacing-aware boost', () => {
    const strength = reinforceStrength(0.80, 7, 3);
    assert.ok(strength > 0.80, 'Should increase');
    assert.ok(strength <= 1.0, 'Should not exceed 1.0');
  });

  it('longer spacing gives bigger boost (up to cap)', () => {
    const boost1 = computeSpacedBoost(1, 0);   // 1 day, first recall
    const boost3 = computeSpacedBoost(3, 0);   // 3 days, first recall
    assert.ok(boost3 > boost1, '3-day gap should give bigger boost than 1-day');
    // Very long gaps are capped at spacingMultiplier = 3.0
    const boost7 = computeSpacedBoost(7, 0);
    const boost30 = computeSpacedBoost(30, 0);
    assert.ok(boost30 >= boost7, '30-day boost should be >= 7-day (both may hit cap)');
  });

  it('cramming has diminishing returns', () => {
    const boost0 = computeSpacedBoost(0, 0);   // first recall today
    const boost10 = computeSpacedBoost(0, 10);  // 10th recall today
    const boost20 = computeSpacedBoost(0, 20);  // 20th recall today
    assert.ok(boost10 < boost0, '10th recall should give less boost');
    assert.ok(boost20 < boost10, '20th recall should give even less');
  });

  it('improveDecayRate approaches 0.999 asymptotically', () => {
    let rate = 0.990;
    for (let i = 0; i < 50; i++) {
      rate = improveDecayRate(rate);
    }
    assert.ok(rate > 0.998, `Rate should approach 0.999, got ${rate}`);
    assert.ok(rate < 1.0, 'Rate should never reach 1.0');
  });

  it('Hebbian co-retrieval strengthens edges', () => {
    const assoc = { version: 1, edges: {} };
    reinforceEdge(assoc, 'mem_a', 'mem_b', 'co_retrieval', 0.20);
    assert.equal(assoc.edges['mem_a']['mem_b'].weight, 0.20);

    // Reinforce again
    reinforceEdge(assoc, 'mem_a', 'mem_b', 'co_retrieval');
    assert.ok(assoc.edges['mem_a']['mem_b'].weight > 0.20, 'Weight should increase');
    assert.equal(assoc.edges['mem_a']['mem_b'].co_retrievals, 1);
  });
});

// ===========================================================================
// computeRecall: sensitive-topic consent gate
// ===========================================================================
describe('computeRecall sensitivity gate', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { writeIndex, writeConfig, readConfig } = require('../src/index-manager');
  const { computeRecall } = require('../bin/recall');
  let root;

  const mems = (over = {}) => ({
    s1: {
      title: 'Therapy schedule', path: 'personal/health/therapy.md', type: 'preference', cognitive_type: 'semantic',
      created: new Date().toISOString(), last_accessed: new Date().toISOString(), strength: 0.9, decay_rate: 0.998,
      salience: 0.8, confidence: 0.9, tags: ['therapy'], sensitivity: 'sensitive', ...over,
    },
    n1: {
      title: 'Therapy app deploy target', path: 'professional/therapy-app/deploy.md', type: 'decision', cognitive_type: 'semantic',
      created: new Date().toISOString(), last_accessed: new Date().toISOString(), strength: 0.9, decay_rate: 0.998,
      salience: 0.6, confidence: 0.9, tags: ['therapy', 'deploy'],
    },
  });

  function seedBrain(memories) {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-recall-sens-'));
    const brain = path.join(root, '.brain');
    for (const m of Object.values(memories)) {
      const file = path.join(brain, m.path);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `---\ntitle: ${m.title}\n---\n${m.title} body\n`);
    }
    writeIndex({ version: '2.0', memory_count: Object.keys(memories).length, memories, last_updated: new Date().toISOString() }, root);
  }

  it('omits sensitive memories until opted in, then marks their receipts', () => {
    seedBrain(mems());
    try {
      const hidden = computeRecall({ query: 'therapy', top: 10 }, root).map((r) => r.id);
      assert.deepEqual(hidden, ['n1']);

      writeConfig({ ...readConfig(root), sensitive_topics: true }, root);
      const shown = computeRecall({ query: 'therapy', top: 10 }, root);
      const s1 = shown.find((r) => r.id === 's1');
      assert.ok(s1, 'sensitive memory recalled after opt-in');
      assert.equal(s1.sensitivity, 'sensitive');
      assert.match(s1.receipt, /⚠ sensitive\)$/);
      assert.equal(shown.find((r) => r.id === 'n1').sensitivity, undefined);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('treats a vetted sensitive memory as individually approved', () => {
    seedBrain(mems({ vetted: true }));
    try {
      assert.ok(computeRecall({ query: 'therapy', top: 10 }, root).some((r) => r.id === 's1'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
