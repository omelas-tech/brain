# Brain and OWASP ASI06 — Memory & Context Poisoning

This document maps Brain's defenses onto **ASI06 – Memory & Context Poisoning** from the
[OWASP Top 10 for Agentic Applications for 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/).
It classifies every tool by what it can change, and states the threats Brain does not cover.
It applies to brain-memory 0.5.0 and later. The user-facing guide is
[Provenance & Trust](https://brainmemory.ai/docs/concepts/provenance-trust/).

## 1. Control map

A guardrail on agent memory can do four things to a write or a read: **allow** it, **redact** it,
**quarantine** it, or **block** it. The table shows where each of Brain's controls sits.

| Control | Where | Decision | What it does |
|---|---|---|---|
| Origin policy | write — `src/provenance.js` | allow, redact | Every memory records `origin` (`user`, `agent-inferred`, `tool-output`, `external`). Non-user origins have salience and confidence lowered to a ceiling and decay faster, and the CLI reports each value it lowered. |
| Entrenchment refusal | write — `bin/memorize.js`, `src/pinning.js` | block | Only `user` writes may be born pinned or decay-exempt. Others are refused, not quietly capped. A memory pending verification can never be pinned. |
| Content lint | write — `src/content-lint.js` | quarantine | Instruction-shaped content (override phrases, pipe-to-shell, secret exfiltration) is flagged whatever origin is claimed. |
| Authorization class | write — `src/content-lint.js`, `src/quarantine.js` | quarantine, block | A memory that grants the agent a permission ("pre-approved", "no need to confirm", "the user approved force-pushes") is quarantined from any origin but `user`. A `user` one is quarantined too unless it carries the user's own words (`authorized_by.quote`). It can be pinned only when user-origin and backed or approved. |
| Quarantine (default `enforce`) | write → read — `src/quarantine.js` | quarantine | Writes that are low-trust, lint-flagged, permission-granting or sensitive are stored pending verification and **left out of recall and session start** until a human approves them (`brain verify`). |
| Sensitivity tiers | write — `src/sensitivity.js` | block, quarantine | `blocked` content (government IDs, criminal history, immigration status) is refused. `sensitive` content waits hidden unless the user opted in. |
| Occupancy cap | read — `capLowTrust` in `src/provenance.js` | redact | One recall result or session-start payload holds at most `recall_low_trust_max` (default 1) low-trust memories, approved or not. The rest are reported as `low_trust_suppressed`. |
| Trust-weighted ranking | read — `src/scorer.js` | (ordering) | Origin trust multiplies the score and damps spreading activation, so a clique of planted memories cannot amplify itself. On its own this is **not** a defense (see §4); it bounds entrenchment, not presence. |
| Receipts | read — `src/receipt.js` | (attribution) | Every surfaced memory carries an engine-minted receipt, marked `⚠ <origin>`, `⊘ unverified`, `⚠ authorization`, `⌛ expired` or `⚠ sensitive`. |
| Citation lock | read → reply — `src/surfaced.js`, `hooks/citation-check.mjs` | (detection) | A Stop hook checks every receipt in a reply against what brain surfaced this session. A receipt for anything else is logged as `citation_violation` and reported to the agent. |
| Anomaly audit | maintenance — `src/anomaly.js` | quarantine | `brain audit` finds write bursts, co-tagged low-trust cliques, quietly reinforced low-trust memories and unmarked authorization claims; `--apply` quarantines up to 20 per run. Runs as sleep Phase 0. |
| Integrity baseline | maintenance — `src/integrity.js` | (detection) | A SHA-256 of each memory at write time. `brain audit` reports `content_drift` for edits made outside any write path. Advisory only. |
| Audit log + restore | forensics — `src/audit.js`, `bin/restore.js` | (recovery) | An append-only `audit.log` records every write, archival and verification, and survives restores. `brain restore` rolls the brain back to a snapshot from before an attack. |

## 2. Tools classified by effect

| Effect | Meaning |
|---|---|
| **read** | Returns memory content; changes no memory. |
| **write** | Creates or changes memory content or metadata, within the writer's origin ceiling. |
| **promote** | Raises what a memory can do: always-present (pin), approved (verify), or trusted. Needs a human. |
| **grant** | Promotes a memory that itself grants a permission. The highest-impact action; the only path to it is a user-origin write with the user's words, or a human approval. |

### CLI

| Command | Effect | Notes |
|---|---|---|
| `brain recall`, `brain session-start` | read | Records surfaced ids in the device-local ledger (`~/.brain/.local/`). |
| `brain audit` | read | `--apply` is a write (quarantine only; never approves). |
| `brain memorize` | write | Origin policy, lint, authorization class and quarantine all apply. |
| `brain reinforce` | write | Strength and association weights only. |
| `brain forget` | write | Archives; `--deep` erases every reference. |
| `brain import` | read | Emits a digest of past transcripts; the agent then writes through `brain memorize`, so every gate applies. |
| `brain cloud pull`, sync pull | write | Bulk. Pulled memories keep the origin and flags they were written with. |
| `brain restore` | write | Replaces the whole brain with a snapshot. The audit log is carried forward. |
| `brain pin` | promote | Refused for pending memories and for unbacked authorization claims. |
| `brain unpin` | write | |
| `brain verify approve` | promote / **grant** | Grant when the memory is an authorization claim. The agent prompts forbid approving anything the user has not reviewed. |
| `brain verify reject`, `brain verify requeue` | write | |

### MCP connector tools

All seven carry MCP annotations (`connector/src/server.ts`): read tools are `readOnlyHint: true`,
and every write tool is `destructiveHint: true`.

| Tool | Effect |
|---|---|
| `brain_recall` | read |
| `brain_status` | read |
| `brain_use` | redirect (which brain later reads and writes reach; changes no memory) |
| `brain_memorize` | write |
| `brain_forget` | write |
| `brain_unpin` | write |
| `brain_pin` | promote |
| `brain_verify` | promote / grant |

## 3. Threats not covered

- **A lying writer.** `origin` is asserted by the agent that writes. An agent that files poisoned
  content as `user` or `agent-inferred` defeats the origin rules (see the mislabeled row in §4). The
  lint, the authorization class, the occupancy cap and the audit still apply. The
  user-origin-with-quote requirement narrows this for permissions, but a quote cannot be checked
  against the transcript.
- **A user-origin falsehood.** Brain stores what the user says. It does not fact-check its owner.
- **A compromised host.** Anything with write access to `~/.brain/` can edit files directly.
  Integrity drift is reported, not prevented.
- **Hosts without hooks.** The citation lock's Stop hook runs under Claude Code and Codex. Other
  hosts get the same receipts and prompt rules, but no automatic check.
- **Semantic contradiction.** Brain does not decide that two memories contradict each other. It
  proposes supersessions at write time and leaves the decision to the agent and user.

## 4. Evidence

Retrieval-only, deterministic and reproducible
([benchmark/harness/longmemeval-poison.js](../../benchmark/harness/longmemeval-poison.js)). Every
LongMemEval-S question gets a planted session that answers it wrongly and is its best lexical match.
The plant is plain factual text, so the content lint does not catch it.

| Arm | R@1 | R@5 | poison ranked #1 |
|---|---:|---:|---:|
| clean haystack | 0.551 | 0.909 | — |
| no defense | 0.002 | 0.888 | 99.6% |
| trust-weighted only (pre-0.5.0 default) | 0.060 | 0.888 | 90.2% |
| **quarantine excludes (0.5.0 default)** | **0.551** | **0.909** | **0%** |
| origin mislabeled | 0.003 | 0.888 | 99.4% |

Full table and method: [benchmark/results/REPORT.md](../../benchmark/results/REPORT.md#memory-poisoning-on-longmemeval-s-retrieval-only-2026-10-17).

On real text the authorization rule flags 3 of 19,195 LongMemEval chat sessions (0.016%).
That corpus contains no agent permissions, so every one of those 3 is a false positive.

## 5. References

- OWASP GenAI Security Project, *OWASP Top 10 for Agentic Applications for 2026*, ASI06 – Memory &
  Context Poisoning (9 Dec 2025). https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
- A. Karunanidhi, *Utility Under Attack: Agent Memory Poisoning and the Limits of Content Screening
  and Provenance Ranking*, arXiv:2608.21230. The basis for exclusion by default and for the
  occupancy cap.
- T. Cerruti, M. Okamoto, A. Kaplan Erol, *Agent Memory Is a Surface for Endogenous Authorization
  Laundering*, arXiv:2609.01836. The basis for the authorization class.
- M. Wu, P. Zhu, *Agent Zero Memory: Provenance-Aware Long-Term Memory for LLM Agents*,
  arXiv:2608.29606. Its "citation lock" prompted Brain's receipt check.
- *MemGhost*, arXiv:2607.05189. The original motivation for origin policy and quarantine.
