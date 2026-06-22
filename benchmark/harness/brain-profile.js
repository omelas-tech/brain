#!/usr/bin/env node

/**
 * Brain stress + correctness profiler (no LLM required).
 *
 * Seeds the scenario-A oracle + N distractors + hard negatives into an isolated
 * brain, then exercises the REAL `brain session-start` / `brain recall` engine
 * and measures:
 *   - latency of seeding, session-start, and recall at growing corpus sizes
 *     (does recall scale? where does it get slow?)
 *   - Recall@k against the oracle ids
 *   - hard-negative leakage: do superseded (old, rarely-accessed) memories
 *     pollute the top-k? Decay/recency should suppress them — if they rank
 *     ABOVE the oracle, that's a correctness weakness.
 *   - whether pinned memories actually surface in session-start
 *
 * Usage:  node harness/brain-profile.js [sizes]   (e.g. 200,1000,2000)
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

const installer = require('../../src/installer');
const { seedMemories } = require('./seeder');
const { generateDistractors, generateHardNegatives } = require('./distractors');
const { recall, sessionStart, scoreRetrieval } = require('./recall-probe');
const { pinMemory } = require('../../src/pinning');

const SETUP = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'scenarios', 'scenario-A-noisy-folder', 'setup.json'), 'utf-8')
);

async function profile(size) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `brain-prof-${size}-`));
  try {
    installer.initializeBrain(home);

    const oracle = SETUP.memories || [];
    const distractors = generateDistractors(size, 42);
    const hardNegs = generateHardNegatives(oracle, SETUP.hard_negatives || 6, 43);
    const all = [...oracle, ...distractors, ...hardNegs];

    let t = Date.now();
    seedMemories(home, all, { associations: SETUP.associations || [], context: SETUP.context || null });
    for (const m of oracle.filter((m) => m.pin === true)) pinMemory(home, m.id, { scope: m.pin_scope || 'global', priority: m.pin_priority || 5 });
    const seedMs = Date.now() - t;

    const ctx = SETUP.context || {};
    const topics = (ctx.topics || []).join(',');

    t = Date.now();
    const ss = await sessionStart({ homeDir: home, project: ctx.project, topics, task: ctx.task_type, top: 5 });
    const ssMs = Date.now() - t;

    t = Date.now();
    const ranked = await recall({ homeDir: home, query: SETUP.recall_query || '', project: ctx.project, topics, task: ctx.task_type, top: 10 });
    const recallMs = Date.now() - t;

    const score = scoreRetrieval(ranked, SETUP.oracle_memory_ids || []);
    const ids = ranked.map((r) => r.id);
    const oracleRanks = (SETUP.oracle_memory_ids || []).map((id) => {
      const i = ids.indexOf(id);
      return i === -1 ? null : i + 1;
    });
    const hardNegInTop10 = ids.filter((id) => String(id).startsWith('mem_hardneg')).length;

    return {
      size, corpus: all.length,
      seedMs, ssMs, recallMs,
      recall_at_5: score.recall[5], recall_at_10: score.recall[10],
      oracleRanks, hardNegInTop10,
      ss_memory_count: ss.memory_count,
      ss_pinned: (ss.pinned || []).length,
      ss_context_recall: (ss.context_recall || []).length,
    };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

async function main() {
  const sizes = (process.argv[2] || '200,1000,2000').split(',').map((s) => parseInt(s, 10));
  console.log(`Brain profiler — scenario-A oracle + N distractors + hard negatives\n`);
  const rows = [];
  for (const size of sizes) {
    const r = await profile(size);
    rows.push(r);
    console.log(JSON.stringify(r));
  }
  // quick scaling read
  console.log('\nlatency scaling (recall ms per corpus):');
  for (const r of rows) {
    const perK = r.recallMs / (r.corpus / 1000);
    console.log(`  corpus ${String(r.corpus).padStart(5)}  seed ${String(r.seedMs).padStart(6)}ms  session-start ${String(r.ssMs).padStart(5)}ms  recall ${String(r.recallMs).padStart(5)}ms  (~${perK.toFixed(0)}ms/1k)`);
  }
  console.log('\ncorrectness signals:');
  for (const r of rows) {
    const flag = r.hardNegInTop10 > 0 ? `⚠ ${r.hardNegInTop10} hard-negatives in top-10` : 'clean';
    console.log(`  corpus ${String(r.corpus).padStart(5)}  Recall@5 ${r.recall_at_5}  oracleRanks ${JSON.stringify(r.oracleRanks)}  pinnedSurfaced ${r.ss_pinned}  ${flag}`);
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { profile };
