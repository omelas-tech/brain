# Reproducing the Brain Memory Benchmark

This is the one-stop guide to running the benchmark from a clean checkout and
regenerating the published numbers. It pairs with [`PREREGISTRATION.md`](./PREREGISTRATION.md)
(the committed analysis plan) — run the experiment here, analyze it there.

## 1. Prerequisites

- **Node.js ≥ 18** (no build step; the harness is dependency-free).
- At least one agent CLI installed and authenticated: `claude`, `gemini`, and/or `opencode` (DeepSeek).
- `benchmark/.env` with judge keys (a judge must be a *different* family than the agent):
  - `ANTHROPIC_API_KEY` — Claude judge
  - `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) — Gemini judge
- **Optional:** `MEM0_API_KEY` (+ an embeddings key) to enable the `mem0` arm. Without it, that arm
  records `NO_COMPLETION`; the `vector-baseline` arm needs no keys.

## 2. Pin the environment (record these in the results)

Reproducibility depends on recording *what ran*. Capture, alongside any published numbers:

- **Agent models & versions:** `claude --version`, `gemini --version`, `opencode --version`, and the
  exact model ids (e.g. `claude-sonnet-4-6`, `gemini-2.5-flash`, `deepseek/deepseek-v4-pro`).
- **Judge models:** `claude-sonnet-4-6` / `gemini-2.5-flash` (see `harness/judge.js`) and the **date**
  of the run (hosted models drift).
- **Seeds:** distractor corpus is seeded (default 42; hard negatives seed = distractor_seed + 1) and the
  bootstrap CI is seeded (42) — both deterministic.
- **`config.json`:** `runs_per_scenario`, `enabled_agents`, timeouts.

## 3. Run

```bash
cd benchmark

# Smoke / pilot: one scenario, raise runs for signal
node harness/runner.js --scenario scenario-A --runs 5

# Full confirmatory matrix (all scenarios, all enabled agents)
node harness/runner.js --runs 10

# Single agent / dry-run plan
node harness/runner.js --agent claude
node harness/runner.js --dry-run
```

Results land in `results/`:
- `scenario-<name>_<ts>.json` — per scenario
- `benchmark_<ts>.json` — combined (raw per-arm `token_samples` + judge rationale)
- `benchmark_<ts>.md` — human-readable arm tables (completion% / success% / tokens / tok-success / Recall@5)

## 4. Analyze (statistics)

```bash
node harness/analyze.js results/benchmark_<ts>.json --reference brain-full
```

Writes `benchmark_<ts>_stats.md`: per scenario × agent — 90% bootstrap CI on median tokens,
Mann–Whitney U (brain-full vs each baseline), Cliff's delta, and Holm–Bonferroni correction.

A claim is reported as **supported** only when: effect in the predicted direction, CI excludes the null,
Holm-corrected p < 0.05, and Cliff's delta ≥ "small". Numbers whose fair baseline beats Brain are
reported as **not supported** — no cherry-picking.

## 5. Validate the judge (before trusting any headline)

Per the pre-registration, the LLM judge must be checked against humans before its verdicts are trusted:
sample ≥ 50 runs from `results/*.json`, have 2–3 humans grade them with the same rubric, and report
Cohen's/Fleiss' κ (target ≥ 0.6). The judge rationale is captured per run in the JSON to make this
spot-checkable.

## 6. Cost & runtime (rough)

- Full matrix ≈ N(10) × ~9 arms × 6 scenarios × ~3 agents ≈ ~1,600 agent runs + judging.
- Cheap models (Gemini Flash, DeepSeek) dominate; Sonnet is pricier. Expect **tens of dollars**, low
  hundreds with retries. Pilot (one scenario, N=5) is a few dollars.
- Scenario E (continual) is the most expensive (5 tasks × N × per-task memorize prompt).

## 7. What to publish for reproducibility

- The combined `benchmark_<ts>.json` (raw outputs + judge transcripts) and `*_stats.md`.
- `PREREGISTRATION.md` (dated) — the plan you committed to before the run.
- The pinned model versions/dates and seeds (§2).
- The human judge-validation labels + κ (§5).

## 8. Tests

```bash
cd benchmark && node --test test/*.test.js
```

Covers the metrics/outcome taxonomy, formatter, retrievers, stats engine, and the analysis module
(no API keys required — pure-logic units).
