const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { rankMemories } = require('../src/scorer');
const { trustFactor, isLowTrust, ORIGIN_POLICY, DEFAULT_ORIGIN } = require('../src/provenance');
const { receiptFor } = require('../src/receipt');

const NOW = new Date().toISOString();

/** Minimal valid index entry; origin/tags/id overridable per test. */
function mem(id, overrides = {}) {
  return {
    id,
    title: `Memory ${id}`,
    path: `test/${id}.md`,
    type: 'learning',
    strength: 0.7,
    decay_rate: 0.99,
    last_accessed: NOW,
    ...overrides,
  };
}

/** Fully-connected association clique over the given ids. */
function clique(ids, weight = 0.9) {
  const edges = {};
  for (const a of ids) {
    edges[a] = {};
    for (const b of ids) {
      if (a !== b) edges[a][b] = { weight };
    }
  }
  return { version: 1, edges };
}

describe('provenance: trustFactor', () => {
  it('maps each origin to its policy trust_factor', () => {
    for (const [origin, policy] of Object.entries(ORIGIN_POLICY)) {
      assert.equal(trustFactor(origin), policy.trust_factor);
    }
  });

  it('user is fully trusted; tiers descend monotonically', () => {
    assert.equal(trustFactor('user'), 1.0);
    assert.ok(trustFactor('user') > trustFactor('agent-inferred'));
    assert.ok(trustFactor('agent-inferred') > trustFactor('tool-output'));
    assert.ok(trustFactor('tool-output') > trustFactor('external'));
  });

  it('missing or unknown origin weighs as the memorize default', () => {
    assert.equal(trustFactor(undefined), trustFactor(DEFAULT_ORIGIN));
    assert.equal(trustFactor('made-up'), trustFactor(DEFAULT_ORIGIN));
  });

  it('flags exactly tool-output and external as low-trust', () => {
    assert.equal(isLowTrust('tool-output'), true);
    assert.equal(isLowTrust('external'), true);
    assert.equal(isLowTrust('user'), false);
    assert.equal(isLowTrust('agent-inferred'), false);
    assert.equal(isLowTrust(undefined), false);
  });
});

describe('scorer: trust-weighted ranking', () => {
  it('at equal relevance, a user memory outranks an external one by the trust ratio', () => {
    const ranked = rankMemories(
      [mem('usr', { origin: 'user' }), mem('ext', { origin: 'external' })],
      () => 0.8
    );
    assert.equal(ranked[0].id, 'usr');
    // Same composite before trust, so the score ratio is exactly the factor ratio.
    assert.ok(Math.abs(ranked[1].score / ranked[0].score - 0.75) < 0.01);
  });

  it('an external memory cannot outrank a user memory on moderately higher relevance', () => {
    // Pre-trust-weighting these composites were ~0.86 (ext) vs ~0.74 (usr) —
    // the external memory won. Trust weighting must invert that.
    const rel = { usr: 0.7, ext: 0.9 };
    const ranked = rankMemories(
      [mem('usr', { origin: 'user' }), mem('ext', { origin: 'external' })],
      (m) => rel[m.id]
    );
    assert.equal(ranked[0].id, 'usr');
  });

  it('a decisively more relevant external memory still wins (trust bounds volume, not relevance)', () => {
    const rel = { usr: 0.3, ext: 1.0 };
    const ranked = rankMemories(
      [mem('usr', { origin: 'user' }), mem('ext', { origin: 'external' })],
      (m) => rel[m.id]
    );
    assert.equal(ranked[0].id, 'ext');
  });

  it('volume invariant: a planted external clique cannot outrank one user memory', () => {
    const extIds = ['e1', 'e2', 'e3', 'e4', 'e5'];
    const memories = [
      mem('usr', { origin: 'user' }),
      ...extIds.map((id) => mem(id, { origin: 'external', tags: ['planted'] })),
    ];
    const rel = (m) => (m.id === 'usr' ? 0.7 : 0.9);
    const ranked = rankMemories(memories, rel, { associations: clique(extIds) });
    assert.equal(ranked[0].id, 'usr');
  });

  it('activation-source damping: an external clique spreads less than a user clique', () => {
    // Identical topology, only origins differ; compare the bonus received by a
    // low-relevance target hanging off the clique.
    const run = (origin) => {
      const memories = [
        mem('a', { origin }),
        mem('b', { origin }),
        mem('target', { origin: 'agent-inferred' }),
      ];
      const associations = clique(['a', 'b']);
      associations.edges.a.target = { weight: 0.8 };
      associations.edges.target = { a: { weight: 0.8 } };
      const rel = (m) => (m.id === 'target' ? 0.1 : 0.9);
      const ranked = rankMemories(memories, rel, { associations });
      return ranked.find((m) => m.id === 'target').spreading_bonus;
    };
    const externalBonus = run('external');
    const userBonus = run('user');
    assert.ok(externalBonus > 0, 'external clique still spreads a nonzero bonus');
    assert.ok(externalBonus < userBonus, 'external sources must be damped relative to user sources');
  });

  it('backward compat: memories without origin keep their relative order and finite scores', () => {
    const rel = { a: 0.9, b: 0.6, c: 0.3 };
    const ranked = rankMemories([mem('a'), mem('b'), mem('c')], (m) => rel[m.id]);
    assert.deepEqual(ranked.map((m) => m.id), ['a', 'b', 'c']);
    for (const m of ranked) assert.ok(Number.isFinite(m.score));
  });
});

describe('receipt: low-trust marker', () => {
  const NOWD = new Date('2026-07-04T12:00:00Z');
  const nowFn = () => NOWD;
  const daysAgo = (d) => new Date(NOWD.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

  it('marks external and tool-output origins', () => {
    assert.equal(
      receiptFor({ title: 'Planted', type: 'learning', created: daysAgo(3), origin: 'external' }, nowFn),
      '◉ memory: "Planted" (learning, 3d ago, ⚠ external)'
    );
    assert.equal(
      receiptFor({ title: 'Tool fact', type: 'observation', created: daysAgo(1), origin: 'tool-output' }, nowFn),
      '◉ memory: "Tool fact" (observation, yesterday, ⚠ tool-output)'
    );
  });

  it('keeps the marker when the age segment is absent', () => {
    assert.equal(
      receiptFor({ title: 'Planted', type: 'learning', origin: 'external' }, nowFn),
      '◉ memory: "Planted" (learning, ⚠ external)'
    );
  });

  it('trusted and legacy receipts stay byte-identical to the base format', () => {
    for (const origin of ['user', 'agent-inferred', undefined]) {
      assert.equal(
        receiptFor({ title: 'Safe', type: 'decision', created: daysAgo(2), origin }, nowFn),
        '◉ memory: "Safe" (decision, 2d ago)'
      );
    }
  });

  it('adds the ⊘ unverified segment for quarantined memories', () => {
    assert.equal(
      receiptFor({ title: 'Planted', type: 'learning', created: daysAgo(3), origin: 'external', quarantined: true }, nowFn),
      '◉ memory: "Planted" (learning, 3d ago, ⚠ external, ⊘ unverified)'
    );
    // quarantined without a low-trust origin (e.g. lint-flagged agent-inferred)
    assert.equal(
      receiptFor({ title: 'Odd', type: 'learning', created: daysAgo(1), origin: 'agent-inferred', quarantined: true }, nowFn),
      '◉ memory: "Odd" (learning, yesterday, ⊘ unverified)'
    );
  });

  it('vetted memories drop the ⊘ segment but keep the origin marker', () => {
    assert.equal(
      receiptFor({ title: 'Checked', type: 'learning', created: daysAgo(3), origin: 'external', vetted: true }, nowFn),
      '◉ memory: "Checked" (learning, 3d ago, ⚠ external)'
    );
  });
});
