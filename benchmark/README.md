# Brain Memory Benchmark

Controlled benchmark proving that agents with persistent, retrieval-based memory **find the right context under noise**, **resolve contradictions correctly**, and **resolve tasks at a lower token-per-success cost** than agents without memory or with naïve context-dumping.

This is a redesign of the original benchmark (the legacy 5-scenario suite is archived — see §"Legacy 5"). The methodology follows the 2025-2026 SOTA in long-term-memory evaluation (LongMemEval, MemoryAgentBench, Mem0/BEAM, SWE-Bench-CL).

## TL;DR

- **6 scenarios**, each describable in one sentence (§"Scenario suite")
- **N-arm matrix** per scenario — production brain vs. ablations (no-pin, no-skills, no-recall) vs. baselines (bare, fixture-only, context-dump upper bound)
- **Cross-family judge panel** with per-question rubric and majority vote — agent under test = **DeepSeek V4 Pro** (single-shot), judged by **Gemini + Gemma-4 + Qwen-3.5** (none sharing the agent's family, no preference leakage)
- **Distractor haystacks** — 50-1000 plausible-but-irrelevant memories per scenario, so retrieval is non-trivial
- **Tokens-per-successful-task** as the headline efficiency metric, alongside **Recall@k** and **judge pass rate**
- **Write-side cost** (memorize + sleep + skill distillation) co-reported as a separate axis

## What changed vs the legacy suite

| Old methodology | Problem | New methodology |
|---|---|---|
| Memories prepended verbatim into the prompt (`buildMemoryContext`) | Tests long-context, not memory. Brain's recall/pin/skills layers never touched. | Each arm declares `memory_injection`; default is `session-start` (shells out to the real `brain` CLI). |
| ≤5 oracle memories per scenario, all relevant | Zero retrieval pressure — recall trivially perfect. | `seed: "scenario+distractors"` adds 50-200 deterministic plausible distractors per scenario. |
| Regex pattern matching for pass/fail | Gameable, ceiling/floor artifacts. | Cross-family LLM judge with explicit per-question rubric + position-swap. |
| Headline metric: "+18% consistency, +33% success" with token overhead apologized for | Wrong framing. | Headline: **tokens-per-successful-task** + **Recall@k** + **judge pass rate**. |
| Two arms: with/without brain | Couldn't attribute gains to specific features. | 4-6 arms per scenario including per-feature ablations. |
| Codex CLI (no token reporting) | Can't compute tokens-per-success | Codex dropped. Agent under test = DeepSeek V4 Pro (single-shot); judged by a Gemini + Gemma-4 + Qwen-3.5 panel. |

## Scenario suite

| Id | Pitch | What it tests |
|---|---|---|
| **A** *Noisy Project Folder* | "Your brain has 200 memories from 6 projects. I ask you to add a feature to project X. Do you find the 3 relevant memories?" | Retrieval under distractors (LongMemEval-S analog) |
| **B** *Three Sessions, One Decision* | "On Monday we picked Postgres. On Wednesday I rewrote the API. On Friday I add a new resource — does it still use Postgres?" | Multi-session continuity + pinned tier ablation |
| **C** *The Contradiction Test* | "Three weeks ago I told you tabs. Two weeks ago, spaces. Last week, tabs again. New file — which do you use?" | Decay-weighted recency + contradiction handling |
| **D** *Skill Progressive Disclosure* | "You have a `pg-migration` skill. I ask you to add a migration. Did you load the full SKILL.md, or just see the index entry and ignore it?" | CoALA Phase-2 L0/L1/L2 token efficiency |
| **E** *Continual Coding* | "Five async bugs in the same repo, in order. Does session 5 finish faster because of sessions 1-4?" | Forward transfer + tokens per resolved task. The agent writes its own memories via the brain CLI between bugs — exercises the WRITE side end-to-end. |
| **F** *Abstention* | "I never told you my deployment target. Where do you deploy this?" | Confabulation resistance — does the agent invent details or recognize the gap? |

## The arm matrix

| Arm | What it does | What it isolates |
|---|---|---|
| `no-memory` | Stock agent, fixtures only, zero persistence | The floor (C2) |
| `oracle-ceiling` | Inject exactly the labeled oracle memories | Upper bound — separates retrieval quality from application |
| `keyword` | Lexical/BM25 retriever over the corpus, top-k injected | Corpus-hardness validator (if it finds the oracle, the haystack is too easy) |
| `vector-baseline` | Hashed bag-of-words in vector geometry, top-k injected | Vector-store *shape* without a model — deterministic, offline, no keys. **Not semantic** |
| `dense` | **Real** embedding model, plain cosine, no vector store (gated on `BRAIN_EMBED_URL` / `OPENAI_API_KEY`) | Isolates SEMANTICS. The only arm that answers "would embeddings beat BM25 on this corpus?" |
| `mem0` | Real hosted vector store (gated on `MEM0_API_KEY`), top-k injected | Hosted vector-store comparison |
| `context-dump-bounded` | Dump corpus up to a fixed token budget (`dump_budget_tokens`) | The FAIR "just stuff the prompt" baseline (C3) |
| `context-dump-unbounded` | Dump the whole haystack, no cap | The scaling wall — expect high `NO_COMPLETION` |
| `brain-full` | Full brain via `brain session-start`, distractor haystack, pin+skills on | What we ship *locally* — always-on ranked injection |
| `brain-connector-gated` | Same corpus, but the MODEL decides whether to call recall and with what query | What we ship *hosted* — the connector's tool-gated policy |
| `brain-no-recall` | Oracle bodies prepended verbatim, no retrieval | Long-context vs retrieval value |
| `brain-no-pin` | `brain-full` with pinned tier disabled | CoALA Phase-1 attribution (C4) |
| `brain-no-skills` | `brain-full` with skills layer disabled | CoALA Phase-2 attribution |

All arms inject memory into ONE canonical context-block wrapper (`wrapContextBlock`) — identical header, delimiters, and position. Only the *content* varies, never the prompt structure, so a measured difference is attributable to memory, not framing. Each scenario picks the arms relevant to what it tests.

### Why `brain-connector-gated` exists

Brain ships two retrieval **policies**, and until this arm only one of them was measured.

The local plugin injects ranked memory at session start, unconditionally. The hosted MCP connector instead advertises memory as tools and lets the model decide whether to call `brain_recall` — so a Claude.ai user gets *gating*, not always-on recall. Every other `brain-*` arm uses `session-start` or `dump-bodies` injection, which means the connector's real behaviour went unmeasured.

That matters because the one external result we have points the wrong way: Druga (Sakana AI, 2026) tested a policy ladder on local models and found a ranked ledger beat *"just gating the harness by saying do you need to use memory or do you not need to use memory."* If that holds here, the connector is on the losing side of it and the fix is architectural, not cosmetic.

The arm models the policy, not the transport. It runs two phases against the same agent:

1. **Gate** — the model sees the connector's real `instructions` string and `brain_recall` description (copied verbatim from `connector/src/server.ts`, and no memory content), plus the task, and returns `{"recall": bool, "query": str}`.
2. **Recall** — if it said yes, the engine runs with *its own* query, not the scenario's curated `recall_query`. A self-authored query is part of what the policy costs.

Two properties keep the comparison honest:

- **The gate call's tokens are charged to the arm.** Gating is not free, and `tokens_per_success` has to show that.
- **Declining scores as a retrieval miss (recall@k = 0), not `null`.** The oracle was there to be fetched and wasn't. Scoring it as "not measured" would quietly drop the arm from recall comparisons and flatter the policy.

Each run records a `gate` block (`invoked`, `query`, `declined`, `parse_failed`, `hits`) so the two failure modes stay separable: *declined to look* is a prompt/architecture problem, *looked with a bad query* is a tool-description problem. They have different fixes.

Pair it with `brain-full` on the same corpus and distractor size — that pairing is the A/B, and it is set up that way in `scenario-A-noisy-folder` and `scenario-B-three-sessions`.

## Retrieval-only pilot (no agent, no LLM spend)

`node harness/retrieval-only.js [--scenario A] [--distractor-size N] [--json]`

Scores Recall@k for every retriever against a scenario's `oracle_memory_ids`
without generating a token. Ranks the **whole** corpus, so a miss at rank 11 and
a miss at rank 900 are distinguishable — a top-k cutoff renders both as a miss
and hides which retrieval methods are close.

### First run — 2026-08-21, scenario A, nomic-embed-text via Ollama

| retriever | oracle ranks (of 1021) | R@10 |
|---|---|---|
| `keyword` (BM25) | 21, 20, **1** | 0.33 |
| `brain-bm25` (Brain's own relevance fn) | 21, 20, **1** | 0.33 |
| `dense` (real embeddings, plain) | 45, 20, 15 | 0.00 |
| `dense` (with nomic `search_query:`/`search_document:` prefixes) | 21, 20, 8 | 0.33 |
| `vector-baseline` (hashed bag-of-words) | 260, 221, 45 | 0.00 |

Three findings, all load-bearing:

1. **Real embeddings do not beat BM25 on this corpus.** At best (with the task
   prefixes the model expects) dense ties BM25 on two oracles and still loses
   the third, 8 vs 1. This is the decision gate for adding a semantic stream to
   the production scorer, and it currently reads *no* — the recall dependency,
   the model download, and the determinism caveats do not buy a rank.
   Caveat: **n=1 query, one scenario, synthetic distractors.** Widen before
   treating it as settled; the prior has moved, not closed.

2. **`brain-bm25` is rank-identical to `keyword`.** Brain's field weighting
   (title 3x, tags 2x) and stemmer buy nothing here. Whatever advantage the
   `brain-full` arm shows over these baselines is therefore **not** coming from
   the relevance function — it comes from decay, spreading activation, context
   match, and pinning. That is where the moat is, and it is where ablations
   should aim.

3. **`vector-baseline` badly understates a real vector store** (260/221/45 vs
   45/20/15). It is a hashed bag-of-words, as its own docstring says. Any
   "Brain vs vector store" claim resting on that arm is unsupported — use
   `dense` for that comparison, and read `vector-baseline` only as a lexical
   control in vector geometry.

## LongMemEval-S (public benchmark)

`node harness/longmemeval.js [--limit N] [--type <question-type>] [--json]`

Brain's A–F suite is a better instrument than most published memory evals, and
it is also *ours* — which means Brain appears in nobody's comparison table.
This adapter scores the **retrieval half** of LongMemEval-S, which needs no LLM
at all: each instance ships ~48 haystack sessions with the evidence sessions
labelled, so Recall@k is computable offline across all 500 questions in ~16
seconds.

The dataset is not vendored (265MB, not ours to redistribute, and the cleaned
revision moves):

```bash
mkdir -p benchmark/data && cd benchmark/data
wget https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json
```

### Result — 2026-08-21, all 500 instances

| retriever | R@1 | R@3 | **R@5** | R@10 | NDCG@5 |
|---|---|---|---|---|---|
| `keyword` (BM25) | 0.558 | 0.855 | **0.909** | 0.947 | 0.881 |
| `brain-bm25` (Brain's relevance fn) | 0.551 | 0.853 | **0.909** | 0.941 | 0.878 |

By question type (`brain-bm25`):

| Question type | n | R@5 | R@10 |
|---|---:|---:|---:|
| single-session-assistant | 56 | 1.000 | 1.000 |
| single-session-user | 70 | 0.986 | 0.986 |
| **knowledge-update** | 78 | **0.974** | 0.981 |
| temporal-reasoning | 133 | 0.864 | 0.910 |
| multi-session | 133 | 0.860 | 0.917 |
| single-session-preference | 30 | 0.800 | 0.867 |

### Dense vs BM25 on the same instances

Same 50 instances, all three arms (`nomic-embed-text` via Ollama):

| retriever | R@1 | R@3 | R@5 | R@10 | NDCG@5 |
|---|---|---|---|---|---|
| `keyword` (BM25) | 0.940 | 0.960 | **1.000** | 1.000 | 0.966 |
| `brain-bm25` | 0.920 | 0.960 | **1.000** | 1.000 | 0.958 |
| `dense` (real embeddings) | 0.620 | 0.820 | **0.860** | 0.900 | 0.759 |

Dense loses by 14 points at R@5 and **32 points at R@1**. Together with the
scenario-A pilot this is the second independent corpus on which real embeddings
fail to beat BM25 for this workload — the decision gate for adding a semantic
stream to the production scorer reads *no*, twice.

*Confound, stated:* `nomic-embed-text` has a 2048-token context and
LongMemEval sessions are long transcripts, so documents are truncated. A
chunk-then-pool pipeline would score better. That is not a free fix though —
it is the chunking, storage, and re-ranking machinery this project exists to
avoid, and it would have to beat BM25 by enough to justify all of it.

**Read this carefully before quoting it.**

- **The metric is evidence-*session* Recall@k, macro-averaged over instances.**
  Published leaderboard numbers are often end-to-end QA accuracy (answer
  generated, then judged) or chunk-level recall. Those are different quantities.
  Do not put 0.909 in a table next to a 94.4 QA score and imply they measure the
  same thing.
- **This is retrieval only** — no answer generation, no judge, no reader model.
  That is deliberate: it isolates the memory system from the LLM reading its
  output, which is what a memory benchmark should be measuring. It is also
  cheap enough to run on every commit.
- **The mapping is unflattering to Brain.** LongMemEval haystacks are raw chat
  transcripts; Brain's model is *distilled* memories with tags, an encoding
  context, an associative graph, and a pinned tier. One session becomes one
  "memory" here, which is the standard comparison but strips every layer above
  relevance. Treat this as a floor.
- 33 abstention instances (`_abs`, no evidence session) are excluded — Recall@k
  is undefined for them, and scoring them as 0 would silently drag every arm
  down.

Two things worth noticing. **`knowledge-update` at 0.974** is the category
where a fact changes over time — the one Mem0's own 2026 report names as an
unsolved problem — though note this measures *finding* the evidence, not
resolving which version is current (that is what bitemporal recall does, and it
is not what this metric scores). And **`brain-bm25` ties plain `keyword` again**
(0.909 vs 0.909), reproducing the scenario-A finding at 500× the scale: Brain's
field weighting and stemming are not where its advantage lives.

## Decay calibration

`node harness/decay-calibration.js [--min-n N] [--json]`

The strength/decay table (decision 0.995/day, insight 0.997, observation 0.950,
…) was **designed, not measured**. This tool checks it against a real brain.

A decay rate implies a half-life — `ln(0.5) / ln(rate)`. Reinforcement records
the observed interval between recalls. The ratio of the two, per memory type,
says whether a constant is doing its job:

| ratio | meaning |
|---|---|
| ≪ 1 | Memories are re-recalled long before they decay. The rate is decorative. |
| ≈ 1 | Interval and half-life agree. The constant is doing what it was meant to. |
| ≫ 1 | Memories stay useful past their half-life. The rate is too aggressive. |

### Status — 2026-08-21: not fittable yet, and here is why

Running it against a real 255-memory brain returns **0 observed intervals**.

`recall_history` was declared in the memory schema, documented in all six agent
prompt files and three docs pages — and **never written**. `bin/memorize.js`
initialised it to `[]` and nothing appended to it; `brain reinforce` updated
`access_count` and `last_accessed` but not the series. So the brain knew a
memory had been recalled *N times* and never *when*, and the interval is the
entire signal.

That is now fixed (`bin/reinforce.js` appends a capped row per reinforcement:
timestamp, interval, strength before/after). Calibration becomes possible as
brains accumulate real recalls over real elapsed time — it cannot be
back-filled, because the timestamps never existed.

**A hypothesis to test once data exists:** at 0.995/day a decision's half-life
is **138 days**, and an insight at 0.997 is **231 days**. If typical recall
cadence is days-to-weeks, the ratio will be far below 0.25 for most types —
meaning decay is not meaningfully participating in ranking, and the parameter
that gives the product its name is mostly decorative. Worth knowing either way.

## Metrics

Every run resolves to exactly one **outcome** — no more timeouts hidden as a blank `0 | 0` cell:

- `COMPLETED_PASS` — agent finished AND judge rubric ≥ 0.7
- `COMPLETED_FAIL` — agent finished, rubric < 0.7
- `NO_COMPLETION` — timeout / crash / context-overflow (carries a reason code)

Reported per arm × scenario × agent:

1. **completion_rate** vs **success_rate** — kept SEPARATE. A timeout dents completion, never the token economy. `no_completion_rate` is shown explicitly, never as a blank. (This is the fix for the old "naive dump times out → blank cell" problem — it now reads as a *finding*: the baseline can't finish.)
2. **Median tokens** (over completed runs) with a **90% bootstrap CI**, and **tokens-per-successful-task** = total tokens / passes (`—` when zero passes — never `∞`).
3. **Retrieval Recall@k / NDCG@k** — for retriever arms, did the oracle IDs surface in the top-k against `setup.oracle_memory_ids`?
4. **Per-criterion pass rate** and **judge rationale** — which rubric items passed, plus the judge's verbatim reasoning.

Plus, where applicable: **per-task pass rate** (Scenario E), **forward-transfer Δ tokens** (E), **confabulation rate** (F). A single canonical null symbol (`—`) is used everywhere. See `PREREGISTRATION.md` for the committed metric definitions.

## Quick start

### Prerequisites

- Node.js ≥ 18
- **Agent under test:** `DEEPSEEK_API_KEY` in `benchmark/.env` (DeepSeek V4 Pro, single-shot via `harness/agents/deepseek-direct.js`). The agent is set by `config.json` → `enabled_agents`.
- **Judge panel:** `GOOGLE_API_KEY` (Gemini) plus a local [Ollama](https://ollama.com) running `gemma4:12b` and `qwen3.5:9b`. The panel is configured in `config.json` → `judges`; swap any member there. No judge may share the agent's family.
- (optional) `BRAIN_EMBED_URL` **or** `OPENAI_API_KEY` / `BRAIN_EMBED_KEY` to enable the `dense` arm. It speaks the OpenAI `/v1/embeddings` wire format, so it runs against OpenAI, Ollama, llama.cpp, LM Studio, vLLM, or HF text-embeddings-inference unchanged — point `BRAIN_EMBED_URL` at a local server and no key is needed. Tune with `BRAIN_EMBED_MODEL` (default `text-embedding-3-small`) and `BRAIN_EMBED_BATCH` (default 128).
- (optional) `MEM0_API_KEY` (+ an embeddings key) to enable the `mem0` hosted-vector-store arm; without it that arm records `NO_COMPLETION`. The `vector-baseline` arm needs no keys (hashed bag-of-words, computed locally).

### Run

```bash
cd benchmark

# All 6 scenarios, all enabled agents
node harness/runner.js

# Single scenario
node harness/runner.js --scenario scenario-A

# Single agent (override config.enabled_agents)
node harness/runner.js --agent deepseek

# Dry run — show plan only
node harness/runner.js --dry-run

# More runs (default 3 — raise to 5 for statistical confidence)
node harness/runner.js --runs 5
```

Cost guideline (3 runs of all 5 active scenarios):
- Agent calls: a few $ of DeepSeek V4 Pro (single-shot, ~85 calls)
- Judge calls: ~free — two judges are local Ollama; only Gemini is metered (~255 judgments)
- The local judges are the wall-clock bottleneck (~2 min/judgment), not the cost

Scenario E is the most expensive (5 tasks × N runs × per-task memorize prompt); the other five are single-prompt.

### Legacy 5

The original 5 scenarios are still on disk under `scenarios/scenario-1-*` through `scenario-5-*`. They have no `setup.arms[]` so the harness falls through to the legacy with_brain/without_brain code path. `config.json` no longer lists them in `scenarios[]` — use `--scenario scenario-1-continuity` to invoke them directly. They remain available for reproducing historical reports but are not part of the headline result.

## Methodology details

### Cross-family judge panel

Defined in `harness/judge.js` and configured in `config.json` → `judges`. The agent is graded by a **panel of three judges, every one from a different family than the agent** (DeepSeek → Gemini + Gemma-4 + Qwen-3.5). A candidate **passes only on a majority vote**, and **each rubric criterion is decided by majority** across judges, so a single small-model judge's noise is averaged out (`judgePanel` stores every per-judge verdict + the agreement). A panel of disjoint-family judges beats a single large judge on human agreement with less intra-model bias ([PoLL, arxiv 2404.18796](https://arxiv.org/abs/2404.18796)); cross-family avoids preference leakage ([2502.01534](https://arxiv.org/abs/2502.01534)).

Each judgment uses an explicit per-question rubric (binary criteria). Grading is **rubric-only by default** — the judge does NOT see the oracle answer at grade time (pass `includeOracle: true` to re-enable it), which stops the judge from keyword-matching the reference. The candidate is graded up to 40K chars (not head-truncated). Pairwise judgments swap candidate positions and only keep verdicts that survive both orderings (swap-consistency, [MT-Bench 2306.05685](https://arxiv.org/abs/2306.05685)). Local Ollama judges run with `think:false` (reasoning models otherwise spend the whole budget thinking and return empty JSON) and `format:'json'`; the two local models run sequentially to fit in memory.

### Distractor corpus

Defined in `harness/distractors.js`. Deterministic seeded RNG produces N plausible memories (scenario-A uses 1,000) across 6 fake projects, 12 topic clusters, 8 memory types. `generateHardNegatives()` additionally seeds memories that share an oracle's project/tags/topic but describe a *superseded* convention — similarity-only retrievers (keyword/vector) rank these high and get confused, while decay/recency-aware recall should down-rank them (they are old and rarely accessed). Enable via `hard_negatives: <perAnchor>` in a scenario's setup.json. The `keyword` arm doubles as a corpus-hardness check: if a lexical retriever already finds the oracles, the haystack is too easy.

### Retrieval scoring

`harness/recall-probe.js` shells out to `brain recall` (the real production CLI) and parses the JSON output. `Recall@k` and `NDCG@k` are computed against each scenario's `oracle_memory_ids[]`. This isolates *retrieval* failure from *application* failure — if Recall@5 = 1.0 but the judge fails, the agent had the memory and ignored it. The `keyword` / `vector-baseline` / `dense` / `mem0` arms run their own retriever over the same corpus (`harness/retrievers/`) and are scored the same way — a like-for-like retrieval comparison.

### Statistical analysis & reproducibility

The full analysis plan is pre-committed in `PREREGISTRATION.md` (hypotheses C1–C4, arms, metrics, stopping rule). After a run, `harness/analyze.js` turns the raw per-arm `token_samples` into publishable statistics:

```bash
node harness/analyze.js results/benchmark_<ts>.json --reference brain-full
```

It writes a `*_stats.md` with, per scenario × agent: a **90% bootstrap CI** on each arm's median tokens, **Mann–Whitney U** (reference vs each baseline), **Cliff's delta** effect size, and a **Holm–Bonferroni** correction across the contrast family. The primitives live in `harness/stats.js` (dependency-free, deterministic, unit-tested). A claim counts as supported only if the effect is in the predicted direction, its CI excludes the null, the Holm-corrected p < 0.05, and Cliff's delta is at least "small". A number whose fair baseline beats Brain is reported as not supported.

### Continual mode (Scenario E)

`setup.continual = true` activates a different execution path in `harness/arm-runner.js`:

1. ONE persistent workspace per (agent, arm) — no cleanup between tasks.
2. Each task runs with a fresh `brain session-start` injection.
3. Between tasks, the agent is prompted to call the brain CLI to memorize lessons learned. This is the WRITE-side test — if the agent doesn't write, task N+1 sees nothing in `session-start`.
4. Judged per-task; aggregated into per-task pass rate + forward-transfer Δ tokens.

## File structure

```
benchmark/
├── README.md                              # this file
├── config.json
├── harness/
│   ├── runner.js                          # top-level orchestrator
│   ├── arm-runner.js                      # NEW: N-arm execution + continual mode
│   ├── judge.js                           # NEW: cross-family LLM judge
│   ├── recall-probe.js                    # NEW: brain recall + session-start probe
│   ├── distractors.js                     # NEW: deterministic 200-memory haystack
│   ├── seeder.js, brain-setup.js, env.js, agents/, metrics.js, evaluator.js,
│   └── reporter.js, formatter.js          # (extended to render arm-shape results)
├── scenarios/
│   ├── scenario-A-noisy-folder/
│   ├── scenario-B-three-sessions/
│   ├── scenario-C-contradiction/
│   ├── scenario-D-skills/
│   ├── scenario-E-continual/
│   ├── scenario-F-abstention/
│   └── scenario-{1..5}-…/                 # archived legacy
└── results/                               # generated output
```

## References

### Foundations

Brain Memory is a direct implementation of the **CoALA** agent-memory model. The benchmark's `brain-no-pin` arm ablates CoALA Phase 1; `brain-no-skills` ablates CoALA Phase 2.

- **CoALA — Cognitive Architectures for Language Agents** ([arxiv 2309.02427](https://arxiv.org/abs/2309.02427)) — Sumers, Yao, Narasimhan, Griffiths (Princeton, 2023). The agent-memory taxonomy Brain implements.
- **MemGPT — LLMs as Operating Systems** ([arxiv 2310.08560](https://arxiv.org/abs/2310.08560)) — Packer et al. Paging-style memory management that motivated the budget-bounded session-start aggregator.
- **Generative Agents** ([arxiv 2304.03442](https://arxiv.org/abs/2304.03442)) — Park et al. Recency · importance · relevance retrieval blend that underlies Brain's scoring.
- **Ebbinghaus — Über das Gedächtnis** (1885). Original forgetting curve.

### Memory benchmarks (this suite follows)

- **LongMemEval** ([arxiv 2410.10813](https://arxiv.org/abs/2410.10813)) — distractor haystacks (S / M / Oracle), abstention category, GPT-4o judge with 97% human agreement. Direct analog for Scenarios A and F.
- **MemoryAgentBench** ([arxiv 2507.05257](https://arxiv.org/abs/2507.05257)) — four-competency framework. FactConsolidation inspired Scenario C.
- **SWE-Bench-CL** ([arxiv 2507.00014](https://arxiv.org/abs/2507.00014)) — repo-scoped chronological evaluation with forward-transfer / forgetting metrics. Template for Scenario E.
- **Mem0 / BEAM** ([arxiv 2504.19413](https://arxiv.org/abs/2504.19413)) — tokens-per-query co-reported with accuracy. Source of the tokens-per-successful-task headline metric.
- **LoCoMo** ([arxiv 2402.17753](https://arxiv.org/abs/2402.17753)) — long-conversation memory benchmark; considered solved since 2025.
- **MIRIX** ([arxiv 2507.07957](https://arxiv.org/abs/2507.07957)) — realistic synthetic-but-grounded memory benchmarks.

### Methodology — judging and benchmark hygiene

- **Preference Leakage in LLM-as-judge** ([arxiv 2502.01534](https://arxiv.org/abs/2502.01534)) — why same-family judging fails. Drives the cross-family judge map.
- **When Judgment Becomes Noise — position bias** ([arxiv 2509.20293](https://arxiv.org/abs/2509.20293)) — empirical position-bias study. Drives position-swap mitigation.
- **Silent Judge — shortcut bias** ([arxiv 2509.26072](https://arxiv.org/abs/2509.26072)) — drives rubric-only judging (oracle answer withheld from the judge at grade time).
- **LastingBench** ([arxiv 2506.21614](https://arxiv.org/abs/2506.21614)) — benchmark-leakage defense. Why the distractor pool is deterministic synthetic data.
