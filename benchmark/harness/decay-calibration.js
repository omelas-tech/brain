#!/usr/bin/env node
/**
 * Decay calibration — are the hand-set decay constants right?
 *
 * The strength/decay table (decision 0.995/day, insight 0.997, observation
 * 0.950, …) was designed, not measured. It is plausible and internally
 * consistent and nobody has ever checked it against a real brain. FOREVER
 * (arXiv:2601.03938) shows LLM forgetting tracks the Ebbinghaus curve closely
 * enough to schedule replay against, and MSSR (arXiv:2603.09892) fits spaced
 * repetition intervals rather than assuming them — the same move is available
 * here, because every reinforcement writes down what actually happened.
 *
 * ── The diagnostic ───────────────────────────────────────────────────────
 * A decay rate implies a HALF-LIFE: the number of days after which an untouched
 * memory has lost half its strength.
 *
 *     half_life = ln(0.5) / ln(decay_rate)
 *
 * Reinforcement records the OBSERVED interval — how long a memory actually went
 * between recalls. Comparing the two per memory type says something concrete:
 *
 *   ratio = median observed interval / half-life
 *
 *   ratio << 1   Memories are re-recalled far sooner than they decay. The rate
 *                is too SLOW to matter — decay is not doing any work for this
 *                type, and the parameter is decorative.
 *   ratio ≈ 1    Interval and half-life agree. The constant is doing what it
 *                was meant to.
 *   ratio >> 1   Memories stay useful long after the model says they should
 *                have faded. The rate is too FAST — real recalls are happening
 *                on memories the scorer has already written down.
 *
 * This is a diagnostic, not an optimizer. It says which constants are wrong and
 * in which direction; choosing new ones is a judgement call that should then be
 * A/B'd through the benchmark rather than fitted blind.
 *
 * ── Requires data ────────────────────────────────────────────────────────
 * Intervals come from `recall_history`, which `brain reinforce` writes on every
 * recall. A brain that has never been reinforced (or one predating that field
 * being populated) has nothing to fit and will be reported as such — an honest
 * "insufficient data" instead of a confident number derived from three points.
 *
 * Usage:
 *   node harness/decay-calibration.js                 # ~/.brain (or BRAIN_DIR)
 *   node harness/decay-calibration.js --min-n 20
 *   node harness/decay-calibration.js --json
 */

const { readIndex } = require('../../src/index-manager');

// Below this many observed intervals, a per-type median is noise. Reporting a
// "recommendation" off five data points is how a hand-set constant gets
// replaced by a worse one that merely sounds empirical.
const DEFAULT_MIN_N = 10;

/** Days after which an untouched memory has lost half its strength. */
function halfLife(decayRate) {
  if (!(decayRate > 0) || decayRate >= 1) return Infinity;
  return Math.log(0.5) / Math.log(decayRate);
}

function median(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Collect observed inter-recall intervals per memory type.
 *
 * @param {Object} index - Parsed index.json
 * @returns {Map<string, {intervals: number[], decayRates: number[], memories: number}>}
 */
function collectIntervals(index) {
  const byType = new Map();
  for (const entry of Object.values((index && index.memories) || {})) {
    const type = entry.type || 'unknown';
    if (!byType.has(type)) byType.set(type, { intervals: [], decayRates: [], memories: 0 });
    const slot = byType.get(type);
    slot.memories++;
    if (entry.decay_rate) slot.decayRates.push(entry.decay_rate);

    for (const row of entry.recall_history || []) {
      // The first recall after creation has no preceding interval to speak of,
      // and a same-session double-recall (0 days) says nothing about decay.
      if (typeof row.days_since_last === 'number' && row.days_since_last > 0) {
        slot.intervals.push(row.days_since_last);
      }
    }
  }
  return byType;
}

/**
 * Verdict for one type, or null when there is not enough data to have one.
 */
function verdictFor(slot, minN) {
  if (slot.intervals.length < minN) return null;
  const medianRate = median(slot.decayRates);
  const hl = halfLife(medianRate);
  const medianInterval = median(slot.intervals);
  const ratio = hl === Infinity ? 0 : medianInterval / hl;

  let verdict;
  if (ratio < 0.25) verdict = 'decay too slow — not doing any work for this type';
  else if (ratio > 4) verdict = 'decay too fast — memories stay useful past their half-life';
  else verdict = 'consistent';

  return {
    median_decay_rate: Math.round(medianRate * 10000) / 10000,
    half_life_days: Math.round(hl * 10) / 10,
    median_observed_interval_days: Math.round(medianInterval * 10) / 10,
    ratio: Math.round(ratio * 100) / 100,
    verdict,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const minNIdx = argv.indexOf('--min-n');
  const minN = minNIdx !== -1 && argv[minNIdx + 1] ? Number(argv[minNIdx + 1]) : DEFAULT_MIN_N;

  let index;
  try {
    index = readIndex();
  } catch (err) {
    console.error(`Could not read the brain index: ${err.message}`);
    process.exit(1);
  }

  const byType = collectIntervals(index);
  const totalIntervals = [...byType.values()].reduce((n, s) => n + s.intervals.length, 0);

  const rows = [];
  for (const [type, slot] of [...byType.entries()].sort()) {
    rows.push({
      type,
      memories: slot.memories,
      observed_intervals: slot.intervals.length,
      ...(verdictFor(slot, minN) || { verdict: `insufficient data (need ${minN} intervals)` }),
    });
  }

  const report = {
    total_memories: Object.keys((index && index.memories) || {}).length,
    total_observed_intervals: totalIntervals,
    min_n: minN,
    fittable: totalIntervals >= minN,
    rows,
  };

  if (asJson) { console.log(JSON.stringify(report, null, 2)); return; }

  console.log(`\nDecay calibration — ${report.total_memories} memories, ` +
              `${totalIntervals} observed recall intervals\n`);
  if (!report.fittable) {
    console.log('NOT FITTABLE YET. Intervals come from `recall_history`, written by');
    console.log('`brain reinforce` on every recall. Until a brain has accumulated real');
    console.log('recalls over real elapsed time, the decay constants cannot be checked');
    console.log('against anything — and a number derived from a handful of points would');
    console.log('be worse than the honest hand-set default.\n');
  }
  console.log('type'.padEnd(14) + 'mem'.padStart(6) + 'ivals'.padStart(7) +
              'half-life'.padStart(11) + 'observed'.padStart(10) + 'ratio'.padStart(8) + '  verdict');
  for (const r of rows) {
    console.log(
      r.type.padEnd(14) +
      String(r.memories).padStart(6) +
      String(r.observed_intervals).padStart(7) +
      (r.half_life_days != null ? `${r.half_life_days}d` : '—').padStart(11) +
      (r.median_observed_interval_days != null ? `${r.median_observed_interval_days}d` : '—').padStart(10) +
      (r.ratio != null ? String(r.ratio) : '—').padStart(8) +
      `  ${r.verdict}`,
    );
  }
  console.log('');
}

module.exports = { halfLife, median, collectIntervals, verdictFor };

if (require.main === module) main();
