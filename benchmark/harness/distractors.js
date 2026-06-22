/**
 * Distractor corpus — deterministic, plausible-but-irrelevant memories.
 *
 * Why this exists: today's benchmark has 1-5 memories per scenario, all of
 * them relevant. Recall is trivially perfect. The LongMemEval methodology
 * (arxiv 2410.10813) demonstrated that retrieval-architecture benchmarks
 * are uninformative without a haystack — typically ~50× more distractors
 * than oracle memories.
 *
 * generateDistractors(size, rng) produces N memories spread across 6 fake
 * projects, 12 topic clusters, and 8 memory types. The same seed always
 * yields the same corpus. Oracle memories from scenarios are layered on top.
 *
 * Three preset sizes mirror LongMemEval-S/M/Oracle:
 *   small   — 50  distractors (≈40-50k tok of memory pool)
 *   medium  — 200 distractors (≈150-200k tok)
 *   large   — 800 distractors (≈600-800k tok, may exceed budget)
 */

const FAKE_PROJECTS = [
  'aurora-cms',     // Vue + Postgres CMS
  'beacon-mobile',  // React Native fitness app
  'cinder-ml',      // Python ML training pipeline
  'driftwood-api',  // Go gRPC backend
  'ember-cli-tool', // Rust CLI utility
  'forge-iac',      // Terraform infra
];

const TOPIC_CLUSTERS = [
  { topic: 'caching',           tags: ['redis', 'cache', 'memcached'] },
  { topic: 'queue-management',  tags: ['rabbitmq', 'sqs', 'queue', 'celery'] },
  { topic: 'frontend-state',    tags: ['vuex', 'pinia', 'state-management'] },
  { topic: 'mobile-navigation', tags: ['react-navigation', 'deep-link'] },
  { topic: 'model-training',    tags: ['pytorch', 'tensorboard', 'training-loop'] },
  { topic: 'grpc-design',       tags: ['grpc', 'protobuf', 'streaming'] },
  { topic: 'cli-ergonomics',    tags: ['clap', 'argparse', 'cli-design'] },
  { topic: 'iac-modules',       tags: ['terraform', 'module', 'iac'] },
  { topic: 'logging',           tags: ['structured-logs', 'observability'] },
  { topic: 'feature-flags',     tags: ['launchdarkly', 'feature-flag'] },
  { topic: 'i18n',              tags: ['i18n', 'localization'] },
  { topic: 'pagination',        tags: ['cursor', 'pagination', 'offset'] },
];

const MEM_TYPES = [
  { type: 'decision',    strength: 0.85, decay_rate: 0.995 },
  { type: 'preference',  strength: 0.60, decay_rate: 0.998 },
  { type: 'learning',    strength: 0.70, decay_rate: 0.990 },
  { type: 'insight',     strength: 0.90, decay_rate: 0.997 },
  { type: 'experience',  strength: 0.75, decay_rate: 0.985 },
  { type: 'observation', strength: 0.40, decay_rate: 0.950 },
];

const SUMMARY_TEMPLATES = [
  (t) => `Switched from inline ${t} handling to a small helper module after merge conflicts.`,
  (t) => `Decided ${t} should be tested via property-based tests rather than fixtures.`,
  (t) => `${t} performance dropped after the v2 upgrade; pinned the older client for now.`,
  (t) => `New ${t} convention: never block the main thread; queue and ack.`,
  (t) => `Reviewed three ${t} libraries; picked the one with the smallest dep graph.`,
  (t) => `${t} edge case: empty input must short-circuit, not throw.`,
  (t) => `Documented ${t} retries: max 3 attempts, exponential backoff, jitter required.`,
  (t) => `Found a ${t} bug caused by timezone assumptions — always store UTC.`,
  (t) => `Standardised ${t} module names: lowercase-kebab, no version suffix in filenames.`,
  (t) => `${t} should not log raw payloads; redact PII before persisting.`,
];

const CONTENT_TEMPLATES = [
  (t) => `# ${t}\n\nKey points:\n- Use explicit configuration, never implicit defaults\n- Validate inputs at the boundary\n- Add a regression test before declaring fixed`,
  (t) => `# ${t}\n\nWe chose this approach because the alternative was harder to test in CI and added a transitive dependency we wanted to avoid.`,
  (t) => `# ${t}\n\nGotcha: error messages must include the offending field name. Generic errors burned 30 minutes last week.`,
];

/**
 * Tiny seeded RNG (xorshift32). Same algorithm as harness/seeder.js.
 */
function createRng(seed) {
  let s = (seed | 0) || 1;
  return function next() {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

/**
 * Generate N deterministic distractor memories.
 *
 * @param {number} n - How many to generate
 * @param {number} [seed=42] - Deterministic seed
 * @param {Object} [opts]
 * @param {Date|string} [opts.startDate] - Earliest created date
 * @param {Date|string} [opts.endDate] - Latest created date
 * @returns {Array<Object>} memories ready for seeder.seedMemories()
 */
function generateDistractors(n, seed = 42, opts = {}) {
  const rng = createRng(seed);
  const start = new Date(opts.startDate || '2025-09-01').getTime();
  const end = new Date(opts.endDate || '2026-03-01').getTime();

  const memories = [];
  for (let i = 0; i < n; i++) {
    const project = pick(rng, FAKE_PROJECTS);
    const cluster = pick(rng, TOPIC_CLUSTERS);
    const memType = pick(rng, MEM_TYPES);
    const summaryFn = pick(rng, SUMMARY_TEMPLATES);
    const contentFn = pick(rng, CONTENT_TEMPLATES);

    const createdMs = start + Math.floor(rng() * (end - start));
    const accessMs = createdMs + Math.floor(rng() * (end - createdMs));
    const id = `mem_distract_${seed}_${String(i).padStart(4, '0')}`;
    const title = `${cluster.topic} note ${i}`;
    const body = summaryFn(cluster.topic);
    const content = contentFn(title) + `\n\n${body}`;

    memories.push({
      id,
      type: memType.type,
      cognitive_type: memType.type === 'preference' ? 'procedural'
                    : memType.type === 'insight' ? 'episodic'
                    : 'semantic',
      title,
      body,
      content,
      path: `professional/${memType.type}s/${id}.md`,
      strength: memType.strength,
      decay_rate: memType.decay_rate,
      salience: 0.3 + rng() * 0.4,
      confidence: 0.6 + rng() * 0.3,
      tags: cluster.tags,
      access_count: Math.floor(rng() * 5),
      created: new Date(createdMs).toISOString(),
      last_accessed: new Date(accessMs).toISOString(),
      encoding_context: {
        project,
        topics: [cluster.topic],
        task_type: 'implementing',
      },
    });
  }
  return memories;
}

// Hard-negative bodies: assert an OLD/rejected convention for a topic. They
// share the oracle's project + tags + topic, so similarity-only retrievers
// (keyword/vector) rank them high and get confused — while decay/recency-aware
// recall should down-rank them (they are old and rarely accessed).
const HARD_NEG_BODIES = [
  (t) => `the previous ${t} approach used offset/page-number; it was later abandoned.`,
  (t) => `${t} used to be handled inline in components before the refactor.`,
  (t) => `an earlier ${t} decision set the TTL to 600s globally; this was reverted.`,
  (t) => `${t} once used a 3rd-party SaaS; replaced after the outage.`,
  (t) => `the old ${t} key format omitted the resource namespace.`,
];

/**
 * Generate hard-negative memories anchored to oracle memories: same project,
 * tags, and topic, but describing a SUPERSEDED convention. Deterministic.
 *
 * @param {Array<Object>} anchors - oracle memories to anchor against
 * @param {number} [perAnchor=3] - how many hard negatives per anchor
 * @param {number} [seed=7] - deterministic seed
 * @returns {Array<Object>}
 */
function generateHardNegatives(anchors, perAnchor = 3, seed = 7) {
  const rng = createRng(seed);
  const out = [];
  (anchors || []).forEach((a, ai) => {
    const proj = (a.encoding_context && a.encoding_context.project) || 'aurora-cms';
    const topics = (a.encoding_context && a.encoding_context.topics) || a.tags || [];
    const topic = topics[0] || 'general';
    for (let j = 0; j < perAnchor; j++) {
      const id = `mem_hardneg_${seed}_${ai}_${j}`;
      const body = `In ${proj}, a superseded ${topic} convention: ${pick(rng, HARD_NEG_BODIES)(topic)}`;
      out.push({
        id,
        type: 'decision',
        cognitive_type: 'semantic',
        title: `${topic} convention (superseded) ${ai}.${j}`,
        body,
        content: `# ${topic} (superseded)\n\n${body}\n\nThis was later changed; the current convention differs.`,
        path: `professional/decisions/${id}.md`,
        strength: 0.5,
        decay_rate: 0.99,
        salience: 0.4,
        confidence: 0.6,
        tags: a.tags || [topic],
        access_count: 1,
        created: '2025-08-01T00:00:00.000Z',     // old
        last_accessed: '2025-09-01T00:00:00.000Z', // rarely touched
        encoding_context: { project: proj, topics: [topic], task_type: 'implementing' },
      });
    }
  });
  return out;
}

/**
 * Approximate token count for a memory pool. Char/4 heuristic — matches
 * the budget estimator used in src/index-manager.js.
 */
function estimatePoolTokens(memories) {
  let chars = 0;
  for (const m of memories) {
    chars += (m.content || '').length + (m.body || '').length + (m.title || '').length;
    chars += (m.tags || []).join(',').length;
  }
  return Math.ceil(chars / 4);
}

const PRESETS = {
  small:  { n: 50  },
  medium: { n: 200 },
  large:  { n: 800 },
};

module.exports = {
  generateDistractors,
  generateHardNegatives,
  estimatePoolTokens,
  createRng,
  FAKE_PROJECTS,
  TOPIC_CLUSTERS,
  PRESETS,
};
