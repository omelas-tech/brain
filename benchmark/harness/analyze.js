#!/usr/bin/env node

/**
 * Post-hoc statistical analysis of a benchmark results file.
 *
 * Turns the raw per-arm `token_samples` (emitted by arm-runner's aggregateArm)
 * into the publishable statistics the pre-registration commits to:
 *   - 90% bootstrap CI on each arm's median tokens
 *   - Mann–Whitney U (reference arm vs each baseline) on token distributions
 *   - Cliff's delta effect size
 *   - Holm–Bonferroni correction across each scenario×agent contrast family
 *
 * Usage:
 *   node harness/analyze.js results/benchmark_<ts>.json [--reference brain-full]
 *
 * Reads a combined results file ({ scenarios: [...] }) or a single scenario
 * object, and writes a `*_stats.md` next to it (and prints a summary).
 */

const fs = require('fs');
const path = require('path');
const stats = require('./stats');

/** Total-token samples for an arm: prefer raw `token_samples`, else the median pair. */
function armSamples(arm) {
  if (Array.isArray(arm.token_samples) && arm.token_samples.length) return arm.token_samples;
  if (arm.tokens) return [(arm.tokens.input || 0) + (arm.tokens.output || 0)];
  return [];
}

/**
 * Analyze a results payload.
 * @param {Object|Object[]} payload - combined `{ scenarios: [...] }`, a bare array of scenario objects, or one scenario object
 * @param {Object} [opts]
 * @param {string} [opts.reference='brain-full'] - the arm every baseline is compared against
 * @returns {Array<{scenario,agent,reference,arms,contrasts}>}
 */
function analyzeResults(payload, opts = {}) {
  const reference = opts.reference || 'brain-full';
  const scenarios = Array.isArray(payload) ? payload
    : Array.isArray(payload.scenarios) ? payload.scenarios
    : [payload];

  const out = [];
  for (const sc of scenarios) {
    const agents = sc.results || {};
    for (const [agent, arms] of Object.entries(agents)) {
      const ref = arms[reference];
      const refSamples = ref ? armSamples(ref) : [];

      const armRows = [];
      const contrasts = [];
      for (const [armName, data] of Object.entries(arms)) {
        if (!data || typeof data !== 'object') continue;
        const samples = armSamples(data);
        armRows.push({
          arm: armName,
          n: samples.length,
          ci: stats.bootstrapCI(samples, { statistic: 'median', confidence: 0.90 }),
          success_rate: data.success_rate ?? null,
          completion_rate: data.completion_rate ?? null,
          recall5: (data.retrieval && data.retrieval.recall && data.retrieval.recall['5']) ?? null,
          tokens_per_success: data.tokens_per_success ?? null,
        });
        // Skip the token contrast for an arm that never completed — it has no
        // valid token distribution; its result is the completion gap, not tokens.
        if (armName !== reference && refSamples.length && samples.length && data.completion_rate !== 0) {
          const mw = stats.mannWhitneyU(refSamples, samples);
          const cd = stats.cliffsDelta(refSamples, samples);
          contrasts.push({ arm: armName, p: mw.p, cliffs: cd.delta, magnitude: cd.magnitude });
        }
      }

      // Holm–Bonferroni across this scenario×agent contrast family.
      const corrected = stats.holmBonferroni(contrasts.map((c) => c.p));
      corrected.forEach((c, i) => {
        contrasts[i].adjusted = c.adjusted;
        contrasts[i].reject = c.reject;
      });

      out.push({ scenario: sc.scenario, agent, reference, arms: armRows, contrasts });
    }
  }
  return out;
}

/** Render the analysis as Markdown. */
function renderAnalysisMarkdown(analysis) {
  const NULL = '—';
  const pct = (x) => (x == null ? NULL : `${Math.round(x * 100)}%`);
  const num = (x) => (x == null ? NULL : String(x));
  const lines = ['# Benchmark — Statistical Analysis', ''];
  for (const block of analysis) {
    lines.push(`## ${block.scenario} · ${block.agent}`);
    lines.push('');
    lines.push('| arm | n | median tokens (90% CI) | completion | success | Recall@5 |');
    lines.push('|-----|--:|-----------------------:|:----------:|:-------:|:--------:|');
    for (const a of block.arms) {
      const ci = a.n ? `${a.ci.point} (${a.ci.lower}–${a.ci.upper})` : NULL;
      lines.push(`| ${a.arm} | ${a.n} | ${ci} | ${pct(a.completion_rate)} | ${pct(a.success_rate)} | ${a.recall5 == null ? NULL : Number(a.recall5).toFixed(2)} |`);
    }
    lines.push('');
    if (block.contrasts.length) {
      lines.push(`**${block.reference}** vs baselines (Mann–Whitney U on tokens, Holm-corrected):`);
      lines.push('');
      lines.push('| baseline | p (raw) | p (Holm) | Cliff δ | magnitude | significant |');
      lines.push('|----------|--------:|---------:|--------:|-----------|:-----------:|');
      for (const c of block.contrasts) {
        lines.push(`| ${c.arm} | ${c.p.toFixed(4)} | ${c.adjusted.toFixed(4)} | ${c.cliffs.toFixed(3)} | ${c.magnitude} | ${c.reject ? 'yes' : 'no'} |`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const refIdx = args.indexOf('--reference');
  const reference = refIdx >= 0 ? args[refIdx + 1] : 'brain-full';
  if (!file) {
    console.error('usage: node harness/analyze.js <results.json> [--reference brain-full]');
    process.exit(1);
  }
  const payload = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const analysis = analyzeResults(payload, { reference });
  const md = renderAnalysisMarkdown(analysis);
  const outPath = file.replace(/\.json$/, '') + '_stats.md';
  fs.writeFileSync(outPath, md);
  console.log(md);
  console.log(`\n  Stats written to: ${outPath}`);
}

if (require.main === module) main();

module.exports = { analyzeResults, renderAnalysisMarkdown, armSamples };
