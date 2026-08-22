#!/usr/bin/env node
/**
 * Retrieval-only pilot — Recall@k for every retriever, with no agent involved.
 *
 * The full suite spends an LLM call per arm per run. But the question "does
 * retrieval method X find the oracle memories in this haystack?" is answerable
 * without generating a single token: build the same corpus the arms see, run
 * each retriever, score against `oracle_memory_ids`. Seconds, not dollars.
 *
 * Use it to decide whether a retrieval change is worth a full run. In
 * particular it is the decision gate for adding a semantic stream to the
 * production scorer: if `dense` does not clear `brain-bm25` on this corpus,
 * embeddings are not the bottleneck and the dependency is not worth paying.
 *
 * Retrievers compared:
 *   keyword       BM25 over title+body+tags (the lexical floor)
 *   vector        hashed bag-of-words in vector geometry (NOT semantic)
 *   dense         real embedding model, plain cosine (gated on config)
 *   brain-bm25    Brain's OWN relevance function (src/tfidf.js bm25Search),
 *                 isolated from decay / spreading activation / context match
 *
 * The last one matters: it separates "Brain's relevance function" from "Brain's
 * whole scorer". A gap between `keyword` and `brain-bm25` is field weighting
 * and stemming; a gap between `brain-bm25` and the full `brain-full` arm in the
 * agent suite is everything else the scorer adds.
 *
 * Usage:
 *   node harness/retrieval-only.js                     # every scenario with oracles
 *   node harness/retrieval-only.js --scenario A        # one scenario
 *   node harness/retrieval-only.js --distractor-size 200   # faster pilot
 *   node harness/retrieval-only.js --json              # machine-readable
 */

const fs = require('fs');
const path = require('path');

const { generateDistractors, generateHardNegatives } = require('./distractors');
const { scoreRetrieval } = require('./recall-probe');
const tfidf = require('../../src/tfidf');

const SCENARIOS_DIR = path.join(__dirname, '..', 'scenarios');
const KS = [1, 3, 5, 10];

/* ─────────────────────────── brain's own relevance ─────────────────────────── */

/**
 * Brain's production relevance function over an in-memory corpus.
 *
 * Builds the same search index `brain memorize` would, then ranks with the
 * same `bm25Search` that bin/recall.js calls. No decay, no spreading
 * activation, no context match — relevance alone.
 */
const brainBm25 = {
  name: 'brain-bm25',
  retrieve(memories, query, opts = {}) {
    const idx = tfidf.createSearchIndex();
    for (const mem of memories) {
      tfidf.addDocument(idx, mem.id, {
        title: mem.title || '',
        body: mem.body || '',
        tags: mem.tags || [],
        content: mem.content || '',
      });
    }
    const scores = tfidf.bm25Search(idx, query);
    return memories
      .map((mem) => ({
        id: mem.id,
        score: scores[mem.id] || 0,
        title: mem.title || '',
        body: mem.body || mem.content || '',
        type: mem.type || '',
      }))
      .sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, opts.top || 10);
  },
};

const RETRIEVERS = [
  require('./retrievers/keyword'),
  require('./retrievers/vector-baseline'),
  require('./retrievers/dense'),
  brainBm25,
];

/* ─────────────────────────── corpus ─────────────────────────── */

/**
 * Rebuild the haystack a retriever arm sees. Mirrors `buildCorpus` in
 * arm-runner.js — same generators, same seeds, so numbers here and numbers
 * from a full run describe the same corpus.
 */
function buildCorpus(setup, distractorSize, seed) {
  const oracle = setup.memories || [];
  const distractors = distractorSize > 0 ? generateDistractors(distractorSize, seed) : [];
  const hardNegs = setup.hard_negatives
    ? generateHardNegatives(oracle, setup.hard_negatives, seed + 1)
    : [];
  return [...oracle, ...distractors, ...hardNegs];
}

/** Scenarios that declare oracle IDs — the only ones Recall@k is defined for. */
function loadScenarios(filter) {
  return fs.readdirSync(SCENARIOS_DIR)
    .filter((d) => d.startsWith('scenario-'))
    .filter((d) => !filter || d.includes(`scenario-${filter}-`) || d === filter)
    .map((dir) => {
      const p = path.join(SCENARIOS_DIR, dir, 'setup.json');
      if (!fs.existsSync(p)) return null;
      const setup = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (!Array.isArray(setup.oracle_memory_ids) || setup.oracle_memory_ids.length === 0) return null;
      return { dir, setup };
    })
    .filter(Boolean);
}

/* ─────────────────────────── run ─────────────────────────── */

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name, dflt) => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  const scenarioFilter = flag('scenario', null);
  const asJson = argv.includes('--json');

  const scenarios = loadScenarios(scenarioFilter);
  if (scenarios.length === 0) {
    console.error(`No scenarios with oracle_memory_ids${scenarioFilter ? ` matching "${scenarioFilter}"` : ''}.`);
    process.exit(1);
  }

  const report = [];

  for (const { dir, setup } of scenarios) {
    // Take the distractor size from the scenario's own retriever arms so the
    // pilot matches the real run unless explicitly overridden.
    const armSize = (setup.arms || []).find((a) => a.distractor_size)?.distractor_size || 0;
    const distractorSize = Number(flag('distractor-size', armSize));
    const seed = Number(flag('seed', 42));

    const corpus = buildCorpus(setup, distractorSize, seed);
    const query = setup.recall_query || setup.test?.[0]?.text || '';
    const oracles = setup.oracle_memory_ids;

    if (!asJson) {
      console.log(`\n${'═'.repeat(78)}`);
      console.log(`${setup.name || dir}`);
      console.log(`corpus: ${corpus.length} memories (${oracles.length} oracle, ${distractorSize} distractors` +
                  `${setup.hard_negatives ? `, ${setup.hard_negatives} hard-negatives/anchor` : ''})`);
      console.log(`query:  "${query.slice(0, 90)}${query.length > 90 ? '…' : ''}"`);
      console.log(`${'─'.repeat(78)}`);
      console.log(`${'retriever'.padEnd(16)}${KS.map((k) => `R@${k}`.padStart(8)).join('')}${'NDCG@5'.padStart(9)}${'  oracle ranks'}`);
    }

    const rows = [];
    for (const r of RETRIEVERS) {
      let ranked;
      try {
        // Rank the whole corpus: an oracle at rank 11 and one at rank 900 are
        // very different findings, and a top-k cutoff renders both as a miss.
        ranked = await r.retrieve(corpus, query, { top: corpus.length });
      } catch (err) {
        if (!asJson) console.log(`${r.name.padEnd(16)}  skipped — ${err.message.split(':').slice(1).join(':').trim().slice(0, 60)}`);
        rows.push({ retriever: r.name, skipped: true, reason: err.message });
        continue;
      }
      const s = scoreRetrieval(ranked, oracles, KS);
      rows.push({ retriever: r.name, recall: s.recall, ndcg: s.ndcg, ranks: s.ranks });
      if (!asJson) {
        const ranksStr = s.ranks.map((x) => (x === Infinity ? '∞' : x)).join(', ');
        console.log(
          r.name.padEnd(16) +
          KS.map((k) => String(s.recall[k].toFixed(2)).padStart(8)).join('') +
          String(s.ndcg[5].toFixed(3)).padStart(9) +
          `  [${ranksStr}] of ${corpus.length}`,
        );
      }
    }
    report.push({ scenario: dir, name: setup.name, corpus_size: corpus.length, query, rows });
  }

  if (asJson) console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
