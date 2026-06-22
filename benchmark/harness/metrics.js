/**
 * Metrics collection and aggregation.
 *
 * Extracts token usage, timing data, and computes statistical
 * aggregates across multiple benchmark runs.
 */

/**
 * Create an empty metrics container for a single run.
 * @returns {Object}
 */
function createRunMetrics() {
  return {
    tokens: { input: 0, output: 0 },
    time_ms: 0,
    prompts: [],
  };
}

/**
 * Record a single prompt execution result into run metrics.
 *
 * @param {Object} metrics - Run metrics container
 * @param {Object} result - Agent run result
 * @param {string} promptLabel - Label for this prompt
 */
function recordPrompt(metrics, result, promptLabel) {
  const entry = {
    label: promptLabel,
    tokens: { ...result.tokens },
    time_ms: result.time_ms,
  };

  metrics.tokens.input += result.tokens.input;
  metrics.tokens.output += result.tokens.output;
  metrics.time_ms += result.time_ms;
  metrics.prompts.push(entry);
}

/**
 * Compute the total token count (input + output).
 * @param {Object} tokens - { input, output }
 * @returns {number}
 */
function totalTokens(tokens) {
  return tokens.input + tokens.output;
}

/**
 * Aggregate results from multiple runs using median.
 * Each run is { tokens, time_ms, success, consistency, ... }.
 *
 * Token and time medians are computed from successful runs only,
 * so that failed/timed-out runs (which have zero tokens) don't
 * corrupt the metrics. Success rate and consistency use all runs.
 *
 * @param {Object[]} runs - Array of run results
 * @returns {Object} Aggregated result with median values
 */
function aggregateRuns(runs) {
  if (runs.length === 0) return null;
  if (runs.length === 1) return { ...runs[0] };

  const successfulRuns = runs.filter((r) => r.success);
  const successes = successfulRuns.length;

  // Use successful runs for token/time medians; fall back to all runs if none succeeded
  const metricsRuns = successfulRuns.length > 0 ? successfulRuns : runs;

  const tokenInputs = metricsRuns.map((r) => r.tokens.input).sort((a, b) => a - b);
  const tokenOutputs = metricsRuns.map((r) => r.tokens.output).sort((a, b) => a - b);
  const times = metricsRuns.map((r) => r.time_ms).sort((a, b) => a - b);
  const consistencies = runs.map((r) => r.consistency).sort((a, b) => a - b);

  return {
    tokens: {
      input: median(tokenInputs),
      output: median(tokenOutputs),
    },
    time_ms: median(times),
    success: successes > runs.length / 2,
    consistency: Math.round(median(consistencies) * 1000) / 1000,
    runs: runs.length,
    success_rate: Math.round((successes / runs.length) * 100) / 100,
  };
}

/**
 * Compute the median of a sorted array.
 * @param {number[]} sorted
 * @returns {number}
 */
function median(sorted) {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

/**
 * Compute summary deltas between with-brain and without-brain results.
 *
 * @param {Object} withBrain - Aggregated with-brain results
 * @param {Object} withoutBrain - Aggregated without-brain results
 * @returns {Object} Summary with improvement percentages
 */
function computeSummary(withBrain, withoutBrain) {
  const wbTokens = totalTokens(withBrain.tokens);
  const woTokens = totalTokens(withoutBrain.tokens);

  const tokenReduction = woTokens > 0
    ? Math.round(((woTokens - wbTokens) / woTokens) * 1000) / 10
    : 0;

  const successImprovement = Math.round(
    ((withBrain.success_rate - withoutBrain.success_rate) * 100) * 10
  ) / 10;

  const consistencyImprovement = Math.round(
    ((withBrain.consistency - withoutBrain.consistency) * 100) * 10
  ) / 10;

  const timeReduction = withoutBrain.time_ms > 0
    ? Math.round(((withoutBrain.time_ms - withBrain.time_ms) / withoutBrain.time_ms) * 1000) / 10
    : 0;

  return {
    token_reduction_pct: tokenReduction,
    success_improvement_pct: successImprovement,
    consistency_improvement_pct: consistencyImprovement,
    time_reduction_pct: timeReduction,
  };
}

/**
 * Run outcome taxonomy. Every run resolves to exactly one of these.
 * Replaces the old binary success/fail that silently absorbed timeouts.
 */
const OUTCOME = {
  PASS: 'COMPLETED_PASS', // agent finished AND judge rubric ≥ threshold
  FAIL: 'COMPLETED_FAIL', // agent finished but failed the rubric
  NONE: 'NO_COMPLETION',  // timeout / crash / overflow — no gradeable output
};

/**
 * Classify a single run into the outcome taxonomy. Honors an explicit
 * `run.outcome` if present; otherwise infers from legacy `error`/`success`
 * fields so old result objects still classify correctly.
 * @param {Object} run
 * @returns {'COMPLETED_PASS'|'COMPLETED_FAIL'|'NO_COMPLETION'}
 */
function classifyRun(run) {
  if (run.outcome && Object.values(OUTCOME).includes(run.outcome)) return run.outcome;
  if (run.error) return OUTCOME.NONE;
  return run.success ? OUTCOME.PASS : OUTCOME.FAIL;
}

/**
 * Summarize outcomes across runs. Reports completion and success as SEPARATE
 * rates — a timeout dents completion, never the token economy.
 * @param {Object[]} runs
 * @returns {{total:number, passes:number, completed:number, no_completion:number,
 *           completion_rate:number, success_rate:number, no_completion_rate:number}}
 */
function summarizeOutcomes(runs) {
  const total = runs.length;
  let passes = 0, completed = 0, noCompletion = 0;
  for (const r of runs) {
    const o = classifyRun(r);
    if (o === OUTCOME.PASS) { passes++; completed++; }
    else if (o === OUTCOME.FAIL) { completed++; }
    else noCompletion++;
  }
  const rate = (x) => (total ? Math.round((x / total) * 1000) / 1000 : 0);
  return {
    total, passes, completed, no_completion: noCompletion,
    completion_rate: rate(completed),
    success_rate: rate(passes),
    no_completion_rate: rate(noCompletion),
  };
}

module.exports = {
  createRunMetrics,
  recordPrompt,
  totalTokens,
  aggregateRuns,
  computeSummary,
  median,
  OUTCOME,
  classifyRun,
  summarizeOutcomes,
};
