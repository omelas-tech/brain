#!/usr/bin/env node

/**
 * Summarize a benchmark result file into a clean per-arm table — the exact
 * numbers published on the website / docs. Deterministic: same JSON in, same
 * table out, so the site can always be regenerated from the raw results.
 *
 * Reports per arm: median total tokens, tokens-per-success, Recall@5, the mean
 * rubric SCORE (fraction of criteria met, the richer signal than binary pass),
 * pass-rate, and completion-rate.
 *
 * Usage:
 *   node harness/summarize.js results/benchmark_<ts>.json
 *   node harness/summarize.js results/scenario-A-noisy-folder_<ts>.json --md
 */

const fs = require('fs');

/** mean rubric score for an arm = average of its per-criterion pass rates. */
function meanScore(arm) {
  const cpr = arm.criteria_pass_rate;
  if (!Array.isArray(cpr) || cpr.length === 0) return null;
  return cpr.reduce((s, c) => s + (c.pass_rate || 0), 0) / cpr.length;
}

function fmt(n, digits = 0) {
  if (n == null) return '—';
  return digits ? n.toFixed(digits) : Math.round(n).toLocaleString('en-US');
}

function pct(x) { return x == null ? '—' : `${Math.round(x * 100)}%`; }
function recallAt(arm, k) {
  const r = arm.retrieval && arm.retrieval.recall;
  return r && r[k] != null ? r[k].toFixed(2) : '—';
}

/** Normalize a payload into [{ scenario, agent, arms: {name: armObj} }]. */
function scenarios(payload) {
  const list = Array.isArray(payload) ? payload
    : Array.isArray(payload.scenarios) ? payload.scenarios
    : [payload];
  const out = [];
  for (const sc of list) {
    const scenario = sc.scenario || 'scenario';
    for (const [agent, arms] of Object.entries(sc.results || {})) {
      out.push({ scenario, agent, arms });
    }
  }
  return out;
}

function tableFor({ scenario, agent, arms }) {
  const rows = Object.entries(arms).map(([name, a]) => ({
    arm: name,
    tokens: a.median_tokens != null ? a.median_tokens : ((a.tokens?.input || 0) + (a.tokens?.output || 0)),
    tps: a.tokens_per_success,
    r5: recallAt(a, 5),
    score: meanScore(a),
    pass: a.success_rate,
    compl: a.completion_rate,
    n: a.runs || a.total,
  }));

  const lines = [];
  lines.push(`### ${scenario} · ${agent}`);
  lines.push('');
  lines.push('| arm | n | median tokens | tok/success | Recall@5 | rubric score | pass | completed |');
  lines.push('|-----|--:|--------------:|------------:|:--------:|:------------:|:----:|:---------:|');
  for (const r of rows) {
    lines.push(`| ${r.arm} | ${r.n ?? '—'} | ${fmt(r.tokens)} | ${fmt(r.tps)} | ${r.r5} | ${r.score == null ? '—' : r.score.toFixed(2)} | ${pct(r.pass)} | ${pct(r.compl)} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  const file = process.argv[2];
  if (!file) { console.error('usage: summarize.js <result.json>'); process.exit(1); }
  const payload = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const out = scenarios(payload).map(tableFor).join('\n');
  process.stdout.write(out + '\n');
}

if (require.main === module) main();
module.exports = { meanScore, scenarios, tableFor };
