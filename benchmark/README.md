# Brain Memory Benchmark

Controlled benchmark proving that agents with persistent, retrieval-based memory **find the right context under noise**, **resolve contradictions correctly**, and **resolve tasks at a lower token-per-success cost** than agents without memory or with naïve context-dumping.

This is a redesign of the original benchmark (the legacy 5-scenario suite is archived — see §"Legacy 5"). The methodology follows the 2025-2026 SOTA in long-term-memory evaluation (LongMemEval, MemoryAgentBench, Mem0/BEAM, SWE-Bench-CL).

## TL;DR

- **6 scenarios**, each describable in one sentence (§"Scenario suite")
- **N-arm matrix** per scenario — production brain vs. ablations (no-pin, no-skills, no-recall) vs. baselines (bare, fixture-only, context-dump upper bound)
- **Cross-family LLM judge** with per-question rubric and position-swap (Claude judges Gemini and vice-versa — no preference leakage)
- **Distractor haystacks** — 50-200 plausible-but-irrelevant memories per scenario, so retrieval is non-trivial
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
| Codex CLI (no token reporting) | Can't compute tokens-per-success | Codex dropped; Claude + Gemini only. |

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
| `vector-baseline` | Local dense-embedding retriever (vector-store stand-in), top-k injected | "Architecture vs vector store" comparison (C1/C3) |
| `mem0` | Real hosted vector store (gated on `MEM0_API_KEY`), top-k injected | Hosted vector-store comparison |
| `context-dump-bounded` | Dump corpus up to a fixed token budget (`dump_budget_tokens`) | The FAIR "just stuff the prompt" baseline (C3) |
| `context-dump-unbounded` | Dump the whole haystack, no cap | The scaling wall — expect high `NO_COMPLETION` |
| `brain-full` | Full brain via `brain session-start`, distractor haystack, pin+skills on | What we ship |
| `brain-no-recall` | Oracle bodies prepended verbatim, no retrieval | Long-context vs retrieval value |
| `brain-no-pin` | `brain-full` with pinned tier disabled | CoALA Phase-1 attribution (C4) |
| `brain-no-skills` | `brain-full` with skills layer disabled | CoALA Phase-2 attribution |

All arms inject memory into ONE canonical context-block wrapper (`wrapContextBlock`) — identical header, delimiters, and position. Only the *content* varies, never the prompt structure, so a measured difference is attributable to memory, not framing. Each scenario picks the arms relevant to what it tests.

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
- `claude` and/or `gemini` CLIs installed
- `.env` file at `benchmark/.env` with `ANTHROPIC_API_KEY` and `GEMINI_API_KEY` (the judge needs at least one of each family)
- (optional) `MEM0_API_KEY` (+ an embeddings key) to enable the `mem0` hosted-vector-store arm; without it that arm records `NO_COMPLETION`. The `vector-baseline` arm needs no keys (local deterministic embeddings).

### Run

```bash
cd benchmark

# All 6 scenarios, all enabled agents
node harness/runner.js

# Single scenario
node harness/runner.js --scenario scenario-A

# Single agent
node harness/runner.js --agent claude

# Dry run — show plan only
node harness/runner.js --dry-run

# More runs (default 3 — raise to 5 for statistical confidence)
node harness/runner.js --runs 5
```

Cost guideline (3 runs of all 6 scenarios, both agents):
- Agent calls: ~$5-8 (Claude Sonnet + Gemini Flash)
- Judge calls: ~$1-2 (cross-family, ~70 judgments)
- **Total: ~$6-10 per full run**

Scenario E is the most expensive (5 tasks × N runs × per-task memorize prompt); the other five are single-prompt.

### Legacy 5

The original 5 scenarios are still on disk under `scenarios/scenario-1-*` through `scenario-5-*`. They have no `setup.arms[]` so the harness falls through to the legacy with_brain/without_brain code path. `config.json` no longer lists them in `scenarios[]` — use `--scenario scenario-1-continuity` to invoke them directly. They remain available for reproducing historical reports but are not part of the headline result.

## Methodology details

### Cross-family LLM judge

Defined in `harness/judge.js`. For every agent under test, the judge belongs to a different model family (Claude → judged by Gemini; Gemini → judged by Claude). Each judgment uses an explicit per-question rubric (binary criteria). Grading is **rubric-only by default** — the judge does NOT see the oracle answer at grade time (pass `includeOracle: true` to re-enable it), which stops the judge from keyword-matching the reference instead of reasoning about the rubric. The candidate output is graded up to 40K chars (not head-truncated to 12K, which used to hide proof of correctness). Pairwise judgments swap candidate positions and only keep verdicts that survive both orderings (mitigates position bias — arxiv 2509.20293). The oracle answer is reserved for **human validation** of the judge (Cohen's/Fleiss' κ on a sample), not for the judge itself.

### Distractor corpus

Defined in `harness/distractors.js`. Deterministic seeded RNG produces N plausible memories (scenario-A uses 1,000) across 6 fake projects, 12 topic clusters, 8 memory types. `generateHardNegatives()` additionally seeds memories that share an oracle's project/tags/topic but describe a *superseded* convention — similarity-only retrievers (keyword/vector) rank these high and get confused, while decay/recency-aware recall should down-rank them (they are old and rarely accessed). Enable via `hard_negatives: <perAnchor>` in a scenario's setup.json. The `keyword` arm doubles as a corpus-hardness check: if a lexical retriever already finds the oracles, the haystack is too easy.

### Retrieval scoring

`harness/recall-probe.js` shells out to `brain recall` (the real production CLI) and parses the JSON output. `Recall@k` and `NDCG@k` are computed against each scenario's `oracle_memory_ids[]`. This isolates *retrieval* failure from *application* failure — if Recall@5 = 1.0 but the judge fails, the agent had the memory and ignored it. The `keyword` / `vector-baseline` / `mem0` arms run their own retriever over the same corpus (`harness/retrievers/`) and are scored the same way — a like-for-like retrieval comparison.

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
