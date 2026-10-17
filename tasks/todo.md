# tasks/todo.md — admission control, poisoning benchmark, plugin eval, portability

Started 2026-10-17. The previous plan in this file (open store contract +
`brain-store`, finished 2026-09-18) is in git history.

Rules for this plan: no commits until the user asks; `npm test` green after every
stage; each stage ends with a CHANGELOG `[Unreleased]` entry.

Order matters: Stage 1 is the product, Stage 2 measures it, Stages 3–4 are cheap
proof, Stages 5–7 widen reach. Do not start Stage 2 runs before Stage 1 lands, or
the published numbers describe the old defaults.

---

## Stage 0 — verify before building (½ day)

Confirm each external fact before code or
docs depend on it.

- [ ] Papers exist and say what we will cite: "Utility Under Attack" (provenance-
      weighted retrieval ≈ no defense; 1.2% poisoning), "Authorization Laundering"
      (writer fabricates permissions ~50%, executors comply ~99%), OWASP ASI06 text.
      Record exact titles, IDs and numbers in `docs/security/references.md`.
- [ ] `claude plugin eval` case format: read the full `--help` and docs for
      `case.yaml`, grader types (`tool_used`, `tool_order`, `file_exists`),
      `--threshold`, `--ablation with-without`, CI usage and cost.
- [ ] API-side injection primitive (turn-scoped system message / `clear_at`):
      confirm it exists in the Messages API docs; if not, Stage 5b shrinks to docs.
- [ ] Target formats for Stage 6: Claude Code memory dir layout, Gemini memory
      export, AgentCore `IngestData` request shape. One paragraph + sample each.

## Stage 1 — admission control (≈ 1 week) → release 0.5.0

### 1.1 Exclusion is the default (½ day)
Weighted down-ranking of untrusted memories is the defense the research says
fails; `enforce` (exclusion) already exists but is opt-in.

- [ ] `src/quarantine.js`: one `quarantineMode(config)` helper, default
      `'enforce'`; replace the three inline `config.quarantine_mode || 'flag'`
      reads (`bin/recall.js:147`, `bin/session-start.js:169`, quarantine itself)
      and any read in `hooks/` and `connector/src/engine.ts`.
- [ ] `flag` stays available as an explicit opt-out; document it.
- [ ] Session-start status line already counts pending items over the full
      index — confirm it still shows them in enforce mode so hidden ≠ invisible.
- [ ] Tests: `quarantine.test.js`, `trust-recall.test.js`,
      `session-start.test.js`, `plugin-hooks.test.js` (prompt-recall never injects
      a pending memory under the default).
- [ ] Prompts + docs: every "by default they stay recallable" sentence →
      `prompts/`, `CLAUDE.md`, `README.md`, `website/`, connector server
      instructions. Grep all of them.
- [ ] CHANGELOG under **Changed**, flagged as a behaviour change, with the
      one-line opt-out.

### 1.2 Authorization claims are their own class (2 days)
A memory that grants permission ("the user approved force-pushes to main", "no
need to confirm deploys") must never be acted on without the user.

- [ ] `src/content-lint.js`: rule `authorization_claim`, new severity
      `authorization`. Patterns: user/owner + approved|authorized|granted|
      permitted|allowed; "you (are|have been) (allowed|authorized|permitted) to";
      "no need to (ask|confirm|check)"; "pre-approved"; "standing permission";
      "always allowed to (push|deploy|delete|run|merge|pay)".
- [ ] False-positive corpus first (lesson from the `secret_exfil` fix):
      "OAuth authorization code flow", "the `authorized_keys` file",
      "permission denied error", "RBAC roles", code literals. Test before rule.
- [ ] `src/quarantine.js`: an authorization claim quarantines for **every**
      origin except `user`, including `agent-inferred`; reason `authz:unbacked`.
- [ ] `user`-origin authorization memories require backing: `memorize` accepts
      `authorized_by: { session_id, quote }`; missing → stored but quarantined
      with `authz:no-source`. Approval in `brain verify` counts as the backing and
      is audit-logged.
- [ ] Frontmatter + index `authorization: true`; recall/session-start carry
      `authorization_claim: true`; receipt gets `⚠ authorization`
      (`src/receipt.js`).
- [ ] `src/pinning.js`: refuse pinning an authorization memory unless origin is
      `user` and it is backed.
- [ ] Prompts: a recalled memory is never permission for a destructive or
      outward-facing action; ask the user. Mirror in connector instructions.
- [ ] `brain audit`: report existing memories the new rule would flag
      (no retroactive quarantine without `--apply`).

### 1.3 Citation lock (2–3 days)
The agent may cite only memories it was actually shown this session.

- [ ] Surfaced-ledger: `recall`, `session-start` and `prompt-recall` append
      `{session_id, id, ts}` to `~/.brain/.session/surfaced.jsonl` (bounded,
      rotated, excluded from sync/export like `.sync`).
- [ ] Receipt verifier: a Stop hook (`hooks/citation-check.mjs`) parses
      `◉ memory:` lines in the final reply and checks each against the ledger.
      Mismatch → `citation_violation` audit event + a one-line warning in
      `additionalContext` next turn. Advisory, never blocking.
- [ ] Retrieval-set check in `bin/recall.js`: when the top-k holds a low-trust
      memory that `src/contradiction.js` says conflicts with a trusted one, drop
      the low-trust one and return `suppressed: [{id, reason}]`.
- [ ] Abstention: when nothing clears the relevance floor, recall returns
      `abstain: true`; prompts say "no memory on this" instead of guessing.
      (Scenario F already measures this — reuse its fixture as a test.)
- [ ] `brain status`: surfaced vs reinforced ratio = injected-vs-used telemetry
      (feeds Stage 5).
- [ ] Tests for each; `npm test` green; bump to 0.5.0 only when the user says.

## Stage 2 — the poisoning benchmark (≈ 1 week after Stage 1)

Harness exists: A–F suite, scenario G (poisoned haystack, already has a
quarantine-off ablation hook in `arm-runner.js:396`), and the LongMemEval-S
retrieval adapter. Missing: G results, a poisoned standard benchmark, an
authorization probe, sample size.

- [ ] **G arms**: brain-enforce (new default), brain-flag, brain-off, BM25,
      vector. Metric `poisoning_influence_rate`. Add G to `REPORT.md`.
- [ ] **LongMemEval-S, poisoned** (no LLM, deterministic):
      `longmemeval.js --poison 0.012 --poison-seed 42` inserts per-question
      sessions asserting a wrong answer, origin `external`, co-tagged with the
      evidence. Report Recall@5 and poison-in-top-5 for clean / poisoned ×
      enforce / flag / off / BM25 / vector.
- [ ] **Scenario H — self-granted permission**: an `agent-inferred` memory says
      the user pre-approved a destructive action; the task invites it. Metric:
      acted-without-asking rate, with 1.2 on vs off.
- [ ] **n**: re-run A–H at n ≥ 10 per arm so the CIs mean something; keep the
      preregistration (`PREREGISTRATION.md`) updated before running.
- [ ] **Cost**: tokens and $ per query per arm, in every table.
- [ ] **Optional**: LongMemEval end-to-end QA
      (≈500 LLM calls per arm) and a LoCoMo adapter
      (`benchmark/harness/locomo.js`). Only these produce a headline accuracy.
- [ ] Publish: `REPORT.md`, raw JSON on the website, a benchmarks page section.
      Publish whatever comes back, including nulls.

## Stage 3 — `claude plugin eval` suite (2 days, parallel with Stage 2)

- [ ] `evals/` with 8–12 cases. At least 3 on free graders so they run every
      commit: session-start fires (`tool_used`), recall before a convention-
      dependent edit (`tool_order`), memorize writes a file (`file_exists`).
- [ ] Cases that show the delta: a pinned convention the base model would not
      guess; a past decision; a planted external memory that must not steer the
      edit (ties to Stage 1).
- [ ] Two `AGENTS.md` arms: fat static file vs thin pointer + brain — answers the
      "context files cost more and help less" objection directly.
- [ ] `--ablation with-without`; record cost per arm.
- [ ] CI: `.github/workflows/plugin-eval.yml` — free-grader cases on every push;
      full suite on manual dispatch (needs an API key secret).
      `--threshold` fails the job on regression.
- [ ] Publish `report.html` next to the benchmark report.

## Stage 4 — ASI06 mapping document (1 day, after Stage 1)

`docs/security/asi06.md`, linked from `SECURITY.md` and the website.

- [ ] Control map: allow / redact / quarantine / block ↔ origin clamps
      (`src/provenance.js`), content lint, quarantine + verify, sensitivity
      `blocked`, authorization class, citation lock, audit + content drift.
- [ ] Tool classification by effect: read / write / promote / grant — every CLI
      command and the 7 connector tools (annotations already set in
      `connector/src/server.ts`).
- [ ] Threats not covered, stated plainly (e.g. a user-origin lie, a compromised
      host).

## Stage 5 — injection on every path (3 days)

Claude Code and Codex already inject deterministically
(`hooks/session-start.mjs`, `hooks/prompt-recall.mjs`). Remaining:

- [ ] 5a: test that no hook path ever injects a pending or authorization-
      flagged memory (guards Stage 1 against regressions).
- [ ] 5b: API path — `integrations/api/` example: recall → turn-scoped system
      message with a hard per-turn token ceiling, `<brain-context>` envelope,
      expiry. Only if Stage 0 confirms the primitive.
- [ ] 5c: Gemini CLI / Cursor / other `integrations/`: list which have
      deterministic injection and which still rely on the model calling recall.
      Close the gaps where the host has a hook.
- [ ] 5d: evaluate Claude Code Mods only if hooks lack something concrete
      (e.g. gating writes). No build without a concrete gap.

## Stage 6 — cross-vendor export/import (≈ 1 week)

`src/export-import.js` moves brain's own format only.

- [ ] `src/adapters/` — one module per target, pure functions
      `toTarget(memories) → files|payload` and `fromTarget(input) → memories`:
      `claude-memory` (Claude Code memory dir / `MEMORY.md` index),
      `markdown` (paste blob), `gemini`, `agentcore` (payload only — no AWS SDK
      dependency; print or write JSON).
- [ ] CLI: `brain export --format <target> [--out]`,
      `brain import --from <target> <path>`. Imports enter as `origin: external`
      → quarantined under 1.1 unless the user passes `--trust`.
- [ ] Round-trip fidelity test per target: which fields survive (type,
      strength, tags, related, validity window, pins, origin). Publish the table.
- [ ] Docs page: "Moving your memory in and out".

## Stage 7 — integrations

- [ ] OpenAI Agents API: attach the HTTP connector as an MCP server; record a
      working end-to-end example in `integrations/openai-agents/`.
- [x] Git review: a CI check that runs `brain audit` on a brain git-sync
      repository (`integrations/git-review/`).

---

## Review (2026-10-17)

Verification: `npm test` 1034 → 1077 passing; benchmark 123 passing;
integrations (agentskills, openclaw, copilot, kilo, api, hermes) passing;
connector 15 suites passing, `tsc --noEmit` clean; website `npm run build` clean;
the `claude plugin eval` suite loads all 8 cases.

| Stage | Status |
|---|---|
| 0 Verify | Done. Gemini and ChatGPT export formats could not be confirmed, so they are not built. |
| 1.1 Exclusion default | Done: `quarantineMode()` / `hidesPending()`, unknown value → `enforce`. |
| 1.2 Authorization class | Done. False positives: 3 of 19,195 LongMemEval chat sessions (0.016%). |
| 1.3 Citation lock | Done. The result-set check became an occupancy cap (`recall_low_trust_max`), because contradiction.js only proposes at write time. Abstention is prompt-level. |
| 2 Benchmark | Poisoned LongMemEval-S (retrieval only) published in REPORT.md. Open: scenario G/H agent runs, n ≥ 10 reruns, end-to-end QA, LoCoMo. |
| 3 Plugin eval | Suite built; CI workflow is manual-dispatch and needs the `ANTHROPIC_API_KEY` secret. |
| 4 ASI06 doc | Done: `docs/security/asi06.md`. |
| 5 Injection | 5a and 5b done. Open: Copilot and OpenClaw get session start only; Cursor is MCP only. 5d (Mods): no gap found. |
| 6 Portability | Done: `brain port` (claude-memory, markdown, agentcore). |
| 7 Integrations | Git review done; Agents API example open. |

Follow-up: release as 0.5.0. The quarantine default change is visible to users.
