#!/usr/bin/env node
/**
 * Merge per-arm checkpoints (BENCH_PARTIAL_DIR) from one or more campaign
 * passes into a single combined results file that analyze.js / summarize.js read.
 *
 *   node harness/merge-checkpoints.js --out results/x.json [--exclude-arm dense] <partialDir>... [--override <partialDir>]...
 *
 * Rules, so a merge can never quietly mix evidence:
 *   - an arm is taken whole from exactly one pass (each pass ran its 10 runs
 *     uninterrupted); if two passes both hold the same arm, the merge aborts;
 *   - every checkpoint must be the same agent + model, or the merge aborts;
 *   - a pass given with --override is a deliberate re-run: its arms replace the
 *     same arm from earlier passes, and the replacement is recorded in the
 *     output's `merge.superseded` so it is visible, never silent;
 *   - arms are emitted in the scenario's setup.json order.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
let out = null;
const exclude = new Set();
const dirs = [];
const overrides = new Set();
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') out = args[++i];
  else if (args[i] === '--override') { const d = args[++i]; overrides.add(d); dirs.push(d); }
  else if (args[i] === '--exclude-arm') exclude.add(args[++i]);
  else dirs.push(args[i]);
}
if (!out || dirs.length === 0) {
  console.error('usage: merge-checkpoints.js --out <file> [--exclude-arm name]... <partialDir>...');
  process.exit(2);
}

const byScenario = new Map();
let agentModel = null;
for (const dir of dirs) {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.partial.json'))) {
    const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const am = `${p.agent}/${p.model}`;
    if (agentModel && agentModel !== am) throw new Error(`mixed agents/models: ${agentModel} vs ${am} (${f})`);
    agentModel = am;
    const sc = byScenario.get(p.scenario) || { agent: p.agent, model: p.model, arms: {}, sources: {}, superseded: {} };
    for (const [arm, res] of Object.entries(p.results)) {
      if (exclude.has(arm)) continue;
      if (sc.arms[arm] && overrides.has(dir)) {
        sc.superseded[arm] = sc.sources[arm];
      } else if (sc.arms[arm]) {
        throw new Error(`${p.scenario}/${arm} present in two passes: ${sc.sources[arm]} and ${dir}`);
      }
      sc.arms[arm] = res;
      sc.sources[arm] = dir;
    }
    byScenario.set(p.scenario, sc);
  }
}

const scenarios = [];
for (const [name, sc] of [...byScenario.entries()].sort()) {
  const setup = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scenarios', name, 'setup.json'), 'utf8'));
  const order = (setup.arms || []).map((a) => a.name);
  const ordered = {};
  for (const a of order) if (sc.arms[a]) ordered[a] = sc.arms[a];
  const missing = order.filter((a) => !sc.arms[a] && !exclude.has(a));
  scenarios.push({
    scenario: name, model: `${sc.agent}/${sc.model}`, mode: 'cloud',
    timestamp: new Date().toISOString(), results: { [sc.agent]: ordered },
    merge: { sources: sc.sources, superseded: sc.superseded, missing_arms: missing, excluded_arms: [...exclude] },
  });
  console.log(`${name}: ${Object.keys(ordered).length} arms${missing.length ? `, MISSING: ${missing.join(',')}` : ''}`);
}

fs.writeFileSync(out, JSON.stringify({ timestamp: new Date().toISOString(), model: agentModel, scenarios }, null, 2));
console.log(`wrote ${out}`);
