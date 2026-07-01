# Brain Memory Benchmark Report

**Date**: 2026-06-26
**Agent under test**: **DeepSeek V4 Pro** (single-shot, `deepseek-v4-pro`)
**Judge**: **Cross-family panel** — Gemini 2.5 Flash + Gemma-4 12B + Qwen-3.5 9B, majority vote (each criterion majority-voted)
**Runs per arm**: 3
**Scenarios**: A, B, C, D, F (E — continual — deferred)
**Distractor haystack**: up to 1000 deterministic memories (seed=42)

> **Sample-size caveat.** Run at **n=3 per arm**. The token differences are **directional, not
> statistically significant** (Mann–Whitney U is not significant at this sample size — see the 90% CIs
> in the stats file). The **pass-rate gradient is the result.** Two scenarios (C, F) are honest
> **nulls** — reported as-is rather than dropped.

This is the current A–F suite (2025–2026 long-term-memory methodology — LongMemEval, MemoryAgentBench,
Mem0/BEAM, SWE-Bench-CL). It supersedes the legacy 5-scenario report; see
[README.md](../README.md) for the full methodology and arm matrix, [REPRODUCE.md](../REPRODUCE.md)
to regenerate from a clean checkout, and [PREREGISTRATION.md](../PREREGISTRATION.md) for the committed
analysis plan. The canonical published copy of this run's raw JSON lives at
<https://brainmemory.ai/benchmarks/deepseek-v4-suite-2026-06-26.json>.

**Why single-shot?** The model receives the task plus whatever the arm injects (nothing, a retriever's
top-k, brain's `session-start` payload, or the oracle) and replies in one turn. This isolates
**memory's effect** — no agentic file exploration to rediscover conventions — and keeps token counts
clean and comparable (no cache-read inflation). It mirrors the Mem0 / LongMemEval framing.

## Scenario A — Noisy Project Folder (retrieval under 1000 distractors)

| Arm | tok/success | Recall@5 | rubric score | pass |
|---|---:|:---:|:---:|:---:|
| no-memory (floor) | — | — | 0.43 | 0% |
| vector (embeddings) | — | 0.00 | 0.33 | 0% |
| keyword (BM25) | — | 0.33 | 0.48 | 0% |
| **brain-full** | **3,199** | 0.67 | 1.00 | **100%** |
| brain-no-pin | 5,135 | 0.33 | 0.67 | 67% |
| brain-no-recall | 3,643 | — | 0.95 | 100% |
| oracle (ceiling) | 3,572 | 1.00 | 1.00 | 100% |
| context-dump 8k | 5,856 | — | 1.00 | 100% |
| context-dump 60k | 20,689 | — | 1.00 | 100% |

**Headline.** Under a 1000-distractor haystack, **brain is the only retrieval method whose memories let
the model succeed** — both BM25 (Recall@5 0.33) and a local vector store (Recall@5 0.00) fail to surface
the three oracle memories, and the model fails with them. Brain retrieves 2/3 (Recall@5 0.67), which is
enough to pass, and it does so at the **lowest tokens-per-success of any passing arm** (3,199 — below the
oracle's 3,572 and far below the 8k/60k dumps). Disabling the pinned tier drops brain to 67% and doubles
its Recall miss — the ablation that isolates pinning's value.

## Scenario B — Three Sessions, One Decision (continuity)

| Arm | tok/success | Recall@5 | rubric score | pass |
|---|---:|:---:|:---:|:---:|
| fixture-only (floor) | 2,546 | — | 0.62 | 67% |
| keyword (BM25) | 2,721 | 1.00 | 0.95 | 100% |
| **brain-real** | **1,871** | 1.00 | 1.00 | **100%** |
| brain-no-pin | 2,072 | 1.00 | 1.00 | 100% |
| oracle (ceiling) | 1,734 | 1.00 | 1.00 | 100% |

**Headline.** Postgres was decided across three sessions despite a discarded Mongo prototype. Brain
recalls it perfectly (Recall@5 1.0) and passes at the **fewest tokens-per-success of the memory arms**.
Here the haystack is small (100 distractors), so plain BM25 also retrieves the decision and passes — on
this scenario brain's edge is **efficiency, not correctness**.

## Scenario C — The Contradiction Test (tabs → spaces → tabs)

| Arm | tok/success | Recall@5 | rubric score | pass |
|---|---:|:---:|:---:|:---:|
| fixture-only (floor) | 1,218 | — | 0.78 | 67% |
| keyword (BM25) | 1,775 | 1.00 | 0.72 | 33% |
| brain-real | 1,572 | 1.00 | 0.83 | 67% |
| brain-no-pin | 1,058 | 1.00 | 0.83 | 67% |
| oracle (ceiling) | 915 | 1.00 | 0.83 | 67% |
| dump-all-chrono | 469 | — | 0.94 | 100% |

**Headline — an honest null.** Everything clusters near 67%. Indentation (tabs vs spaces) is a **noisy
signal to grade from a single-shot text reply**, and the arm that does best is `dump-all-chrono`, which
simply concatenates all three versions in time order so the latest (tabs) wins. Brain retrieves the final
decision (Recall@5 1.0) but doesn't convert that into a clear pass-rate win here. We report it rather than
hide it.

## Scenario D — Skill Progressive Disclosure (token efficiency)

| Arm | tok/success | rubric score | pass |
|---|---:|:---:|:---:|
| fixture-only (floor) | — | 0.33 | 0% |
| brain-skills L0 (index only) | — | 0.50 | 0% |
| **brain-skills loaded (L1)** | **1,580** | 1.00 | **100%** |
| brain-skills all-loaded | 2,289 | 1.00 | 100% |

**Headline.** Loading **just the one relevant skill** passes 100% at **1,580 tokens-per-success — ~31%
leaner** than dumping every skill body (2,289). The index-only (L0) and no-skills arms fail: a single-shot
model can't act on a skill *index* the way an agent would (read the index, then load the matching
`SKILL.md`). That on-demand load is exactly what the skills tier automates — and when it fires, it's both
correct and the cheapest passing arm.

## Scenario F — Abstention (no confabulation)

| Arm | tok/success | rubric score | pass |
|---|---:|:---:|:---:|
| fixture-only (floor) | 775 | 1.00 | 100% |
| keyword (BM25) | 1,238 | 0.89 | 67% |
| brain-real | 920 | 1.00 | 100% |
| oracle (ceiling) | 890 | 1.00 | 100% |

**Headline — a second honest null.** Asked to set up a deployment pipeline with no deployment target in
memory, DeepSeek **abstains correctly with or without brain** (100%) — the base model already declines to
invent a target. A noisy keyword retriever, which injects irrelevant top-k, actually drags it down to 67%.
Memory neither helps nor hurts abstention in this case.

## Reading the suite

Brain wins where it is designed to — **retrieval under heavy noise (A)** and **procedural-skill
efficiency (D)** — passing where the BM25 and vector baselines fail, at the lowest token cost among
passing arms. It is **efficient and competitive on continuity (B)**, and **neutral on contradiction (C)
and abstention (F)**, where the base model needs no memory. That mixed, baseline-anchored picture — floor,
oracle ceiling, real retriever baselines, and brain ablations on every scenario — is the point: the wins
are attributable to the memory system, and the nulls are reported honestly.

## Reproduce

The harness is deterministic up to model-provider non-determinism — the same scenario JSON + distractor
seed always produces the same memory pool.

```bash
# Full guide (prerequisites, environment pinning, run commands):
#   benchmark/REPRODUCE.md
node harness/summarize.js results/<file>.json   # regenerate any table above
node harness/analyze.js   results/<file>.json   # regenerate the statistics / CIs
```

## What's next

- More runs (5–10/arm) for statistical-confidence error bars on the token metric.
- Scenario E (continual coding, write-side `memorize`) validated end-to-end.
- A second agent under test (e.g. a stronger reasoning model) to separate memory effects from base-model
  competence.

---

*The legacy 5-scenario report (regex-graded, with/without-brain, "+18.3% consistency / +33.3% success")
described a superseded methodology and has been replaced by this suite. It remains recoverable from git
history for anyone reproducing historical numbers.*
