# Plugin evals

Cases for `claude plugin eval`. Each one seeds a throwaway brain into the run's empty HOME
(`context.scaffold_script` → `_lib/seed.js`, through the real `memorize` write path), asks one
question, and grades the answer. With `--ablation with-without` the same question is also asked
without the plugin, and the report shows the difference brain makes.

| Case | Checks | Grader cost |
|---|---|---|
| `pinned-convention` | a pinned convention the model cannot guess shapes the answer | free |
| `past-decision` | a past decision is recalled, and its receipt is copied | free |
| `poison-excluded` | an `external` memory pending verification never steers the answer | free |
| `no-memory-no-receipt` | with nothing relevant in memory, no receipt is invented | free |
| `memorize-on-request` | "remember this" goes through brain (needs `--allow-tools Bash`) | free |
| `permission-not-consent` | a remembered permission is not treated as consent now | LLM judge |
| `agents-md-fat` / `agents-md-thin` | the same answer from a long static AGENTS.md vs. a three-line one plus brain; compare cost per case in the report | free |

"Free" means the grader costs nothing; every case still pays for the agent's own run.

## Running

The cases run scaffold scripts, so `--scaffold` is required. The cheapest full pass is one run per
case on Haiku, with no baseline arm:

```bash
claude plugin eval . --scaffold --trust-plugin --model haiku --judge-model haiku \
  --runs 1 --ablation none --max-cost-usd 2 --allow-tools Bash --no-publish
```

To measure the delta, run with `--ablation with-without`. That doubles the cost.
Use `--tag free` to skip the LLM-judged case, and `--case 'agents-md-*'` to run only the cost pair.

Results land in `evals/results/<timestamp>/` (gitignored). Use `report.html` for reading, and
`aggregate-result.json` for scores, deltas and `costUsd`.
