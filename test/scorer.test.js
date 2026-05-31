const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  computeDecayedStrength,
  computeRecencyBonus,
  computeRecallScore,
  computeSpreadingActivation,
  discoverViaActivation,
  computeContextMatch,
  computeSpacedBoost,
  reinforceStrength,
  improveDecayRate,
  computeConsolidatedStrength,
  rankMemories,
} = require('../src/scorer');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO string for N days ago. */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

/** Round to fixed decimals for comparison. */
function round(v, decimals = 6) {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

// ===========================================================================
// computeDecayedStrength
// ===========================================================================
describe('computeDecayedStrength', () => {
  it('returns baseStrength when lastAccessed is now (0 days elapsed)', () => {
    const now = new Date().toISOString();
    const result = computeDecayedStrength(0.8, 0.995, now);
    assert.ok(Math.abs(result - 0.8) < 0.001);
  });

  it('decays correctly over 10 days at rate 0.995', () => {
    const expected = 0.8 * Math.pow(0.995, 10);
    const result = computeDecayedStrength(0.8, 0.995, daysAgo(10));
    assert.ok(Math.abs(result - expected) < 0.001);
  });

  it('returns near 0 for very old memories (1000 days)', () => {
    const result = computeDecayedStrength(1.0, 0.995, daysAgo(1000));
    assert.ok(result < 0.01);
  });

  it('handles Date objects as input', () => {
    const date = new Date();
    date.setDate(date.getDate() - 5);
    const expected = 0.9 * Math.pow(0.99, 5);
    const result = computeDecayedStrength(0.9, 0.99, date);
    assert.ok(Math.abs(result - expected) < 0.001);
  });

  it('handles ISO string inputs', () => {
    const result = computeDecayedStrength(1.0, 0.995, daysAgo(0));
    assert.ok(Math.abs(result - 1.0) < 0.001);
  });
});

// ===========================================================================
// computeRecencyBonus
// ===========================================================================
describe('computeRecencyBonus', () => {
  it('returns ~1.0 for just-accessed memories', () => {
    const result = computeRecencyBonus(new Date().toISOString());
    assert.ok(Math.abs(result - 1.0) < 0.01);
  });

  it('returns ~0.5 for 6-month-old memories (~182 days)', () => {
    const result = computeRecencyBonus(daysAgo(182));
    assert.ok(Math.abs(result - 0.5) < 0.02);
  });

  it('returns 0 for memories older than 365 days', () => {
    const result = computeRecencyBonus(daysAgo(400));
    assert.equal(result, 0);
  });

  it('never goes below 0', () => {
    const result = computeRecencyBonus(daysAgo(9999));
    assert.ok(result >= 0);
  });
});

// ===========================================================================
// computeRecallScore
// ===========================================================================
describe('computeRecallScore', () => {
  it('base 3-param call renormalizes weights to sum to 1.0', () => {
    // With only 3 base params, weights 0.38 + 0.18 + 0.08 = 0.64
    // Each is divided by 0.64
    const score = computeRecallScore(1.0, 1.0, 1.0);
    assert.ok(Math.abs(score - 1.0) < 0.001);
  });

  it('full 6-param call uses exact v4 weights', () => {
    // All ones: sum of all weights / total = 1.0
    const score = computeRecallScore(1.0, 1.0, 1.0, {
      spreadingBonus: 1.0,
      contextMatch: 1.0,
      salience: 1.0,
    });
    assert.ok(Math.abs(score - 1.0) < 0.001);
  });

  it('partial extras renormalizes across 4 terms', () => {
    // relevance=0.38, decayed=0.18, recency=0.08, spreading=0.14 → total 0.78
    const score = computeRecallScore(1.0, 1.0, 1.0, { spreadingBonus: 1.0 });
    assert.ok(Math.abs(score - 1.0) < 0.001);
  });

  it('all-zero inputs return 0', () => {
    const score = computeRecallScore(0, 0, 0, {
      spreadingBonus: 0,
      contextMatch: 0,
      salience: 0,
    });
    assert.equal(score, 0);
  });

  it('all-one inputs return 1.0', () => {
    const score = computeRecallScore(1, 1, 1, {
      spreadingBonus: 1,
      contextMatch: 1,
      salience: 1,
    });
    assert.ok(Math.abs(score - 1.0) < 0.001);
  });

  it('score is always in [0, 1] range', () => {
    const score = computeRecallScore(0.5, 0.3, 0.7, {
      spreadingBonus: 0.2,
      contextMatch: 0.9,
      salience: 0.1,
    });
    assert.ok(score >= 0 && score <= 1);
  });

  it('correctly weights relevance higher than other factors', () => {
    // High relevance, low others
    const scoreA = computeRecallScore(1.0, 0.0, 0.0);
    // Low relevance, high others
    const scoreB = computeRecallScore(0.0, 1.0, 1.0);
    assert.ok(scoreA > scoreB);
  });
});

// ===========================================================================
// computeSpreadingActivation
// ===========================================================================
describe('computeSpreadingActivation', () => {
  it('returns 0 with null associations', () => {
    assert.equal(computeSpreadingActivation('m1', [{ id: 'm2', score: 0.8 }], null), 0);
  });

  it('returns 0 with empty associations', () => {
    assert.equal(computeSpreadingActivation('m1', [{ id: 'm2', score: 0.8 }], {}), 0);
  });

  it('returns 0 when memoryId is the source itself', () => {
    const assoc = { edges: { m1: { m2: { weight: 0.5 } } } };
    const result = computeSpreadingActivation('m1', [{ id: 'm1', score: 0.9 }], assoc);
    assert.equal(result, 0);
  });

  it('computes 1-hop bonus correctly: source_score * weight * 0.5', () => {
    const assoc = { edges: { m1: { m2: { weight: 0.4 } } } };
    const scored = [{ id: 'm1', score: 0.8 }];
    const result = computeSpreadingActivation('m2', scored, assoc);
    const expected = 0.8 * 0.4 * 0.5;
    assert.ok(Math.abs(result - expected) < 0.001);
  });

  it('computes 2-hop bonus correctly', () => {
    const assoc = {
      edges: {
        m1: { m2: { weight: 0.5 } },
        m2: { m3: { weight: 0.6 } },
      },
    };
    const scored = [{ id: 'm1', score: 0.8 }];
    // hop1: m1->m2: 0.8 * 0.5 * 0.5 = 0.2
    // hop2: m2->m3: 0.2 * 0.6 * 0.5^2 = 0.2 * 0.6 * 0.25 = 0.03
    const result = computeSpreadingActivation('m3', scored, assoc);
    const expected = 0.2 * 0.6 * 0.25;
    assert.ok(Math.abs(result - expected) < 0.001);
  });

  it('ignores sources scoring <= 0.3', () => {
    const assoc = { edges: { m1: { m2: { weight: 0.9 } } } };
    const scored = [{ id: 'm1', score: 0.3 }];
    const result = computeSpreadingActivation('m2', scored, assoc);
    assert.equal(result, 0);
  });

  it('takes maximum bonus across multiple paths', () => {
    const assoc = {
      edges: {
        m1: { m3: { weight: 0.2 } },
        m2: { m3: { weight: 0.8 } },
      },
    };
    const scored = [
      { id: 'm1', score: 0.9 },
      { id: 'm2', score: 0.9 },
    ];
    const bonusViaM1 = 0.9 * 0.2 * 0.5;
    const bonusViaM2 = 0.9 * 0.8 * 0.5;
    const result = computeSpreadingActivation('m3', scored, assoc);
    assert.ok(Math.abs(result - Math.max(bonusViaM1, bonusViaM2)) < 0.001);
  });

  it('caps bonus at 1.0', () => {
    const assoc = { edges: { m1: { m2: { weight: 1.0 } } } };
    const scored = [{ id: 'm1', score: 5.0 }]; // artificially high
    const result = computeSpreadingActivation('m2', scored, assoc);
    assert.ok(result <= 1.0);
  });

  it('respects maxDepth parameter', () => {
    const assoc = {
      edges: {
        m1: { m2: { weight: 0.8 } },
        m2: { m3: { weight: 0.8 } },
      },
    };
    const scored = [{ id: 'm1', score: 0.9 }];
    // maxDepth=1: can only reach m2, not m3
    const result = computeSpreadingActivation('m3', scored, assoc, 1);
    assert.equal(result, 0);
  });
});

// ===========================================================================
// discoverViaActivation
// ===========================================================================
describe('discoverViaActivation', () => {
  it('returns [] with null associations', () => {
    const result = discoverViaActivation([{ id: 'm1', score: 0.8 }], null);
    assert.deepEqual(result, []);
  });

  it('discovers neighbors not in scored set', () => {
    const assoc = { edges: { m1: { m2: { weight: 0.5 } } } };
    const scored = [{ id: 'm1', score: 0.8 }];
    const result = discoverViaActivation(scored, assoc);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'm2');
  });

  it('does NOT include already-scored memories', () => {
    const assoc = { edges: { m1: { m2: { weight: 0.5 } } } };
    const scored = [
      { id: 'm1', score: 0.8 },
      { id: 'm2', score: 0.6 },
    ];
    const result = discoverViaActivation(scored, assoc);
    assert.equal(result.length, 0);
  });

  it('filters by minBonus threshold', () => {
    const assoc = { edges: { m1: { m2: { weight: 0.01 } } } };
    const scored = [{ id: 'm1', score: 0.5 }];
    // bonus = 0.5 * 0.01 * 0.5 = 0.0025 < default 0.05
    const result = discoverViaActivation(scored, assoc);
    assert.equal(result.length, 0);
  });

  it('takes max bonus for memories reachable via multiple paths', () => {
    const assoc = {
      edges: {
        m1: { m3: { weight: 0.2 } },
        m2: { m3: { weight: 0.9 } },
      },
    };
    const scored = [
      { id: 'm1', score: 0.8 },
      { id: 'm2', score: 0.8 },
    ];
    const result = discoverViaActivation(scored, assoc);
    const m3 = result.find((c) => c.id === 'm3');
    assert.ok(m3);
    // max(0.8*0.2*0.5, 0.8*0.9*0.5) = max(0.08, 0.36) = 0.36
    assert.ok(Math.abs(m3.spreadingBonus - 0.36) < 0.001);
  });
});

// ===========================================================================
// computeContextMatch
// ===========================================================================
describe('computeContextMatch', () => {
  it('returns 0 for null encoding context', () => {
    assert.equal(computeContextMatch(null, { project: 'x' }), 0);
  });

  it('returns 0 for null recall context', () => {
    assert.equal(computeContextMatch({ project: 'x' }, null), 0);
  });

  it('returns 1.0 for identical contexts', () => {
    const ctx = { project: 'brain', topics: ['memory', 'scoring'], task_type: 'feature' };
    const result = computeContextMatch(ctx, ctx);
    assert.ok(Math.abs(result - 1.0) < 0.001);
  });

  it('project match contributes 0.3', () => {
    const enc = { project: 'brain' };
    const rec = { project: 'brain' };
    const result = computeContextMatch(enc, rec);
    assert.ok(Math.abs(result - 0.3) < 0.001);
  });

  it('topic Jaccard computes correctly', () => {
    const enc = { topics: ['a', 'b', 'c'] };
    const rec = { topics: ['b', 'c', 'd'] };
    // intersection=2, union=4 → jaccard=0.5 → 0.4*0.5 = 0.2
    const result = computeContextMatch(enc, rec);
    assert.ok(Math.abs(result - 0.2) < 0.001);
  });

  it('task type match contributes 0.3', () => {
    const enc = { task_type: 'bugfix' };
    const rec = { task_type: 'bugfix' };
    const result = computeContextMatch(enc, rec);
    assert.ok(Math.abs(result - 0.3) < 0.001);
  });

  it('partial overlap returns correct proportional score', () => {
    const enc = { project: 'brain', topics: ['a', 'b'], task_type: 'feature' };
    const rec = { project: 'brain', topics: ['b', 'c'], task_type: 'bugfix' };
    // project=0.3, jaccard(1/3)=0.4*(1/3)=0.133, task=0
    const expected = 0.3 + 0.4 * (1 / 3);
    const result = computeContextMatch(enc, rec);
    assert.ok(Math.abs(result - expected) < 0.001);
  });

  it('empty topics arrays yield Jaccard 0', () => {
    const enc = { topics: [] };
    const rec = { topics: [] };
    const result = computeContextMatch(enc, rec);
    assert.equal(result, 0);
  });
});

// ===========================================================================
// computeSpacedBoost
// ===========================================================================
describe('computeSpacedBoost', () => {
  it('1 day, 0 recalls returns ~0.05', () => {
    const result = computeSpacedBoost(1, 0);
    // spacing = min(3, 1+log2(2)) = min(3, 2) = 2
    // diminishing = 1/(1+0) = 1
    // boost = 0.05*2*1 = 0.10
    assert.ok(Math.abs(result - 0.10) < 0.001);
  });

  it('7 days returns spacing multiplier boost', () => {
    const result = computeSpacedBoost(7, 0);
    const spacing = Math.min(3.0, 1.0 + Math.log2(8));
    assert.ok(Math.abs(result - 0.05 * spacing) < 0.001);
  });

  it('30 days yields higher boost', () => {
    const result = computeSpacedBoost(30, 0);
    const spacing = Math.min(3.0, 1.0 + Math.log2(31));
    assert.ok(Math.abs(result - 0.05 * spacing) < 0.001);
  });

  it('same day, 20 recalls shows diminishing returns', () => {
    const result = computeSpacedBoost(0, 20);
    // spacing = min(3, 1+log2(1)) = 1
    // diminishing = 1/(1+2) = 1/3
    // boost = 0.05*1*(1/3) ≈ 0.0167
    const expected = 0.05 * 1.0 * (1.0 / 3.0);
    assert.ok(Math.abs(result - expected) < 0.001);
  });

  it('spacing multiplier is capped at 3.0', () => {
    // For very large daysSinceLastAccess, the multiplier caps at 3
    const result = computeSpacedBoost(10000, 0);
    assert.ok(Math.abs(result - 0.05 * 3.0) < 0.001);
  });
});

// ===========================================================================
// reinforceStrength
// ===========================================================================
describe('reinforceStrength', () => {
  it('backward compat: no spacing args yields flat +0.05', () => {
    assert.ok(Math.abs(reinforceStrength(0.5) - 0.55) < 0.001);
  });

  it('backward compat: explicit null spacing args yields flat +0.05', () => {
    assert.ok(Math.abs(reinforceStrength(0.5, null, null) - 0.55) < 0.001);
  });

  it('with spacing args uses computeSpacedBoost', () => {
    const boost = computeSpacedBoost(7, 2);
    const result = reinforceStrength(0.5, 7, 2);
    assert.ok(Math.abs(result - (0.5 + boost)) < 0.001);
  });

  it('caps at 1.0', () => {
    assert.equal(reinforceStrength(0.98), 1.0);
  });

  it('strength 0.98 + boost does not exceed 1.0', () => {
    const result = reinforceStrength(0.98, 30, 0);
    assert.ok(result <= 1.0);
  });
});

// ===========================================================================
// improveDecayRate
// ===========================================================================
describe('improveDecayRate', () => {
  it('0.990 improves to ~0.9909', () => {
    const result = improveDecayRate(0.990);
    const expected = 0.990 + 0.10 * (0.999 - 0.990);
    assert.ok(Math.abs(result - expected) < 0.0001);
  });

  it('0.950 improves to ~0.9549', () => {
    const result = improveDecayRate(0.950);
    const expected = 0.950 + 0.10 * (0.999 - 0.950);
    assert.ok(Math.abs(result - expected) < 0.0001);
  });

  it('approaches 0.999 asymptotically', () => {
    let rate = 0.99;
    for (let i = 0; i < 100; i++) rate = improveDecayRate(rate);
    assert.ok(rate < 0.999);
    assert.ok(rate > 0.998);
  });

  it('already at 0.999 stays at 0.999', () => {
    assert.ok(Math.abs(improveDecayRate(0.999) - 0.999) < 0.0001);
  });
});

// ===========================================================================
// computeConsolidatedStrength
// ===========================================================================
describe('computeConsolidatedStrength', () => {
  it('returns max + 0.15', () => {
    const result = computeConsolidatedStrength([0.3, 0.5, 0.4]);
    assert.ok(Math.abs(result - 0.65) < 0.001);
  });

  it('caps at 1.0', () => {
    assert.equal(computeConsolidatedStrength([0.9, 0.95]), 1.0);
  });

  it('works with single-element array', () => {
    const result = computeConsolidatedStrength([0.6]);
    assert.ok(Math.abs(result - 0.75) < 0.001);
  });

  it('works with multiple elements', () => {
    const result = computeConsolidatedStrength([0.2, 0.3, 0.25]);
    assert.ok(Math.abs(result - 0.45) < 0.001);
  });
});

// ===========================================================================
// rankMemories
// ===========================================================================
describe('rankMemories', () => {
  /** Build a minimal memory entry. */
  function mem(id, strength, daysOld, extra = {}) {
    return {
      id,
      strength,
      decay_rate: 0.995,
      last_accessed: daysAgo(daysOld),
      ...extra,
    };
  }

  it('sorts descending by score', () => {
    const memories = [mem('a', 0.5, 30), mem('b', 0.9, 1), mem('c', 0.7, 10)];
    const result = rankMemories(memories, () => 0.5);
    assert.ok(result[0].score >= result[1].score);
    assert.ok(result[1].score >= result[2].score);
  });

  it('rounds all numeric fields to 3 decimal places', () => {
    const memories = [mem('a', 0.777777, 3)];
    const result = rankMemories(memories, () => 0.333333);
    assert.equal(result[0].relevance, 0.333);
    // decayed_strength and recency_bonus should also be rounded
    const decStr = result[0].decayed_strength.toString();
    const parts = decStr.split('.');
    if (parts[1]) assert.ok(parts[1].length <= 3);
  });

  it('without options uses base 3-factor scoring', () => {
    const memories = [mem('a', 0.8, 5)];
    const result = rankMemories(memories, () => 0.9);
    assert.equal(result[0].spreading_bonus, 0);
    assert.equal(result[0].context_match, 0);
  });

  it('with associations computes spreading_bonus', () => {
    const memories = [mem('a', 0.9, 1), mem('b', 0.5, 5)];
    const assoc = {
      edges: {
        a: { b: { weight: 0.8 } },
        b: { a: { weight: 0.8 } },
      },
    };
    const result = rankMemories(memories, () => 0.8, { associations: assoc });
    // At least one memory should have a nonzero spreading bonus
    const hasBonus = result.some((m) => m.spreading_bonus > 0);
    assert.ok(hasBonus);
  });

  it('with recallContext computes context_match', () => {
    const ctx = { project: 'brain', topics: ['memory'], task_type: 'feature' };
    const memories = [mem('a', 0.8, 5, { encoding_context: ctx })];
    const result = rankMemories(memories, () => 0.8, { recallContext: ctx });
    assert.ok(result[0].context_match > 0);
  });

  it('with salience field includes it in score', () => {
    const memories = [
      mem('a', 0.8, 5, { salience: 0.9 }),
      mem('b', 0.8, 5, { salience: 0.0 }),
    ];
    const result = rankMemories(memories, () => 0.8);
    // Memory with higher salience should score higher
    const memA = result.find((m) => m.id === 'a');
    const memB = result.find((m) => m.id === 'b');
    assert.ok(memA.score >= memB.score);
  });

  it('empty input array returns empty output', () => {
    const result = rankMemories([], () => 0.5);
    assert.deepEqual(result, []);
  });
});

// ===========================================================================
// Edge cases & boundary conditions
// ===========================================================================
describe('computeDecayedStrength — decay exemption', () => {
  it('returns the base strength untouched when exempt (pinned/stable)', () => {
    // 400 days old would normally decay heavily; exempt short-circuits all of it.
    assert.equal(computeDecayedStrength(0.8, 0.99, daysAgo(400), true), 0.8);
  });
});

describe('computeRecencyBonus — boundaries', () => {
  it('is exactly 0 at the 365-day horizon', () => {
    assert.ok(Math.abs(computeRecencyBonus(daysAgo(365))) < 1e-6);
  });
  it('clamps to 1.0 for a future timestamp (never exceeds 1)', () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    assert.equal(computeRecencyBonus(tomorrow), 1.0);
  });
});

describe('computeConsolidatedStrength — domain edges', () => {
  it('returns 0 for an empty source list (no -Infinity leak)', () => {
    assert.equal(computeConsolidatedStrength([]), 0);
    assert.equal(computeConsolidatedStrength(undefined), 0);
  });
  it('adds the consolidation bonus and caps at 1.0', () => {
    assert.ok(Math.abs(computeConsolidatedStrength([0.0]) - 0.15) < 1e-9);
    assert.equal(computeConsolidatedStrength([0.9, 0.5]), 1.0); // 0.9 + 0.15 capped
  });
});

describe('computeRecallScore — renormalization & zero values', () => {
  it('uses only the three base terms when no extras are supplied', () => {
    // weights 0.38/0.18/0.08 renormalize over their sum; all-1 inputs → exactly 1.
    assert.ok(Math.abs(computeRecallScore(1, 1, 1) - 1) < 1e-9);
  });
  it('includes an extra that is exactly 0 (0 != null), shifting the normalization', () => {
    const withZeroSalience = computeRecallScore(1, 1, 1, { salience: 0 });
    const withoutSalience = computeRecallScore(1, 1, 1);
    // Adding salience:0 with weight 0.08 drags the renormalized score below 1.
    assert.ok(withZeroSalience < withoutSalience);
    assert.ok(Math.abs(withZeroSalience - (0.38 + 0.18 + 0.08) / (0.38 + 0.18 + 0.08 + 0.08)) < 1e-9);
  });
});

describe('computeSpacedBoost / reinforceStrength', () => {
  it('caps the spacing multiplier at 3.0 for very long intervals', () => {
    // spacingMultiplier maxes at 3.0; recallCount 0 → boost = 0.05 * 3 = 0.15.
    assert.ok(Math.abs(computeSpacedBoost(100000, 0) - 0.15) < 1e-9);
  });
  it('falls back to a flat +0.05 when spacing info is missing', () => {
    assert.ok(Math.abs(reinforceStrength(0.5, 7) - 0.55) < 1e-9);   // recallCount undefined
    assert.ok(Math.abs(reinforceStrength(0.5) - 0.55) < 1e-9);      // both missing
  });
  it('never lets reinforced strength exceed 1.0', () => {
    assert.equal(reinforceStrength(1.0, 30, 0), 1.0);
  });
});

describe('computeContextMatch — composition', () => {
  it('scores a full project+topics+task match as 1.0', () => {
    const ctx = { project: 'p', topics: ['a', 'b'], task_type: 't' };
    assert.ok(Math.abs(computeContextMatch(ctx, ctx) - 1.0) < 1e-9);
  });
  it('weights a topics-only Jaccard match correctly', () => {
    const enc = { topics: ['a', 'b'] };
    const rec = { topics: ['b', 'c'] };
    // jaccard = 1/3, weighted 0.4 → 0.1333…
    assert.ok(Math.abs(computeContextMatch(enc, rec) - 0.4 / 3) < 1e-9);
  });
  it('returns 0 when either context is missing', () => {
    assert.equal(computeContextMatch(null, {}), 0);
    assert.equal(computeContextMatch({}, null), 0);
  });
});
