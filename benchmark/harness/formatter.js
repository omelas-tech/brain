/**
 * ASCII and Markdown table rendering for benchmark results.
 */

/**
 * Render an ASCII comparison table to the console.
 *
 * @param {Object} results - Full benchmark results object
 */
function renderConsoleTable(results) {
  const { scenario, model, results: agentResults, summary } = results;

  // Detect arm-shape results (per-arm keys, not just with_brain/without_brain)
  const isArmShape = Object.values(agentResults).some(
    (d) => d && typeof d === 'object' && !d.with_brain && !d.without_brain && Object.keys(d).length > 0
  );
  if (isArmShape) return renderArmConsoleTable(results);

  const lines = [];
  lines.push('');
  lines.push(`  Scenario: ${scenario}`);
  lines.push(`  Model:    ${model}`);
  lines.push('');

  // Header
  const agents = Object.keys(agentResults);
  const colWidth = 18;
  const headerCols = ['', 'Tokens', 'Time (ms)', 'Success', 'Consistency'];
  const headerLine = headerCols.map((h) => h.padEnd(colWidth)).join('');
  lines.push(`  ${headerLine}`);
  lines.push(`  ${'─'.repeat(colWidth * headerCols.length)}`);

  // Agent rows
  for (const agent of agents) {
    const data = agentResults[agent];

    // With brain row
    const wb = data.with_brain;
    if (wb) {
      const totalTokens = wb.tokens.input + wb.tokens.output;
      lines.push(`  ${(agent + ' +brain').padEnd(colWidth)}${
        String(totalTokens).padEnd(colWidth)}${
        String(wb.time_ms).padEnd(colWidth)}${
        (wb.success ? 'PASS' : 'FAIL').padEnd(colWidth)}${
        String(wb.consistency)}`);
    }

    // Without brain row
    const wo = data.without_brain;
    if (wo) {
      const totalTokens = wo.tokens.input + wo.tokens.output;
      lines.push(`  ${(agent + ' -brain').padEnd(colWidth)}${
        String(totalTokens).padEnd(colWidth)}${
        String(wo.time_ms).padEnd(colWidth)}${
        (wo.success ? 'PASS' : 'FAIL').padEnd(colWidth)}${
        String(wo.consistency)}`);
    }

    lines.push('');
  }

  // Summary
  if (summary) {
    lines.push(`  ${'─'.repeat(colWidth * headerCols.length)}`);
    lines.push(`  Token reduction:       ${formatDelta(summary.token_reduction_pct)}%`);
    lines.push(`  Success improvement:   ${formatDelta(summary.success_improvement_pct)}%`);
    lines.push(`  Consistency improvement: ${formatDelta(summary.consistency_improvement_pct)}%`);
    lines.push(`  Time reduction:        ${formatDelta(summary.time_reduction_pct)}%`);
  }

  lines.push('');
  return lines.join('\n');
}

// Single canonical "no data" symbol across every table. No more ∞ / N/A / 0.
const NULL_CELL = '—';

function fmtPct(x) {
  return (x == null || Number.isNaN(x)) ? NULL_CELL : `${Math.round(x * 100)}%`;
}
function armTotalTokens(d) {
  return (d.tokens?.input || 0) + (d.tokens?.output || 0);
}
function fmtTokens(d) {
  const t = armTotalTokens(d);
  // All runs failed to complete → tokens are meaningless, show the null cell.
  if (d.no_completion_rate === 1 || (t === 0 && (d.completion_rate === 0))) return NULL_CELL;
  return String(t);
}
function fmtTps(d) {
  return d.tokens_per_success == null ? NULL_CELL : String(d.tokens_per_success);
}
function fmtRecall(d, k = 5) {
  const r = d.retrieval?.recall?.[String(k)];
  return r == null ? NULL_CELL : Number(r).toFixed(2);
}
// Completion vs success reported separately. Old result objects lack
// completion_rate; fall back so legacy JSON still renders.
function completionRate(d) {
  return d.completion_rate != null ? d.completion_rate : null;
}
function successRate(d) {
  return d.success_rate != null ? d.success_rate
    : (d.judge_pass_rate != null ? d.judge_pass_rate : null);
}

function renderArmConsoleTable(results) {
  const { scenario, model, results: agentResults } = results;
  const lines = ['', `  Scenario: ${scenario}`, `  Model:    ${model}`, ''];
  const cols = ['arm', 'compl%', 'succ%', 'tokens', 'tok/succ', 'R@5'];
  const w = 16;
  for (const [agent, arms] of Object.entries(agentResults)) {
    lines.push(`  ${agent}`);
    lines.push(`  ${cols.map((c) => c.padEnd(w)).join('')}`);
    lines.push(`  ${'─'.repeat(w * cols.length)}`);
    for (const [armName, data] of Object.entries(arms)) {
      if (!data) continue;
      lines.push(
        `  ${armName.padEnd(w)}` +
        `${fmtPct(completionRate(data)).padEnd(w)}` +
        `${fmtPct(successRate(data)).padEnd(w)}` +
        `${fmtTokens(data).padEnd(w)}` +
        `${fmtTps(data).padEnd(w)}` +
        `${fmtRecall(data, 5)}`
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Render a Markdown table for README inclusion.
 *
 * @param {Object[]} allResults - Array of scenario result objects
 * @returns {string} Markdown content
 */
function renderMarkdownReport(allResults) {
  const lines = [];

  lines.push('# Brain Memory Benchmark Results');
  lines.push('');
  lines.push(`**Date**: ${new Date().toISOString().slice(0, 10)}`);
  if (allResults.length > 0) {
    lines.push(`**Model**: ${allResults[0].model}`);
  }
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Scenario | Token Reduction | Success Improvement | Consistency Improvement |');
  lines.push('|----------|:--------------:|:------------------:|:----------------------:|');

  for (const result of allResults) {
    const s = result.summary || {};
    lines.push(
      `| ${result.scenario} ` +
      `| ${formatDelta(s.token_reduction_pct)}% ` +
      `| ${formatDelta(s.success_improvement_pct)}% ` +
      `| ${formatDelta(s.consistency_improvement_pct)}% |`
    );
  }

  lines.push('');

  // Per-scenario details
  for (const result of allResults) {
    lines.push(`## ${result.scenario}`);
    lines.push('');

    const isArmShape = Object.values(result.results).some(
      (d) => d && typeof d === 'object' && !d.with_brain && !d.without_brain && Object.keys(d).length > 0
    );

    if (isArmShape) {
      lines.push('| Agent | Arm | Completion | Success | Tokens | Tokens/success | Recall@5 |');
      lines.push('|-------|-----|:----------:|:-------:|-------:|---------------:|:--------:|');
      for (const [agent, arms] of Object.entries(result.results)) {
        for (const [armName, v] of Object.entries(arms)) {
          if (!v) continue;
          lines.push(
            `| ${agent} | ${armName} | ${fmtPct(completionRate(v))} | ${fmtPct(successRate(v))} ` +
            `| ${fmtTokens(v)} | ${fmtTps(v)} | ${fmtRecall(v, 5)} |`
          );
        }
      }
    } else {
      lines.push('| Agent | Variant | Tokens | Time (ms) | Success | Consistency |');
      lines.push('|-------|---------|-------:|----------:|:-------:|:-----------:|');
      for (const [agent, data] of Object.entries(result.results)) {
        for (const variant of ['with_brain', 'without_brain']) {
          const v = data[variant];
          if (!v) continue;
          const totalTokens = v.tokens.input + v.tokens.output;
          const label = variant === 'with_brain' ? '+brain' : '-brain';
          lines.push(
            `| ${agent} | ${label} | ${totalTokens} | ${v.time_ms} | ${v.success ? 'PASS' : 'FAIL'} | ${v.consistency} |`
          );
        }
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format a delta value with sign.
 */
function formatDelta(value) {
  if (value == null) return 'N/A';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value}`;
}

module.exports = { renderConsoleTable, renderMarkdownReport, formatDelta };
