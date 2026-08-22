#!/usr/bin/env node
/**
 * LongMemEval-S adapter — Brain's numbers on the benchmark buyers actually cite.
 *
 * Brain's A–F suite is better science than most published memory evals
 * (preregistered, cross-family judge panel, honest nulls, stated n). It is also
 * *ours*, which means Brain appears in nobody's comparison table. LongMemEval,
 * LoCoMo, and BEAM are the three benchmarks every vendor quotes; being absent
 * from them reads as "did not compete", not "chose a better instrument".
 *
 * This adapter scores the **retrieval half** of LongMemEval-S — and that half
 * needs no LLM at all. Each instance ships ~50 haystack sessions with the
 * evidence sessions labelled (`answer_session_ids`), so Recall@k is computable
 * offline, deterministically, for free, across all 500 questions.
 *
 * What this does NOT produce is an end-to-end QA accuracy number (the "94.4"
 * kind). That requires generating an answer per question and judging it, which
 * is 500 LLM calls per arm. The retrieval number is the honest, cheap,
 * reproducible half — and it is the half that isolates the memory system from
 * the reader model, which is exactly what a memory benchmark should be
 * measuring anyway.
 *
 * ── Fairness caveat, stated up front ─────────────────────────────────────
 * LongMemEval haystacks are **raw chat transcripts**. Brain's model is
 * *distilled* memories — a `decision` with tags and an encoding context, not a
 * 40-turn conversation. Mapping one session to one "memory" is the standard
 * comparison every retrieval-based system on this leaderboard runs, but it
 * plays to a chunk-retriever's strengths and away from Brain's: no distillation,
 * no curated tags, no associative graph, no pinned tier. Read a competitive
 * number here as a floor, not a ceiling.
 *
 * ── Getting the data ─────────────────────────────────────────────────────
 *   mkdir -p benchmark/data && cd benchmark/data
 *   wget https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json
 *
 * Then:
 *   node harness/longmemeval.js                    # all instances, all retrievers
 *   node harness/longmemeval.js --limit 50         # quick pilot
 *   node harness/longmemeval.js --type multi-session
 *   node harness/longmemeval.js --json > results.json
 *
 * The dataset is NOT vendored: it is large, it is not ours to redistribute, and
 * the cleaned revision moves.
 */

const fs = require('fs');
const path = require('path');

const { scoreRetrieval } = require('./recall-probe');
const tfidf = require('../../src/tfidf');

const KS = [1, 3, 5, 10];
const DEFAULT_PATHS = [
  process.env.LONGMEMEVAL_PATH,
  path.join(__dirname, '..', 'data', 'longmemeval_s_cleaned.json'),
  path.join(__dirname, '..', 'data', 'longmemeval_s.json'),
].filter(Boolean);

const DOWNLOAD_HINT =
  'LongMemEval-S not found. Fetch it with:\n' +
  '  mkdir -p benchmark/data && cd benchmark/data && \\\n' +
  '  wget https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json\n' +
  'Or point LONGMEMEVAL_PATH at an existing copy.';

/* ─────────────────────── dataset → Brain corpus ─────────────────────── */

/**
 * Render one haystack session as a single retrievable memory.
 *
 * Title is the first user turn (the closest thing a raw session has to a
 * subject line); body is the full transcript. Both feed `memoryText`, which
 * every retriever shares, so no arm sees a different rendering.
 *
 * @param {string} id - Session id (the unit Recall@k is scored over)
 * @param {Array<{role: string, content: string}>} turns
 * @param {string} date - Session timestamp, kept as the memory's record time
 * @returns {Object} memory-shaped record
 */
function sessionToMemory(id, turns, date) {
  const list = Array.isArray(turns) ? turns : [];
  const firstUser = list.find((t) => t.role === 'user');
  return {
    id,
    title: (firstUser?.content || '').slice(0, 120),
    body: list.map((t) => `${t.role}: ${t.content}`).join('\n'),
    content: '',
    tags: [],
    type: 'experience',
    created: date || null,
  };
}

/**
 * Build the corpus and oracle set for one benchmark instance.
 *
 * @param {Object} inst - Raw LongMemEval instance
 * @returns {{ corpus: Object[], oracles: string[], query: string }}
 */
function instanceToCase(inst) {
  const ids = inst.haystack_session_ids || [];
  const sessions = inst.haystack_sessions || [];
  const dates = inst.haystack_dates || [];

  const corpus = ids.map((id, i) => sessionToMemory(id, sessions[i], dates[i]));
  return {
    corpus,
    oracles: inst.answer_session_ids || [],
    query: inst.question || '',
  };
}

/* ─────────────────────── retrievers ─────────────────────── */

/** Brain's production relevance function, isolated from the rest of the scorer. */
const brainBm25 = {
  name: 'brain-bm25',
  retrieve(memories, query, opts = {}) {
    const idx = tfidf.createSearchIndex();
    for (const m of memories) {
      tfidf.addDocument(idx, m.id, { title: m.title, body: m.body, tags: m.tags, content: m.content });
    }
    const scores = tfidf.bm25Search(idx, query);
    return memories
      .map((m) => ({ id: m.id, score: scores[m.id] || 0, title: m.title, body: m.body, type: m.type }))
      .sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : 1))
      .slice(0, opts.top || 10);
  },
};

const RETRIEVERS = [
  require('./retrievers/keyword'),
  brainBm25,
  require('./retrievers/dense'),
];

/* ─────────────────────── run ─────────────────────── */

function loadDataset() {
  for (const p of DEFAULT_PATHS) {
    if (p && fs.existsSync(p)) return { path: p, data: JSON.parse(fs.readFileSync(p, 'utf-8')) };
  }
  return null;
}

/** Mean of a numeric array, 3dp. 0 for an empty set. */
function mean(xs) {
  if (xs.length === 0) return 0;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name, dflt) => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  const asJson = argv.includes('--json');

  const loaded = loadDataset();
  if (!loaded) { console.error(DOWNLOAD_HINT); process.exit(1); }

  let instances = Array.isArray(loaded.data) ? loaded.data : loaded.data.instances || [];

  const typeFilter = flag('type', null);
  if (typeFilter) instances = instances.filter((i) => i.question_type === typeFilter);

  // Abstention instances (`_abs`) have no evidence session by design — there is
  // nothing to recall, so Recall@k is undefined rather than 0. Scoring them
  // would silently drag every arm's average toward zero.
  const skippedAbs = instances.filter((i) => !(i.answer_session_ids || []).length).length;
  instances = instances.filter((i) => (i.answer_session_ids || []).length > 0);

  const limit = Number(flag('limit', 0));
  if (limit > 0) instances = instances.slice(0, limit);

  if (instances.length === 0) { console.error('No scorable instances after filtering.'); process.exit(1); }

  const perRetriever = new Map(RETRIEVERS.map((r) => [r.name, { recall: {}, ndcg5: [], skipped: null }]));
  for (const r of RETRIEVERS) for (const k of KS) perRetriever.get(r.name).recall[k] = [];

  let corpusTotal = 0;
  for (const inst of instances) {
    const { corpus, oracles, query } = instanceToCase(inst);
    corpusTotal += corpus.length;

    for (const r of RETRIEVERS) {
      const slot = perRetriever.get(r.name);
      if (slot.skipped) continue;
      let ranked;
      try {
        ranked = await r.retrieve(corpus, query, { top: corpus.length });
      } catch (err) {
        slot.skipped = err.message;
        continue;
      }
      const s = scoreRetrieval(ranked, oracles, KS);
      for (const k of KS) slot.recall[k].push(s.recall[k]);
      slot.ndcg5.push(s.ndcg[5]);
    }
  }

  const rows = RETRIEVERS.map((r) => {
    const slot = perRetriever.get(r.name);
    if (slot.skipped) return { retriever: r.name, skipped: slot.skipped };
    return {
      retriever: r.name,
      ...Object.fromEntries(KS.map((k) => [`recall_at_${k}`, mean(slot.recall[k])])),
      ndcg_at_5: mean(slot.ndcg5),
      n: slot.ndcg5.length,
    };
  });

  const report = {
    dataset: path.basename(loaded.path),
    instances_scored: instances.length,
    abstention_instances_skipped: skippedAbs,
    mean_haystack_size: Math.round(corpusTotal / instances.length),
    question_type: typeFilter || 'all',
    metric: 'retrieval only — no answer generation, no judge',
    rows,
  };

  if (asJson) { console.log(JSON.stringify(report, null, 2)); return; }

  console.log(`\nLongMemEval-S — retrieval only (${report.dataset})`);
  console.log(`${report.instances_scored} instances · mean haystack ${report.mean_haystack_size} sessions` +
              `${skippedAbs ? ` · ${skippedAbs} abstention instances skipped` : ''}`);
  console.log('─'.repeat(66));
  console.log('retriever'.padEnd(16) + KS.map((k) => `R@${k}`.padStart(9)).join('') + 'NDCG@5'.padStart(10));
  for (const row of rows) {
    if (row.skipped) { console.log(`${row.retriever.padEnd(16)}  skipped — ${row.skipped.slice(0, 44)}`); continue; }
    console.log(
      row.retriever.padEnd(16) +
      KS.map((k) => row[`recall_at_${k}`].toFixed(3).padStart(9)).join('') +
      row.ndcg_at_5.toFixed(3).padStart(10),
    );
  }
  console.log('');
}

module.exports = { sessionToMemory, instanceToCase, brainBm25, DOWNLOAD_HINT };

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
