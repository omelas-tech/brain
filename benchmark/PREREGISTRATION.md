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
| 2026-07-05 | Token metric made **cache-honest**: `tokens.input` = full prompt (provider cache hits + misses + creation); cache split recorded separately (`tokens.input_cached`, `cached_token_samples`) | DeepSeek's /anthropic endpoint reports only cache-miss tokens in `input_tokens` (verified: run 1 = 55,338, runs 2–3 ≈ 3,140 for the identical prompt). The old accounting undercounted repeat runs ~20× and biased tokens-per-success toward whichever arm ran after a cache warm-up. A token is a token whether or not the provider discounted it; the split is preserved for $-cost analysis. Applied BEFORE the confirmatory run. |
| 2026-07-05 | Scenario A/B/C rubrics tightened so a pass **requires the needle facts from the oracle memories** (each criterion names the concrete fact; generic best-practice criteria can no longer carry a pass) | Pilot evidence: A `brain-no-recall` 3/3 and `keyword` (R@5=0.33) 2/3; B `fixture-only` 2/3; C `fixture-only` 2/3 — all achievable with zero memory, so recall was not load-bearing. D already discriminates (fixture-only 0/3); E measures forward transfer (memory-free pass is by design); F is the abstention control (exempt by design). Applied BEFORE the confirmatory run. |
| 2026-07-05 | `config.json` `runs_per_scenario` set to the pre-registered N = 10 (was 3, a March-era pilot leftover) | §6 fixes N = 10 for the confirmatory run; n = 3 yields ~zero power (all Holm-corrected p ≈ 1.0 in the 2026-07-04 pilot). |
| 2026-07-05 | Judge panel: `gemma4:12b` + `qwen3.5:9b` (local Ollama) replaced by `claude-sonnet-5` + `claude-haiku-4-5` (Anthropic API); `gemini` seat bumped to `gemini-3.5-flash` (2.5 was a March-era pin). Rationale: local judging was ~80% of per-run wall-clock and the 9–12B judges are the panel's weakest scorers. Agent-family independence unchanged (agent = DeepSeek; no judge shares its family). Disclosed pair-correlation moves from Google lineage (gemma/gemini) to Anthropic lineage (sonnet/haiku). The 2026-07-05 00:20 campaign (Scenario A complete, B partial, old panel) was aborted and quarantined in `results/_aborted-20260705-ollama-panel/` — no confirmatory analysis was run on it. |
| 2026-07-05 (2nd) | Judge panel again: Anthropic seats (`claude-sonnet-5`, `claude-haiku-4-5`) replaced by `gemini-2.5-pro` + `gemini-3.1-flash-lite` (with `gemini-3.5-flash` retained) after the Anthropic account was flagged as having no budget headroom mid-campaign — a judge panel that can die of credit exhaustion mid-run is worse than a disclosed monoculture. All-Google panel limitation disclosed in config; agent-family independence intact. The 08:05 campaign (35 runs, Scenario A baselines, mixed panel) was aborted; no aggregates had been written. |
| 2026-11-08 | Judge panel: `gemini-3.1-flash-lite` seat replaced by `claude-haiku-5-5` (Anthropic API); `gemini-3.5-flash` + `gemini-2.5-pro` retained. Harness `callAnthropic` now omits `temperature` for models that reject it (Haiku 5.5 deprecates the parameter), so this seat runs at the model's default sampling. | Ends the all-Google judge monoculture disclosed in the previous amendment. The Anthropic budget risk that forced that amendment is addressed by Max-plan monthly API credits; the seat is cheap enough ($0.10/$0.50 per MTok) that a full campaign stays well inside one cycle. No confirmatory scenario campaign has run since 2026-07-05, so no results are mixed across panels. Remaining limitation: the two Gemini seats are correlated and can form a majority on their own. |
| 2026-11-08 (2nd) | Agent + judge output budgets, set before the confirmatory run: DeepSeek V4 Pro agent `max_tokens` 8192 → 32768; a run that exhausts the budget with no answer text is now `NO_COMPLETION` (reason `budget`), never a judged FAIL. Gemini judge `maxOutputTokens` 2000 → 8192. | Pilot (3 arms × scenario A, quarantined in `results/_pilot-20261108/`) showed v4-pro spending all 8192 tokens on thinking in every arm and returning empty text, which the panel graded as FAIL — an adapter artifact, not a memory result. Gemini 2.5 Pro's thinking counts against its output cap and truncated a 7-criterion verdict mid-JSON. After the fix, the same candidate re-judged 3× gave 3 valid verdicts each with ≥67% agreement. No pilot data enters the analysis. |
| 2026-11-10 | **Agent under test: Claude Sonnet 5.5** (`claude-sonnet-5-5`, single-shot via the direct Messages API — new adapter `agents/claude-direct.js`; no Claude Code CLI, so no CLI system prompt, tools, hooks or auto memory enter any arm). Judge panel: `gemini-3.5-flash` + `gemini-2.5-pro` + `deepseek-v4-pro` (the `claude-haiku-5-5` seat is removed — no judge may share the agent's family). `dense` arm excluded (no valid embeddings key). Runner checkpoints each arm (`BENCH_PARTIAL_DIR`). | The DeepSeek V4 Pro confirmatory campaign of 2026-11-08 was stopped by the budget kill switch on a setup error (invalid OpenAI key for `dense`) after C, D and F completed; A, B and G results were lost because results were only written per scenario. Rather than re-buy them on DeepSeek, the confirmatory run moves to the model brain-memory's users actually run, funded by Max-plan API credit (\$40/month workspace cap). The completed DeepSeek C/D/F results are kept in `results/_deepseek-campaign-20261108/` and reported only as a secondary-model comparison, never pooled with Sonnet. A 3-run Sonnet pilot (scenario A, quarantined, not analyzed) validated the adapter and panel: all 9 verdicts valid. |
| 2026-11-10 (2nd) | Two harness defects found on inspection of the Sonnet run, before any analysis was published; the four affected arm×scenario cells are **re-run in full** and the original cells discarded (kept on disk, marked superseded): (1) `brain-connector-gated` (A, B) passed recalled memory **ids without their text** to the model — `brain recall` returns metadata only; the arm now reads each recalled memory file, and aborts if content is empty. (2) Claude API **safety refusals** (`stop_reason: refusal`, category `cyber`) on prompts containing the poisoned memory (G: `brain-no-quarantine`, `context-dump-bounded`) were scored as judged FAILs of an empty answer; they are now `NO_COMPLETION` with reason `refusal`, reported separately, never judged. | Both defects make an arm measure the harness, not memory. Found by checking two implausible patterns (Recall@5 1.00 with 0% success; identical token counts across 10 sampled runs). Fix verified by a 1-run pilot (quarantined): memory text present, panel 3/3. No other arm's prompt path uses either code path. |
