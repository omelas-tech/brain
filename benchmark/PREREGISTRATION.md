# Brain Memory Benchmark — Pre-Registration

> **Purpose.** This document fixes the hypotheses, arms, metrics, judging protocol, and statistical
> analysis plan **before** the confirmatory benchmark run, so results cannot be retrofitted to a
> narrative. It is the credibility backbone of the evaluation: anyone can check the run against this
> plan. Amendments are logged at the bottom with dates and rationale.
>
> **Status:** Draft v1 · **Pre-registered on:** _<fill on commit>_ · **Confirmatory run:** _pending_

Brain Memory is an open-source, file-system memory for AI coding agents (decay, spreading activation,
pinned tier, procedural skills). This benchmark asks one question with scientific discipline: **does it
actually help, and can we prove it against fair baselines?**

---

## 1. Claims & hypotheses

Four claims, in a causal ladder (each supports the next). Stated as falsifiable nulls (H0).

| ID | Claim | H1 (what we predict) | H0 (null) | Primary metric |
|----|-------|----------------------|-----------|----------------|
| **C1** | Retrieval quality | Brain ranks the oracle memories above distractors better than a vector store | Recall@5(Brain) = Recall@5(vector) | Recall@5, NDCG@5 |
| **C2** | Task-success uplift | Injecting Brain-retrieved memory raises judged success vs no memory | success%(Brain) = success%(no-memory) | judge pass-rate |
| **C3** | Token efficiency (hero) | Brain reaches success with fewer tokens than dumping context, at equal-or-higher success | tokens/success(Brain) = tokens/success(context-dump) | tokens-per-successful-task |
| **C4** | Longitudinal continuity | Across sessions, Brain retains decisions & resists contradiction where naive memory drifts | retention(Brain) = retention(baselines) | decision-retention, forward-transfer |

**Directionality is pre-committed:** C1 higher-is-better; C2 higher-is-better; C3 lower-is-better
(at non-inferior success); C4 higher-is-better.

**A claim is only reported as supported** if (a) the effect is in the predicted direction, (b) its 90%
CI excludes the null, (c) the Holm–Bonferroni-corrected p < 0.05, and (d) the effect size (Cliff's
delta) is at least "small". A number whose fair baseline beats Brain is reported as **not supported**,
verbatim — no cherry-picking the comparison.

---

## 2. Arms (fixed before the run)

**External baselines**
- `no-memory` — stock agent, zero persistence (the floor; C2).
- `context-dump-bounded` — dump prior memories up to a fixed **8,000-token** budget, then stop (the fair "just stuff the prompt" baseline; C3).
- `context-dump-unbounded` — dump everything, no cap (demonstrates the scaling wall; expected high no-completion).
- `vector-baseline` — local deterministic-embedding retriever over the same corpus, top-k injected (offline vector-store stand-in; C1/C3).
- `mem0` — real hosted vector store over the same corpus, top-k injected (gated on API keys; C1/C3).
- `oracle-ceiling` — inject exactly the hand-labeled oracle memories (upper bound; isolates retrieval from application).
- `keyword` — lexical retriever (corpus-hardness validator; if this already finds the oracles, the benchmark is too easy).

**Brain + ablations (component contribution)**
- `brain-full` — the shipped system (session-start payload, distractors, pin + skills).
- `brain-no-recall` — recall/spreading-activation disabled.
- `brain-no-pin` — pinned tier disabled (C4).
- `brain-no-decay` — flat strength, no Ebbinghaus weighting (C4 / contradiction).
- `brain-no-skills` — procedural skills disabled (Scenario D).

**Confound control:** every arm injects its memory into **one canonical context-block wrapper** (identical
header/delimiters/position). Only the *content* of the block varies across arms — never its structure.
Agent decoding is fixed (temperature 0 where the provider allows).

---

## 3. Scenarios

Six scenarios (A–F) plus a negative control. Each has a fixture project, a task, and a binary rubric.

| Scenario | Tests | Primary claim |
|---|---|---|
| A — Noisy folder | retrieval under 1–2k distractors | C1, C3 |
| B — Three sessions | multi-session decision continuity + pin | C4 |
| C — Contradiction | decay-weighted recency (which decision wins) | C4 |
| D — Skills | progressive disclosure token cost (L0/L1/L2) | C3 |
| E — Continual | forward transfer + agent writes its own memory | C2, C4 |
| F — Abstention | confabulation resistance (ask, don't invent) | C2 |
| **NEG — Control** | a task answerable from the fixture alone, where memory should **not** help | bias check |

**Negative control is mandatory:** if Brain "wins" on NEG, the suite is biased and positive results are
discounted accordingly. A flat NEG result is what licenses the positive ones.

**Corpus:** 1,000–2,000 deterministic distractor memories (seeded), power-law distributed across
projects/topics, including **hard negatives** (memories semantically adjacent to the oracle). Corpus
hardness is validated by requiring the `keyword` retriever's Recall@5 to be low.

---

## 4. Metrics (exact definitions)

Each run is classified into exactly one **outcome**:
- `COMPLETED_PASS` — agent finished AND judge rubric score ≥ 0.7.
- `COMPLETED_FAIL` — agent finished, rubric score < 0.7.
- `NO_COMPLETION` — timeout / crash / context-overflow; no gradeable output (carries a reason code).

Reported per arm × scenario × agent:
- **completion_rate** = (COMPLETED_PASS + COMPLETED_FAIL) / N — "did it finish at all?"
- **success_rate** = COMPLETED_PASS / N — "was it correct when it finished?"
- **no_completion_rate** = NO_COMPLETION / N — reported explicitly, never hidden as a blank.
- **median tokens** over completed runs, with **90% bootstrap CI**.
- **tokens-per-successful-task** = total tokens across all attempts / COMPLETED_PASS count (null, shown `—`, if zero passes).
- **Recall@k / NDCG@k** (k ∈ {1,3,5,10}) — fraction of oracle memory ids in the top-k of the retriever (C1).
- **forward-transfer** (continual scenarios) = median tokens(task 1) − median tokens(task last).

Single canonical null representation everywhere: `—`. No `∞`, no `N/A`, no bare `0` for missing data.

---

## 5. Judging protocol

- **Cross-family LLM judge.** Judge model is a different family than the agent under test (Claude judges
  Gemini/DeepSeek; Gemini judges Claude) to avoid same-family preference leakage (arXiv 2502.01534).
- **Rubric-only grading.** The judge sees the task + the binary rubric + the candidate output. It does
  **not** see the oracle answer at grade time (prevents keyword-matching the reference). The oracle
  answer is reserved for human validation only.
- **Per-criterion verdicts** recorded (which rubric items passed), not just the aggregate.
- **Candidate not truncated below 40,000 chars**; the relevant generated artifact is graded in full.
- **Judge validation.** Before trusting the judge, a sample of ≥50 runs is graded by 2–3 humans with the
  same rubric; we report **Cohen's/Fleiss' κ** (judge vs human). Target κ ≥ 0.6 ("substantial"). The
  benchmark's headline claims are conditional on passing this bar.
- **(Optional) dual-judge agreement** — grade with two families and report agreement; majority vote.

---

## 6. Statistical analysis plan

- **N = 10** runs per arm × scenario × agent for the confirmatory run (N ≥ 5 for the pilot).
- **Agents:** Claude (Sonnet), Gemini (Flash), OpenCode→DeepSeek. Codex included only if it reports token usage.
- **Point estimate:** median (robust to the skewed token/latency distributions).
- **Interval:** 90% bootstrap CI (10,000 resamples, seeded → reproducible).
- **Significance:** two-sided **Mann–Whitney U** for each pre-registered Brain-vs-baseline contrast.
- **Effect size:** **Cliff's delta** reported alongside every p-value (significant ≠ meaningful).
- **Multiple comparisons:** **Holm–Bonferroni** correction across the full family of pre-registered
  contrasts (the contrasts in §1, per scenario). No post-hoc contrasts are reported as confirmatory;
  any are labeled exploratory.
- **Stopping rule:** N is fixed in advance; we do not peek-and-extend to reach significance.

---

## 7. Threats to validity (acknowledged up front)

- **Internal:** prompt-structure confound → fixed canonical wrapper (§2); judge leakage → rubric-only (§5).
- **External:** synthetic scenarios → negative control + (future) a real-task scenario; single corpus → vary size/skew.
- **Construct:** does tokens/success measure "memory value"? → triangulated with success% + Recall + oracle-ceiling.
- **Statistical-conclusion:** small N / no correction → N=10, bootstrap CIs, non-parametric tests, Holm–Bonferroni.
- **Conflict of interest:** the authors commercialize Brain (Brain Cloud). Disclosed; the negative control,
  rubric-only human-validated judge, and this pre-registration are the safeguards that let a commercial
  author be believed.

---

## 8. What would falsify the claims

- **C1 falsified** if `vector-baseline`/`mem0` Recall@5 ≥ Brain's with overlapping CIs.
- **C2 falsified** if `no-memory` success% is statistically indistinguishable from `brain-full`.
- **C3 falsified** if `context-dump-bounded` reaches equal success at ≤ Brain's tokens/success.
- **C4 falsified** if Brain's decision-retention/forward-transfer does not exceed baselines across sessions.
- **Whole suite discounted** if the negative control shows a Brain advantage.

We commit to reporting falsified claims as falsified.

---

## Amendments log

| Date | Change | Rationale |
|------|--------|-----------|
| _<initial>_ | Pre-registration created | Baseline plan before confirmatory run |
