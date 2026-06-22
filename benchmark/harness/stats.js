/**
 * Statistics module for benchmark analysis.
 *
 * Self-contained, dependency-free, and deterministic. Provides the
 * inferential machinery needed to decide whether the with-brain vs
 * without-brain difference observed in a benchmark is real or noise.
 *
 * Methods implemented (with the standard references they follow):
 *
 *  - mean / median               — basic location statistics.
 *  - bootstrapCI                 — non-parametric confidence interval via the
 *                                  percentile bootstrap (Efron & Tibshirani,
 *                                  "An Introduction to the Bootstrap", 1993).
 *                                  Resample with replacement, recompute the
 *                                  statistic, and read off percentile bounds.
 *  - mannWhitneyU                — Mann–Whitney U / Wilcoxon rank-sum test with
 *                                  the normal approximation, tie correction, and
 *                                  a 0.5 continuity correction. A non-parametric
 *                                  alternative to the t-test for comparing two
 *                                  independent samples.
 *  - cliffsDelta                 — Cliff's delta effect size (Cliff, 1993): the
 *                                  probability that a random a exceeds a random b
 *                                  minus the reverse, mapped to a magnitude label
 *                                  using Romano et al. (2006) thresholds.
 *  - holmBonferroni              — Holm (1979) step-down correction for multiple
 *                                  comparisons, controlling family-wise error.
 *
 * Randomness is supplied by an inline seeded xorshift32 PRNG (Marsaglia, 2003)
 * so results are fully reproducible: same samples + same seed => identical
 * output. Math.random is never used. The normal CDF used for p-values relies on
 * the Abramowitz & Stegun 7.1.26 erf approximation, implemented inline.
 */

// ─────────────────────────────────────────────────────────
// Seeded PRNG (xorshift32) — deterministic, no Math.random
// ─────────────────────────────────────────────────────────

/**
 * Create a deterministic xorshift32 PRNG returning floats in [0, 1).
 *
 * @param {number} seed - Integer seed (0 is remapped to a non-zero state).
 * @returns {() => number} A function yielding the next pseudo-random float.
 */
function createRng(seed) {
  let s = seed | 0 || 1;
  return function next() {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

// ─────────────────────────────────────────────────────────
// Location statistics
// ─────────────────────────────────────────────────────────

/**
 * Arithmetic mean of an array.
 *
 * @param {number[]} arr - Input values.
 * @returns {number} The mean, or 0 for an empty array.
 */
function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

/**
 * Median of an array (average of the middle two for even length).
 * Does not mutate the input — the array is copied before sorting.
 *
 * @param {number[]} arr - Input values.
 * @returns {number} The median, or 0 for an empty array.
 */
function median(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

// ─────────────────────────────────────────────────────────
// Bootstrap confidence interval (percentile method)
// ─────────────────────────────────────────────────────────

/**
 * Compute a percentile-bootstrap confidence interval for a statistic.
 *
 * Resamples `samples` with replacement `iterations` times; for each resample
 * the chosen statistic (median or mean) is computed, building an empirical
 * bootstrap distribution. The reported interval is the central-`confidence`
 * percentile range of that distribution (e.g. confidence 0.90 => 5th and 95th
 * percentiles). `point` is the statistic of the original (un-resampled) sample.
 *
 * Deterministic: driven by a seeded xorshift32 PRNG, so identical samples and
 * seed always produce identical output.
 *
 * @param {number[]} samples - Observed values.
 * @param {Object} [opts]
 * @param {number} [opts.iterations=10000] - Number of bootstrap resamples.
 * @param {number} [opts.confidence=0.90] - Central confidence level (0..1).
 * @param {('median'|'mean')} [opts.statistic='median'] - Statistic to bootstrap.
 * @param {number} [opts.seed=42] - PRNG seed for reproducibility.
 * @returns {{point: number, lower: number, upper: number, n: number, iterations: number}}
 */
function bootstrapCI(samples, opts = {}) {
  const iterations = opts.iterations != null ? opts.iterations : 10000;
  const confidence = opts.confidence != null ? opts.confidence : 0.90;
  const statistic = opts.statistic || 'median';
  const seed = opts.seed != null ? opts.seed : 42;

  const n = samples ? samples.length : 0;
  const statFn = statistic === 'mean' ? mean : median;

  // Edge cases.
  if (n === 0) {
    return { point: 0, lower: 0, upper: 0, n: 0, iterations };
  }
  const point = statFn(samples);
  if (n === 1) {
    return { point, lower: point, upper: point, n, iterations };
  }

  const rng = createRng(seed);
  const stats = new Array(iterations);
  const resample = new Array(n);

  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      // Floor of rng()*n yields an index in [0, n-1] with replacement.
      const idx = Math.floor(rng() * n);
      resample[i] = samples[idx];
    }
    stats[it] = statFn(resample);
  }

  stats.sort((a, b) => a - b);

  const alpha = 1 - confidence;
  const lower = percentile(stats, alpha / 2);
  const upper = percentile(stats, 1 - alpha / 2);

  return { point, lower, upper, n, iterations };
}

/**
 * Linear-interpolated percentile of a pre-sorted ascending array.
 *
 * @param {number[]} sorted - Values sorted ascending.
 * @param {number} q - Quantile in [0, 1].
 * @returns {number}
 */
function percentile(sorted, q) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

// ─────────────────────────────────────────────────────────
// Normal CDF (Abramowitz & Stegun 7.1.26 erf approximation)
// ─────────────────────────────────────────────────────────

/**
 * Error function approximation (Abramowitz & Stegun 7.1.26).
 * Maximum absolute error ~1.5e-7.
 *
 * @param {number} x
 * @returns {number}
 */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

/**
 * Standard normal cumulative distribution function.
 *
 * @param {number} z
 * @returns {number} P(Z <= z) for Z ~ N(0, 1).
 */
function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// ─────────────────────────────────────────────────────────
// Mann–Whitney U test (rank-sum, normal approximation)
// ─────────────────────────────────────────────────────────

/**
 * Two-sided Mann–Whitney U test (a.k.a. Wilcoxon rank-sum) using the normal
 * approximation with tie correction and a 0.5 continuity correction.
 *
 * The reported `U` is the smaller of U1 (computed from sample A's rank sum) and
 * U2 = nA*nB - U1. The `z` score and `p` are derived from U1 against its
 * tie-corrected standard deviation: a tie correction term shrinks the variance,
 * and a 0.5 continuity correction is applied to the |U1 - meanU| gap before
 * standardizing. `p` is the two-sided tail probability from the standard normal.
 *
 * @param {number[]} a - First sample.
 * @param {number[]} b - Second sample.
 * @returns {{U: number, p: number, z: number, nA: number, nB: number}}
 */
function mannWhitneyU(a, b) {
  const nA = a ? a.length : 0;
  const nB = b ? b.length : 0;

  if (nA === 0 || nB === 0) {
    return { U: 0, p: 1, z: 0, nA, nB };
  }

  // Pool, tag by group, and assign average ranks (ties share their mean rank).
  const pooled = [];
  for (let i = 0; i < nA; i++) pooled.push({ value: a[i], group: 0 });
  for (let i = 0; i < nB; i++) pooled.push({ value: b[i], group: 1 });
  pooled.sort((x, y) => x.value - y.value);

  const N = nA + nB;
  const ranks = new Array(N);
  const tieGroupSizes = [];
  let i = 0;
  while (i < N) {
    let j = i;
    while (j + 1 < N && pooled[j + 1].value === pooled[i].value) j++;
    // Items i..j are tied; share the average of ranks (i+1)..(j+1).
    const avgRank = (i + 1 + j + 1) / 2;
    const groupSize = j - i + 1;
    if (groupSize > 1) tieGroupSizes.push(groupSize);
    for (let k = i; k <= j; k++) ranks[k] = avgRank;
    i = j + 1;
  }

  // Rank sum for group A.
  let rankSumA = 0;
  for (let k = 0; k < N; k++) {
    if (pooled[k].group === 0) rankSumA += ranks[k];
  }

  const U1 = rankSumA - (nA * (nA + 1)) / 2;
  const U2 = nA * nB - U1;
  const U = Math.min(U1, U2);

  const meanU = (nA * nB) / 2;

  // Tie-corrected standard deviation.
  // sigma^2 = (nA*nB/12) * [ (N+1) - sum(t^3 - t) / (N*(N-1)) ]
  let tieSum = 0;
  for (const t of tieGroupSizes) tieSum += t * t * t - t;
  const variance = (nA * nB / 12) * ((N + 1) - tieSum / (N * (N - 1)));

  let z = 0;
  let p = 1;
  if (variance > 0) {
    // Continuity correction: shrink the absolute gap by 0.5 toward the mean.
    const diff = Math.abs(U1 - meanU);
    const corrected = Math.max(0, diff - 0.5);
    z = (U1 - meanU >= 0 ? corrected : -corrected) / Math.sqrt(variance);
    // Two-sided p-value.
    p = 2 * (1 - normalCdf(Math.abs(z)));
    if (p > 1) p = 1;
    if (p < 0) p = 0;
  }

  return { U, p, z, nA, nB };
}

// ─────────────────────────────────────────────────────────
// Cliff's delta effect size
// ─────────────────────────────────────────────────────────

/**
 * Cliff's delta effect size for two independent samples.
 *
 * delta = ( #(a_i > b_j) - #(a_i < b_j) ) / (nA * nB), bounded in [-1, 1].
 * A positive delta means values in `a` tend to exceed values in `b`. The
 * magnitude label follows Romano et al. (2006): |delta| < 0.147 negligible,
 * < 0.33 small, < 0.474 medium, otherwise large.
 *
 * @param {number[]} a - First sample.
 * @param {number[]} b - Second sample.
 * @returns {{delta: number, magnitude: ('negligible'|'small'|'medium'|'large')}}
 */
function cliffsDelta(a, b) {
  const nA = a ? a.length : 0;
  const nB = b ? b.length : 0;

  if (nA === 0 || nB === 0) {
    return { delta: 0, magnitude: 'negligible' };
  }

  let greater = 0;
  let less = 0;
  for (let i = 0; i < nA; i++) {
    for (let j = 0; j < nB; j++) {
      if (a[i] > b[j]) greater++;
      else if (a[i] < b[j]) less++;
    }
  }

  const delta = (greater - less) / (nA * nB);
  const mag = Math.abs(delta);

  let magnitude;
  if (mag < 0.147) magnitude = 'negligible';
  else if (mag < 0.33) magnitude = 'small';
  else if (mag < 0.474) magnitude = 'medium';
  else magnitude = 'large';

  return { delta, magnitude };
}

// ─────────────────────────────────────────────────────────
// Holm–Bonferroni multiple-comparison correction
// ─────────────────────────────────────────────────────────

/**
 * Holm–Bonferroni step-down correction for multiple hypothesis tests.
 *
 * Sorts the m p-values ascending; the i-th smallest (0-based) is compared to
 * alpha / (m - i). Hypotheses are rejected in order until the first failure,
 * after which all remaining hypotheses are not rejected (step-down). The
 * `adjusted` p-value is the standard Holm adjustment: the running maximum of
 * (m - i) * p over the sorted order, capped at 1. The returned array preserves
 * the original input order.
 *
 * @param {number[]} pvalues - Raw p-values, one per hypothesis.
 * @param {number} [alpha=0.05] - Family-wise significance level.
 * @returns {Array<{index: number, p: number, adjusted: number, reject: boolean}>}
 */
function holmBonferroni(pvalues, alpha = 0.05) {
  const m = pvalues ? pvalues.length : 0;
  if (m === 0) return [];

  // Sort indices by ascending p-value (stable on original index for ties).
  const order = pvalues
    .map((p, index) => ({ index, p }))
    .sort((x, y) => x.p - y.p || x.index - y.index);

  const results = new Array(m);
  let failed = false; // once a comparison fails, all subsequent are not rejected
  let runningAdjusted = 0; // enforce monotone non-decreasing adjusted p-values

  for (let i = 0; i < m; i++) {
    const { index, p } = order[i];
    const reject = !failed && p <= alpha / (m - i);
    if (!reject) failed = true;

    const adjustedRaw = Math.min(1, (m - i) * p);
    runningAdjusted = Math.max(runningAdjusted, adjustedRaw);

    results[index] = { index, p, adjusted: runningAdjusted, reject };
  }

  return results;
}

module.exports = {
  mean,
  median,
  bootstrapCI,
  mannWhitneyU,
  cliffsDelta,
  holmBonferroni,
};
