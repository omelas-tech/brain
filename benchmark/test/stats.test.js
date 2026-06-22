/**
 * Unit tests for the benchmark statistics module.
 * Covers location stats, bootstrap CIs, Mann–Whitney U, Cliff's delta,
 * and the Holm–Bonferroni correction.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  mean,
  median,
  bootstrapCI,
  mannWhitneyU,
  cliffsDelta,
  holmBonferroni,
} = require('../harness/stats');

// ─────────────────────────────────────────────────────────
// Location statistics
// ─────────────────────────────────────────────────────────

describe('mean', () => {
  it('computes the arithmetic mean', () => {
    assert.equal(mean([1, 2, 3, 4]), 2.5);
    assert.equal(mean([5]), 5);
    assert.equal(mean([2, 2, 2]), 2);
  });

  it('returns 0 for an empty array', () => {
    assert.equal(mean([]), 0);
  });

  it('does not mutate the input', () => {
    const input = [3, 1, 2];
    const copy = input.slice();
    mean(input);
    assert.deepEqual(input, copy);
  });
});

describe('median', () => {
  it('computes the median for odd-length arrays', () => {
    assert.equal(median([1, 2, 3]), 2);
    assert.equal(median([5]), 5);
    assert.equal(median([3, 1, 2]), 2); // unsorted input
  });

  it('averages the middle two for even-length arrays', () => {
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([10, 20]), 15);
  });

  it('returns 0 for an empty array', () => {
    assert.equal(median([]), 0);
  });

  it('does not mutate the input array', () => {
    const input = [3, 1, 4, 1, 5, 9, 2, 6];
    const copy = input.slice();
    median(input);
    assert.deepEqual(input, copy);
  });
});

// ─────────────────────────────────────────────────────────
// Bootstrap confidence interval
// ─────────────────────────────────────────────────────────

describe('bootstrapCI', () => {
  const sample = [10, 12, 11, 13, 9, 14, 10, 12, 11, 13];

  it('is deterministic — same samples + seed give identical output', () => {
    const a = bootstrapCI(sample, { seed: 42, iterations: 2000 });
    const b = bootstrapCI(sample, { seed: 42, iterations: 2000 });
    assert.deepEqual(a, b);
  });

  it('different seeds generally produce different intervals', () => {
    // Use the mean statistic on a varied sample: bootstrap means are continuous
    // and seed-sensitive, so the percentile bounds shift between seeds (unlike a
    // bootstrapped median over discrete data, which can coincide across seeds).
    const varied = [3, 17, 42, 8, 91, 23, 56, 11, 74, 38, 5, 64];
    const a = bootstrapCI(varied, { statistic: 'mean', seed: 42, iterations: 2000 });
    const b = bootstrapCI(varied, { statistic: 'mean', seed: 99, iterations: 2000 });
    assert.ok(a.lower !== b.lower || a.upper !== b.upper);
  });

  it('point equals the median of the input by default', () => {
    const result = bootstrapCI(sample, { seed: 7, iterations: 1000 });
    assert.equal(result.point, median(sample));
    assert.equal(result.n, sample.length);
  });

  it('point equals the mean when statistic is mean', () => {
    const result = bootstrapCI(sample, { statistic: 'mean', seed: 7, iterations: 1000 });
    assert.equal(result.point, mean(sample));
  });

  it('reports lower <= point <= upper', () => {
    const result = bootstrapCI(sample, { seed: 3, iterations: 3000 });
    assert.ok(result.lower <= result.point);
    assert.ok(result.point <= result.upper);
  });

  it('handles the empty-sample edge case', () => {
    const result = bootstrapCI([], { iterations: 500 });
    assert.deepEqual(result, { point: 0, lower: 0, upper: 0, n: 0, iterations: 500 });
  });

  it('handles the single-sample edge case', () => {
    const result = bootstrapCI([42], { iterations: 500 });
    assert.equal(result.point, 42);
    assert.equal(result.lower, 42);
    assert.equal(result.upper, 42);
    assert.equal(result.n, 1);
  });

  it('a tight cluster yields a narrower interval than a spread sample', () => {
    const tight = [100, 100, 101, 99, 100, 100, 101, 99, 100, 100];
    const spread = [10, 200, 50, 180, 5, 250, 90, 150, 30, 220];

    const tightCI = bootstrapCI(tight, { seed: 42, iterations: 3000 });
    const spreadCI = bootstrapCI(spread, { seed: 42, iterations: 3000 });

    const tightWidth = tightCI.upper - tightCI.lower;
    const spreadWidth = spreadCI.upper - spreadCI.lower;
    assert.ok(tightWidth < spreadWidth, `tight width ${tightWidth} should be < spread width ${spreadWidth}`);
  });
});

// ─────────────────────────────────────────────────────────
// Mann–Whitney U test
// ─────────────────────────────────────────────────────────

describe('mannWhitneyU', () => {
  it('gives a small p for two clearly-separated groups', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8];
    const b = [20, 21, 22, 23, 24, 25, 26, 27];
    const result = mannWhitneyU(a, b);
    assert.ok(result.p < 0.05, `expected p < 0.05, got ${result.p}`);
    assert.equal(result.nA, 8);
    assert.equal(result.nB, 8);
  });

  it('gives a large p for overlapping/identical groups', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8];
    const b = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = mannWhitneyU(a, b);
    assert.ok(result.p > 0.05, `expected p > 0.05, got ${result.p}`);
    // Identical distributions => U at the mean => z near 0, p near 1.
    assert.ok(result.p > 0.9, `expected p near 1, got ${result.p}`);
  });

  it('handles the empty-array edge case', () => {
    assert.deepEqual(mannWhitneyU([], [1, 2, 3]), { U: 0, p: 1, z: 0, nA: 0, nB: 3 });
    assert.deepEqual(mannWhitneyU([1, 2], []), { U: 0, p: 1, z: 0, nA: 2, nB: 0 });
  });

  it('computes U correctly on a known small example', () => {
    // a entirely below b: every a < every b.
    // ranks(a) = 1,2,3,4 => rankSumA = 10; U1 = 10 - 4*5/2 = 0; U = min(0, 16) = 0.
    const a = [1, 2, 3, 4];
    const b = [5, 6, 7, 8];
    const result = mannWhitneyU(a, b);
    assert.equal(result.U, 0);
    assert.equal(result.nA, 4);
    assert.equal(result.nB, 4);
  });

  it('computes U correctly on a partial-overlap example', () => {
    // a = [1,3,5], b = [2,4,6]. Pooled ranks: 1->1, 2->2, 3->3, 4->4, 5->5, 6->6.
    // rankSumA = 1+3+5 = 9; U1 = 9 - 3*4/2 = 9 - 6 = 3; U2 = 9 - 3 = 6; U = 3.
    const a = [1, 3, 5];
    const b = [2, 4, 6];
    const result = mannWhitneyU(a, b);
    assert.equal(result.U, 3);
  });
});

// ─────────────────────────────────────────────────────────
// Cliff's delta
// ─────────────────────────────────────────────────────────

describe('cliffsDelta', () => {
  it('fully-separated a > b gives delta = 1 (large)', () => {
    const a = [10, 11, 12, 13];
    const b = [1, 2, 3, 4];
    const result = cliffsDelta(a, b);
    assert.equal(result.delta, 1);
    assert.equal(result.magnitude, 'large');
  });

  it('fully-separated a < b gives delta = -1 (large)', () => {
    const a = [1, 2, 3, 4];
    const b = [10, 11, 12, 13];
    const result = cliffsDelta(a, b);
    assert.equal(result.delta, -1);
    assert.equal(result.magnitude, 'large');
  });

  it('identical samples give delta = 0 (negligible)', () => {
    const a = [1, 2, 3, 4];
    const b = [1, 2, 3, 4];
    const result = cliffsDelta(a, b);
    assert.equal(result.delta, 0);
    assert.equal(result.magnitude, 'negligible');
  });

  it('computes a known partial-overlap example', () => {
    // a = [1, 2, 3], b = [2, 3, 4]
    // greater (a>b): 1>{} =0, 2>2? no; 3>2 yes => 1; total greater = 1
    // less (a<b): 1<{2,3,4}=3, 2<{3,4}=2, 3<{4}=1 => less = 6
    // delta = (1 - 6) / 9 = -5/9 ≈ -0.5556 => |delta| >= 0.474 => 'large'
    const a = [1, 2, 3];
    const b = [2, 3, 4];
    const result = cliffsDelta(a, b);
    assert.ok(Math.abs(result.delta - (-5 / 9)) < 1e-9, `got ${result.delta}`);
    assert.equal(result.magnitude, 'large');
  });

  it('handles the empty-input edge case', () => {
    assert.deepEqual(cliffsDelta([], [1, 2]), { delta: 0, magnitude: 'negligible' });
    assert.deepEqual(cliffsDelta([1, 2], []), { delta: 0, magnitude: 'negligible' });
  });
});

// ─────────────────────────────────────────────────────────
// Holm–Bonferroni correction
// ─────────────────────────────────────────────────────────

describe('holmBonferroni', () => {
  it('produces the expected reject/adjusted pattern and preserves order', () => {
    // p = [0.01, 0.04, 0.03, 0.005], alpha = 0.05, m = 4.
    // Sorted: 0.005 (idx3), 0.01 (idx0), 0.03 (idx2), 0.04 (idx1).
    //  i=0: 0.005 <= 0.05/4 = 0.0125  -> reject; adj = min(1, 4*0.005) = 0.02
    //  i=1: 0.01  <= 0.05/3 ≈ 0.01667 -> reject; adj = min(1, 3*0.01)  = 0.03
    //  i=2: 0.03  <= 0.05/2 = 0.025   -> FAIL;   adj = min(1, 2*0.03)  = 0.06
    //  i=3: failed -> not reject;             adj = max(0.06, 1*0.04)  = 0.06
    const pvalues = [0.01, 0.04, 0.03, 0.005];
    const result = holmBonferroni(pvalues, 0.05);

    // Order preserved: one entry per input in input order.
    assert.equal(result.length, 4);
    assert.deepEqual(result.map((r) => r.index), [0, 1, 2, 3]);
    assert.deepEqual(result.map((r) => r.p), pvalues);

    // Reject pattern by original index.
    assert.equal(result[3].reject, true); // p=0.005
    assert.equal(result[0].reject, true); // p=0.01
    assert.equal(result[2].reject, false); // p=0.03
    assert.equal(result[1].reject, false); // p=0.04

    // Adjusted p-values (running max, capped at 1).
    assert.ok(Math.abs(result[3].adjusted - 0.02) < 1e-9, `idx3 adj ${result[3].adjusted}`);
    assert.ok(Math.abs(result[0].adjusted - 0.03) < 1e-9, `idx0 adj ${result[0].adjusted}`);
    assert.ok(Math.abs(result[2].adjusted - 0.06) < 1e-9, `idx2 adj ${result[2].adjusted}`);
    assert.ok(Math.abs(result[1].adjusted - 0.06) < 1e-9, `idx1 adj ${result[1].adjusted}`);
  });

  it('rejects all hypotheses when every p is tiny', () => {
    const result = holmBonferroni([0.001, 0.002, 0.0005], 0.05);
    assert.ok(result.every((r) => r.reject));
  });

  it('rejects none when every p is large', () => {
    const result = holmBonferroni([0.5, 0.6, 0.9], 0.05);
    assert.ok(result.every((r) => !r.reject));
  });

  it('returns an empty array for empty input', () => {
    assert.deepEqual(holmBonferroni([], 0.05), []);
  });

  it('adjusted p-values are monotone non-decreasing in sorted order', () => {
    const pvalues = [0.02, 0.005, 0.04, 0.01];
    const result = holmBonferroni(pvalues, 0.05);
    const sortedByP = result.slice().sort((a, b) => a.p - b.p);
    for (let i = 1; i < sortedByP.length; i++) {
      assert.ok(sortedByP[i].adjusted >= sortedByP[i - 1].adjusted);
    }
  });
});
