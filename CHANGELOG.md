# Changelog

All notable changes to brain-memory will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.0] - 2026-09-18

Opens up sync. The HTTP interface between a Brain client and a remote store is
now a published contract with a conformance suite, and `brain-store` is a small
reference server you can run yourself, so a brain no longer has to live in Brain
Cloud to be shared between machines or reached from MCP-only hosts. Sync also
stops being last-writer-wins: clients name the archive they started from, and a
store that has moved on refuses the upload instead of overwriting another
device's memories. The contract is a **draft** and is open for comment in
[#6](https://github.com/omelas-tech/brain/issues/6) until at least 25 September
2026; it may still change. The project also gains a governance document, a
maintainers file and a code of conduct.

### Added
- **An open store contract and a self-hostable store.** `store/CONTRACT.md` (with
  `store/openapi.yaml`) specifies the HTTP interface between a Brain client and a
  remote store. `brain-store` is a reference server for it: Node.js, no
  dependencies, files only, static bearer tokens stored as hashes, optional
  AES-256-GCM encryption at rest. `store/conformance/` is a black-box suite that
  checks any implementation over HTTP. See `store/SELF-HOSTING.md`.
- **Conditional sync (store contract 1.1).** `brain cloud push` now names the
  archive it started from (`If-Match`). If another device pushed in the meantime
  the store answers `412` and nothing is overwritten; pull, then push again, or
  `brain cloud push --force`. Stores that predate 1.1 ignore the header, so
  behaviour against them is unchanged.
- **Token login for self-hosted stores:** `brain cloud login --api-url URL
  --token-stdin` (also `--token`, or `BRAIN_STORE_TOKEN`). The CLI refuses to send
  a token over plain HTTP to another host unless `--allow-http` is given.
- **Connector: pluggable identity.** `CONNECTOR_IDP=static` lets the MCP connector
  run in front of a self-hosted store with no Firebase: the sign-in page takes the
  store token, and the store decides who the user is. Firebase remains the default
  for the hosted service and its behaviour is unchanged.
  `CONNECTOR_TRUST_PROXY` names the reverse proxy when it is not on loopback.
- **Sign-in through an organisation's identity provider (OpenID Connect).** The
  store accepts ID tokens from a configured issuer (`STORE_OIDC_ISSUER`,
  `STORE_OIDC_AUDIENCE`) and creates users on first sign-in; `CONNECTOR_IDP=oidc`
  sends people to that issuer (authorization code, PKCE, nonce). RS256 and ES256
  only; a public issuer such as Google requires an allow-list. Tested against a
  mock issuer, not yet against each real provider.
- **Connector: no lost writes.** Sync-back is conditional. When another device
  pushed first, the connector discards its working copy, starts again from the
  store's brain, re-applies the write and pushes, so both sides' memories survive.
- Docker Compose for a store, a connector and Caddy (`store/deploy/`).
- `GOVERNANCE.md`, `MAINTAINERS.md`, `CODE_OF_CONDUCT.md`.

### Fixed
- `brain cloud push` on macOS no longer uploads an AppleDouble `._name` entry
  beside every file with extended attributes (`COPYFILE_DISABLE`), which inflated
  the archive and its reported file count.
- Connector: a user whose brain exists but has never been pushed to is treated as
  new rather than as a store outage, so their session can be renewed.
- `CONTRIBUTING.md` described a project layout several releases old.
- `SECURITY.md` described the hosted service's retired key-derivation scheme.

## [0.3.0] - 2026-09-04

Ships brain as a plugin and moves its session behaviour from prompts into
hooks. The repository is now a Claude Code plugin and a Codex plugin, and a
marketplace ChatGPT workspaces can import; `SessionStart`, `UserPromptSubmit`
and `SessionEnd` hooks inject memory deterministically on both hosts instead
of asking the model to remember to run anything. Memories gain a consent tier
(`sensitivity`) that matches the published Anthropic vocabulary so the two
models interoperate, `brain import` learns Codex rollouts, and the earlier
unreleased work lands: content-integrity baselines, verifiable skills,
contradiction boundaries, recorded recall history and the benchmark harness.

### Added

- **Plugin packaging: one repo, three hosts.** The repository root is now a
  Claude Code plugin (`.claude-plugin/plugin.json`, name `brain` so commands stay
  `/brain:*`), a Codex plugin (`.codex-plugin/plugin.json` overlay — Codex reads
  the Claude manifest and exports `CLAUDE_PLUGIN_ROOT` to plugin hooks), and a
  marketplace for both (`.claude-plugin/marketplace.json`,
  `.agents/plugins/marketplace.json`). ChatGPT Business/Enterprise admins can
  import the same repo (Admin → Plugins → Import marketplace) with daily sync.
  Two plugins: `brain` (local-first: hooks + commands + the bundled CLI via a
  `bin/brain` shim) and `brain-cloud` (the hosted MCP connector only, so
  local-CLI users are never pushed into cloud OAuth).
- **Sensitive-topic consent tier** (`src/sensitivity.js`). Every memory now
  carries `sensitivity: standard | sensitive | blocked`, using the vocabulary
  of the largest deployed consent model for assistant memory (Anthropic, Aug
  2026) so brains interoperate with it instead of inventing a schema.
  `sensitive` (health, race, ethnicity, religious beliefs, politics, gender
  identity or sexual orientation) is stored only after the user opts in
  (`sensitive_topics: true` in config.json); until then the write lands
  quarantined (`sensitive_opt_out`) and is hidden from recall and
  session-start, and `brain verify approve` is the per-item consent. `blocked`
  (government ID numbers, criminal history, immigration status) is refused
  outright. The agent classifies; the CLI's patterns are a narrow backstop that
  can raise a label but never lower it. Receipts carry `⚠ sensitive`. Opting in
  is never retroactive. This turns the positioning claim "provenance *and
  consent* on every fragment" from copy into a shipped property.
- **Codex integration, as hooks.** `brain --codex` now registers brain's three
  hooks in `~/.codex/hooks.json` (non-destructive merge; `/hooks` once to trust)
  in addition to the `AGENTS.md` prompt and skills — the same scripts the plugin
  ships, with `${CLAUDE_PLUGIN_ROOT}` expanded to the npm package path. Codex's
  extension API for rewriting MCP tool results (0.151.0) is compile-time Rust
  inside the Codex binary, so hooks are the integration surface a third party
  actually has. The unshipped `integrations/codex/hooks/` copies and the
  `Stop`-hook turn queue are gone: `brain import --source codex` reads
  `$CODEX_HOME/sessions/` directly.
- **Prompt-time recall hook** (`UserPromptSubmit`, both hosts). Each substantive
  prompt gets a deterministic `brain recall` pass; the top `prompt_recall_top` (3)
  matches within `prompt_recall_budget_tokens` (600) are injected with receipts
  and a short excerpt, wrapped in `<brain-context>`. The relevance floor means
  unrelated prompts inject nothing; short prompts, slash commands and
  acknowledgements are skipped; nothing is reinforced unless the model uses it.
- **`brain import --source codex`.** A Codex rollout adapter for
  `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` (format verified against
  Codex 0.153): genuine prompts are told apart from injected AGENTS.md /
  environment / hook context by `content_item_kinds` (marker matching for
  pre-0.148 files), background threads (subagent, guardian, consolidation) are
  skipped, thread names come from `session_index.jsonl`, touched files from
  `apply_patch` calls. Harvest now also strips brain's own `<brain-context>`
  and `<brain-session-context>` injections, so recalled memories are never
  harvested back into new ones.
- **`brain session-start --budget N`** tightens the working-memory cap for one
  call (never raises it) — for hosts with a smaller injection window than
  config.json assumes. `brain recall` is now importable in-process
  (`computeRecall`) with byte-identical scoring to the CLI.
- **Deterministic hooks for Claude Code and Codex** (`hooks/hooks.json`,
  shared by both hosts). `SessionStart` injects the `brain session-start`
  payload plus the ambient rules as `additionalContext` — the first time Claude
  Code gets brain's session-start behaviour from the host rather than from a
  prompt the model has to obey. `SessionEnd` appends a session-boundary entry
  to `~/.brain/contexts.json`. Hooks run the engine in-process from the plugin
  root, fail soft (`{}` + exit 0), and never touch a brain that does not exist.
- **Content integrity baselines (OWASP ASI06, Store phase).** Every memory is
  hashed (SHA-256) at write time, and `brain audit` reports memories whose bytes
  no longer match. Closes the one poisoning route every other defense here was
  blind to: an editor. Provenance, content-lint, quarantine, and anomaly
  detection all guard the *write path* and assume an attacker arrives through
  `brain memorize` — but `~/.brain/` is plain Markdown, so anything with write
  access to the home directory could rewrite a trusted, pinned memory without
  touching the index, the audit log, or any origin label. Drift findings are
  **advisory** (sleep and the user both edit files legitimately) and are never
  auto-quarantined. Re-baseline with `brain audit --rebaseline`.
- **Contradiction proposals carry the boundary.** `potential_conflicts` now
  reports `proposed_valid_until` — the exact instant a supersede would stamp on
  the older memory — plus `authority` and `shared_tags`. Detection also widened
  beyond pinned/stable to like-for-like memories (a `decision` that may have
  replaced a `decision`), which is the ordinary "we changed our minds" case
  users never think to flag. Still never auto-resolved: tag overlap is a
  relatedness signal, not a contradiction signal.
- **Verifiable skills** (`brain skill verify <name>`). A skill may declare
  read-only preconditions (`file_exists`, `file_absent`, `file_contains`,
  `command_available`, `env_set`) that are checked against the working directory
  without running the agent, so a skill distilled against a repo layout that has
  since changed is caught in milliseconds instead of after several real
  failures. Checks are **declarative by design** — skills are crystallized
  automatically, they sync, and they can be imported, so a `verify` field
  holding arbitrary shell would be a memory file that executes code. Failure
  demotes; passing does not promote.
- **`recall_history` is actually recorded.** The field was declared in the
  schema, documented in all six agent prompts and three docs pages, and never
  written — `brain reinforce` updated `access_count` but not the series, so the
  brain knew a memory had been recalled N times and never *when*. Each
  reinforcement now appends a capped row (timestamp, interval, strength
  before/after).
- **Benchmark: LongMemEval-S adapter** (`harness/longmemeval.js`). Scores the
  retrieval half of the public 500-question benchmark with no LLM spend.
  Brain: **R@5 = 0.909** over ~48-session haystacks.
- **Benchmark: real-embedding arm** (`harness/retrievers/dense.js`) and a
  **retrieval-only pilot** (`harness/retrieval-only.js`) that scores Recall@k
  for every retriever without an agent. The existing `vector-baseline` arm is a
  hashed bag-of-words, not a semantic model, and could not answer whether
  embeddings help; `dense` can.
- **Benchmark: decay calibration** (`harness/decay-calibration.js`). Compares
  each memory type's implied half-life against observed recall intervals.

### Fixed

- **Frontmatter serializer corrupted arrays of objects.** `updateMemoryFile`
  rendered them via `String(value)`, producing `[object Object]` — lossy and
  invalid YAML. Now JSON-encoded (a YAML subset), so they round-trip.

### Changed

- **Positioning: two claims added, one now evidence-backed.** Deterministic
  cross-agent ranking and poisoning resistance are stated in the README and on
  the site. "No embeddings required" is no longer an assertion: on the hardest
  retrieval scenario a real embedding model ranked the target memories *worse*
  than BM25 (oracle ranks 45/20/15 plain, 21/20/8 with the model's task
  prefixes, vs BM25's 21/20/1), and ties it at 0.909 R@5 on LongMemEval-S.
- **`brain-bm25` is rank-identical to plain BM25** on both scenario A and all
  500 LongMemEval-S instances. Title-3x/tags-2x field weighting and the custom
  stemmer buy nothing measurable — Brain's advantage lives in decay, spreading
  activation, context match, and pinning, not the relevance function.
- **Single-principal invariant documented.** "One brain, one person" is now an
  explicit design principle; `scope` and `principal` are reserved frontmatter
  field names.


## [0.2.0] - 2026-08-18

Adds the second time axis. Memory now records not just when it learned a
fact but when that fact was true, so recall can answer "what was true in
March?" instead of ranking a stale answer first — and closes two
supersession holes that, chained, let an unverified write quietly demote a
trusted memory.

### Added

- **Bitemporal validity.** Memories now carry a valid-time window
  (`valid_from` / `valid_until`, half-open `[from, until)`) alongside the
  record time they already had (`created`) — the difference between *when a
  fact was true* and *when the brain learned it*. Two new recall flags travel
  back along each axis: `brain recall "<q>" --as-of <date>` returns what was
  **true** at that instant (and lifts the supersession demotion for memories
  still inside their window — at that moment they were simply the truth), and
  `--as-known-of <date>` returns what the brain had **recorded** by then. Pass
  both to reconstruct exactly what the brain believed, and when. Superseding
  stamps the predecessor's `valid_until` automatically, so the existing corpus
  gains real validity windows without re-authoring anything. An expired memory
  is demoted and marked (`expired: true`, `⌛ expired` on its receipt), never
  deleted — "that was true until June" stays answerable. Inverted or
  unparseable windows are rejected at write time, as are unparseable `--as-of`
  bounds; silently ignoring one would answer a point-in-time question with
  present-day memories.
- **Expired pins are held out of the always-apply tier.** A pinned memory whose
  validity window has closed is no longer injected every session as an active
  constraint; session start reports the count as `expired_pins` so it can be
  updated or unpinned. It stays reachable through ordinary recall.
- **Bitemporal on the hosted connector.** `brain_recall` gained `as_of` and
  `as_known_of`; `brain_memorize` gained `valid_from`, `valid_until`, and
  `supersedes`. Expired hits are called out in the text channel rather than only
  as a JSON field, and a replacement held back by quarantine is stated
  explicitly ("the replacement of X is HELD until you approve this write; those
  memories are still current") instead of failing silently.
- **`brain-connector-gated` benchmark arm.** Brain ships two retrieval
  *policies* and only one was measured: the local plugin injects ranked memory
  at session start unconditionally, while the hosted connector advertises memory
  as tools and lets the model decide whether to recall at all. The new arm
  models that gating policy — the model sees the connector's real tool
  advertisement and the task, decides, and if it recalls, the engine runs with
  *its own* query. The gate call's tokens are charged to the arm and a decline
  scores as a retrieval miss rather than "not measured", so the policy can't
  flatter itself. Each run records whether the model declined to look or looked
  with a poor query — different failures, different fixes.

### Fixed

- **A quarantined write could demote a trusted memory before anyone looked at
  it** (ASI06). `supersedes` was applied unconditionally, so a memory written
  from a fetched page or tool result — pending verification precisely because
  it isn't trusted — immediately stamped `superseded_by` on its target and cut
  that memory's recall score to a quarter. The stamp is now withheld while a
  write is quarantined (reported as `supersede_pending`) and applied by
  `brain verify approve`; rejection leaves the original untouched.
- **Archiving a memory left everything it had superseded permanently demoted**,
  behind a `superseded_by` pointer to an id that no longer existed — so
  rejecting a poisoned write archived the write but kept its damage. Archival
  (and therefore `brain verify reject` and `brain forget`) now withdraws the
  supersessions a memory imposed, reported as `released`. Automatically stamped
  validity is withdrawn with it; a window set by hand is left alone.
- **Corrected a false MCP conformance claim in the connector.** A note in
  `connector/src/result.ts` described its `_meta` cache marker as
  "forward-compatible with the final spec". Checked against the final
  2026-07-28 text (SEP-2549) it isn't: `cacheScope`/`ttlMs` are top-level fields
  on `CacheableResult` and apply to `tools/list`, `prompts/list`,
  `resources/list`, `resources/read`, and `resources/templates/list` —
  `tools/call` is not a cacheable result, so a memory response carries no spec
  `cacheScope` at all. The marker stays as deliberate defense-in-depth against
  an intermediary that caches tool output heuristically; it is simply no longer
  described as conformance. `connector/docs/mcp-2026-07-28-conformance.md`
  records the verified per-item status: statelessness and the OAuth 2.1
  resource-server requirements are met, while `server/discover`, per-request
  `_meta`, and `tools/list` caching are blocked on the TypeScript SDK — both
  1.29.0 and the current latest 1.30.0 still top out at protocol 2025-11-25.

## [0.1.0] - 2026-08-08

First stable release. Completes the memory-poisoning defense (OWASP ASI06),
adds a portable cross-agent distribution rail, and introduces truth-based
invalidation.

### Added

- **Quarantine for untrusted writes.** Low-trust origins (`tool-output`,
  `external`) and instruction-shaped content (a write-time lint catches
  "ignore previous instructions", pipe-to-shell, secret-exfiltration, and
  similar) now land in a pending-verification state. The `quarantine_mode`
  config knob controls behavior: `flag` (default — recallable but marked
  `⊘ unverified`, never pinnable), `enforce` (excluded from recall until
  approved), or `off`. Resolve with `brain verify list | approve | reject` —
  approval clears the flag but keeps origin and trust weighting; it never
  promotes a memory to user trust.
- **Anomaly detection.** `brain audit [--window 7d] [--apply]` scans the audit
  log, index, and association graph for the patterns poisoning leaves — write
  bursts per origin, co-tagged low-trust cliques, and quietly-reinforced
  unverified memories — and can quarantine what it finds (capped per run). Runs
  automatically as Phase 0 of `brain sleep`.
- **Unified, readable audit trail.** A single append-only `~/.brain/audit.log`
  records every write, archival, verification, and restore. `brain forget` now
  audits archivals, and the log is carried forward through restores.
- **Portable Agent Skill.** Brain now ships as a self-contained
  `SKILL.md` folder (`integrations/agentskills/brain-memory/`) that runs
  unmodified on any agentskills.io-compatible client — reaching agents without
  a dedicated installer. Included in the npm package.
- **Temporal invalidation.** `brain memorize` accepts `supersedes: [ids]`,
  stamping `superseded_by` on the replaced memory. Superseded memories are
  strongly demoted at recall (not deleted), so the successor always wins while
  "this was true until X" stays answerable. `brain sleep` consolidation now
  proposes superseding for contradictory memories.
- **Memory inspector (Brain Cloud).** New `/api/brains/{id}/audit` endpoint and
  memory-trust fields (origin, quarantined, vetted, superseded_by) on the tree
  endpoint, a server-side version-restore route, and a read-only Inspector page
  in the subscriber panel. Experimental `ui://brain/inspector` MCP App in the
  connector (off by default).

### Changed

- **Connector conformance.** Every memory-bearing MCP result declares
  `cacheScope: private` (a memory response is per-user and must never be cached
  across users); the `brain.write` scope is now enforced (read-only tokens are
  refused writes); `brain_verify` tool added; `WWW-Authenticate` emits
  `error="invalid_token"`; non-POST `/mcp` returns 405.

### Fixed

- **Path & symlink hardening.** `validateBrainPath` now resolves symlinks and
  refuses writes that escape `~/.brain` even through a symlinked directory, and
  the guard is applied in every index-trusting writer (reinforce, pin, forget).
  Export/import reject `..` traversal and skip symlinks; Git sync skips symlinks
  and excludes `.cloud` (so cloud OAuth tokens are never committed to a remote);
  cloud tar extraction drops symlink members via a staging directory. The
  Git-sync push child process takes paths as argv rather than an interpolated
  shell string.

## [0.1.0-beta.36] - 2026-08-07

### Added

- **Trust-weighted recall — origin now decides how far a memory's score can
  reach.** beta.34 labelled every write with an origin and capped what
  untrusted origins may claim; this release closes the read side. Recall
  multiplies each memory's composite score by an origin trust factor (`user`
  1.0, `agent-inferred` 0.95, `tool-output` 0.85, `external` 0.75), and
  spreading-activation *sources* are damped by the same factor — so a clique
  of co-tagged planted memories (which auto-link through tag overlap) cannot
  amplify itself past something the user said directly. Trust bounds volume,
  not relevance: a genuinely more relevant external memory can still win; it
  just can't win on bulk. Missing origin weighs as the memorize default, so
  pre-provenance brains rank exactly as before.
- **Low-trust results are visibly marked.** `brain recall` and
  `brain session-start` return `origin` and a `low_trust` flag on every
  result, and receipts for `tool-output`/`external` memories carry a trailing
  warning — `◉ memory: "…" (learning, 3d ago, ⚠ external)` — so a fact
  absorbed from a web page can never quietly pass as something you said.
  Trusted receipts are byte-identical to the existing format.
- **Connector: `brain_memorize` accepts `origin`.** The remote MCP tool passes
  a validated origin through to the engine, with tool-description guidance
  that `user` is reserved for facts the human explicitly stated or asked to
  remember.
- **`brain restore` — an undo button for the whole brain.**
  `brain restore --list` shows restore points; `--to <point>` rolls
  `~/.brain/` back to one. Two sources: the Git sync history
  (`--from git`, default — one point per push) and Brain Cloud's server-side
  pre-push snapshots (`--from cloud`, listed via the new
  `GET /api/brains/{id}/versions` endpoint). Every restore is undoable:
  the git path first commits the current state as a safety snapshot (unsynced
  work included), the cloud path writes a local backup under
  `~/.brain/.cloud/`. `audit.log` is deliberately carried *forward* through
  restores — the append-only trail records history through a rollback, never
  gets rolled back by one — and each restore is itself logged there.

## [0.1.0-beta.35] - 2026-08-01

### Added

- **`/brain:import` — cold-start a brain from transcripts your agents already
  wrote.** A new brain is empty, and an empty brain is worth nothing until
  something fills it; meanwhile every coding agent has been keeping months of
  local history. `brain import` harvests it: session titles, user prompts,
  projects, branches and edited files, with harness wrappers
  (`<system-reminder>`, slash-command tags, command output), subagent sidechain
  traffic, and bare acknowledgements filtered out. The digest is bounded on
  three axes (sessions, prompts per session, total characters) and
  round-robins across projects, so one busy repo cannot consume the whole
  budget — on a real 261-session history that lifted project coverage from 5
  to 13 within the same ~15k tokens.

  The CLI harvests; the **agent distills**. Extracting meaning is a semantic
  judgement, and making it in the CLI would mean shipping an embedding model
  or calling an LLM — the two things Brain exists to avoid. So the harvester
  reports facts and never infers, and distilled memories go through the
  ordinary `brain memorize` path as `agent-inferred`: an import inherits the
  existing provenance ceilings for free and can never pin, entrench, or
  outrank something the user said directly.

  Import is incremental — a cursor at `~/.brain/.import/state.json` records
  which sessions have been read so re-runs offer only new ones (`--all`
  overrides). `--mark` validates ids against the source's real sessions and
  exits non-zero on any that match nothing: silently accepting a truncated or
  mistyped id would report a session as retired while the cursor never matches
  it, re-offering that session forever. Scope with `--project`,
  `--since 30d|6m|2026-01-01`, `--limit`.
  `brain import --sources` lists detected history stores. `brain import` only
  ever reads and prints; no memory is written without the agent.

  Claude Code is the first source adapter; the registry in `src/harvest.js`
  takes additional agents without changes downstream.

## [0.1.0-beta.34] - 2026-07-26

### Added

- **Memory provenance — every write is now labelled by origin.** Each memory
  carries an `origin` (`user`, `agent-inferred`, `tool-output`, `external`)
  recording *where the content came from*, which is a different question from
  how much the agent believes it. Origin decides what a memory may claim:
  non-user origins are capped below the 0.7 prune-exempt salience threshold,
  capped on confidence so they stay flagged as uncertain at recall, may not
  raise their own base strength, and decay faster — so a fact absorbed from
  untrusted content fades and loses to a genuine one over time. Defaults to
  `agent-inferred` when absent (the safe direction). Downgrades are never
  silent: `brain memorize` reports every value it lowered under
  `provenance_clamps`. Mitigates OWASP ASI06 (memory poisoning); see
  MemGhost, [arXiv:2607.05189](https://arxiv.org/abs/2607.05189).
- **Append-only provenance log** at `~/.brain/audit.log` — one JSON object per
  write, recorded before the caller sees success, so a fact that later proves
  to be planted can be traced to the write that introduced it even if the
  memory was since edited, consolidated, or deleted.

### Changed

- **Breaking (CLI):** born-pinning through `brain memorize` now requires
  `origin: "user"`. Entrenchment — `pinned` (loaded into every session) and
  `stable` (exempt from decay) — is a capability rather than a magnitude, so a
  request from any other origin is refused with a non-zero exit rather than
  quietly capped. Pin deliberately afterwards with `brain pin <id>` instead.
  Only affects callers that drive the CLI directly; `/brain:memorize` already
  proposed rather than assumed pinning.

### Fixed

- **Cache-honest token accounting in the benchmark harness.** `normalizeUsage`
  now folds `cache_read`/`cache_creation` input tokens back into the input
  count — the cached prefix was being undercounted, which deflated
  tokens-per-successful-task on the DeepSeek endpoint. Cached tokens are
  accumulated, logged, and persisted separately so the two can be compared.
  Also: model-aware judge dispatch, `runs_per_scenario` raised to 10, tighter
  needle-fact rubrics on scenarios A/B/C, and three amendment rows recording
  all of it in `PREREGISTRATION.md`.

## [0.1.0-beta.33] - 2026-07-04

_Covers everything since v0.1.0-beta.31, including the changes first shipped in the changelog-less 0.1.0-beta.32._

### Added

- **Recall receipts — memory that visibly fires.** Every memory returned by
  `brain recall` and `brain session-start` now carries an engine-minted
  `receipt` line (`◉ memory: "<title>" (<type>, <age>)`). Hosts end a response
  with the receipts of the memories that actually shaped it — max 3, copied
  verbatim, pinned facts only when decisive, none when none were used. A
  receipt can only exist if the engine returned that memory, so receipts
  cannot be hallucinated.
- **Four new agent hosts.** Native integrations under `integrations/` for
  **OpenClaw / NVIDIA NemoClaw** (memory-slot plugin `openclaw-brain-memory`
  replacing `memory-core`, slot-neutral hook pack, ClawHub skill, NemoClaw
  egress-policy preset — all live-verified), **Hermes Agent** (full
  `MemoryProvider` plugin, shipped standalone as the `hermes-brain-memory`
  pip package per upstream policy), **GitHub Copilot CLI** (plugin with
  `sessionStart` context injection + skills; the repo is now a Copilot plugin
  marketplace via `.github/plugin/marketplace.json` — install with
  `copilot plugin install brain-memory@brain`), and **Kilo** (runtime plugin
  with chat-message injection, session tracking, and `BRAIN_AGENT` labeling).
- **Two new installer runtimes.** `brain --copilot` (global prompt at
  `~/.copilot/copilot-instructions.md`, skills in the cross-tool
  `~/.agents/skills/`) and `brain --kilo` (prompt registered in the
  `kilo.jsonc` `instructions` array via a safe strict-JSON editor; repo-local
  `AGENTS.md` shared with Codex/OpenCode).

### Fixed

- Kilo plugin derives the project label from `input.project` as well, so a
  plugin host running with cwd `/` no longer records sessions as project
  `"unknown"`.
- Hermes `cli.py` is a standalone diagnostics tool (`python3 cli.py
  status|recall`) — Hermes exposes no CLI hook to user-installed memory
  providers, so the previously documented `hermes memory recall` never
  existed.
- Every `npm publish` now runs the full test suite via `prepublishOnly` —
  the old `prerelease` script was a no-op vestige no release path invoked.

## [0.1.0-beta.31] - 2026-07-01

### Fixed

- **Recall relevance is now calibrated in absolute terms.** BM25 relevance was
  normalized per-query by the top score, so the best match for *any* query scored
  relevance 1.0 — a nonsense query's one weak term-match produced ten confident-looking
  results (top composite 0.679). Three coordinated changes fix the calibration:
  relevance is scaled by **IDF-weighted query coverage** (a memory matching one term
  of a four-term query can no longer score 1.0); explicit-query recall applies a
  **relevance floor** so zero-relevance memories can't pad the top-N on strength
  alone; and spreading-activation **sources are relevance-gated** in query mode, so a
  strong-but-irrelevant clique can't rescue itself past the floor (associates of
  genuinely relevant memories still surface — that's the feature). Context mode
  (`--context`, session-start) is exempt: topical padding is intended there. On a
  real 177-memory brain the same nonsense query now returns one result with honest
  relevance (0.213), and a 20-query retrieval probe improved from hit@1 90% /
  MRR 0.950 to **hit@1 100% / MRR 1.000** — coverage scaling also demotes
  partial-match distractors below full-coverage targets.

## [0.1.0-beta.30] - 2026-07-01

### Security

- **Connector purges plaintext working copies.** The hosted MCP connector already
  kept per-user working copies in RAM only (tmpfs, never on disk); it now also
  **wipes them proactively** — on an idle TTL, at session end, and via a dedicated
  ephemeral working path — so a decrypted brain never lingers in memory longer than
  an active session needs it. Local-only and Git/export use are unaffected. See
  [SECURITY.md](SECURITY.md).

### Added

- **`memorize` tags each memory with its origin agent.** New memories record
  `encoding_context.agent` — the detected host (`claude-code`, `gemini-cli`,
  `codex`, `opencode`), a `BRAIN_AGENT` override, or `unknown` — in both frontmatter
  and the index. This powers the Brain Cloud dashboard's "where your brain is used"
  attribution. Existing memories are unaffected; the field is additive.

### Fixed

- **`forget` now actually clears a memory from recall.** `forget` sourced its
  search index differently from `recall`, so a forgotten memory could keep surfacing
  until the index was rebuilt out-of-band; it now sources the index via the same
  TF-IDF path as `recall`, so forgetting takes effect immediately. Added CLI test
  coverage for `recall` and `forget`, and de-flaked the stress-test performance gate.

### Changed

- **Website NL/EU compliance pass.** Privacy and Terms were revised for NL/EU law —
  sub-processor list and EU data location, a cookies/browser-storage section,
  retention periods, KMS-accurate at-rest-encryption language, the Omelas controller
  identity, a VAT (EU OSS) clause, and the 14-day consumer right of withdrawal — plus
  a site-wide transparency notice (not a consent CMP; the site sets no tracking
  cookies).
- **Brand asset set.** Added `assets/brand/` — light + dark firing-neuron tiles and
  marks (SVG + PNG 64–1024), transparent marks, icon-centered LinkedIn covers
  (6336×1584, no text), and a usage README — with a dependency-free regeneration
  script. No behavior change.

## [0.1.0-beta.29] - 2026-06-26

Version marker only — no functional changes since beta.28.

## [0.1.0-beta.28] - 2026-06-26

### Fixed

- **Recall relevance after out-of-band memory changes.** `session-start` now
  rebuilds its search index when it has drifted out of sync with `index.json`
  (after a `sync pull`, `sleep`/consolidate, `forget`, or a manual edit), not
  only when the index is missing — matching `recall`'s behavior. A stale index
  silently scored every memory's relevance as 0, so newly-synced or changed
  memories were surfaced by strength/context only, never by relevance.

## [0.1.0-beta.27] - 2026-06-10

### Security

- **Hosted-service hardening (Brain Cloud + connector).** Memories synced to Brain
  Cloud are now **encrypted at rest** (AES-256-GCM, per-user key, with keys managed
  in a cloud KMS — the key never sits on the server); the connector keeps per-user
  working copies in **RAM only** (tmpfs), never on disk. CLI sessions use
  **rotating refresh tokens with automatic reuse detection** and real **logout**
  (one device or all). The connector now fails closed without an identity provider,
  runs as an unprivileged sandboxed service, safely handles untrusted brain
  bundles, and rate-limits its endpoints; OAuth account-linking requires a
  **verified** email. None of this changes local-only or Git/export use, which stay
  passphrase-encrypted and never touch the cloud. See [SECURITY.md](SECURITY.md).
- The published package now also ships `SECURITY.md` and `CHANGELOG.md`.

## [0.1.0-beta.25] - 2026-06-07

### Changed

- **Brand refresh.** Adopted the firing-neuron "activation" glyph in place of the brain emoji across the prompts, command output, CLI help text, and the README, and refreshed the icon set (`assets/`). No behavior change.

## [0.1.0-beta.24] - 2026-06-05

### Added

- **`BRAIN_DIR` environment variable** — point your brain at any folder instead of the default `~/.brain`. Set it to a folder your existing tools already sync (Google Drive, Dropbox, iCloud Drive, OneDrive, Syncthing, or a git working copy) to get cross-device sync with no account and no extra setup. A leading `~/` is expanded. Honored everywhere the brain is resolved — recall, memorize, init, and Cloud sync.

## [0.1.0-beta.23] - 2026-06-05

### Changed

- **Command surface collapsed to a six-verb core.** The everyday loop is ambient (recall + memorize), with a small manual surface and maintenance demoted to the background. Removed/merged six commands: `consolidate` and `review` are now handled by `/brain:sleep`; `unpin` is folded into `/brain:pin` (a toggle — `--off` unpins); `sunshine` (forensic erasure) is now `/brain:forget --deep`; `explore` is dropped (browse `~/.brain/` directly or use the web dashboard); and `init` is folded into install + first `/brain:sync` (which auto-creates the structure if missing). The surviving commands are `remember`, `memorize`, `status`, `pin`, `forget`, `sync`, `skills`, and `sleep`. This aligns the plugin with the forthcoming Claude connector, which exposes the same minimal tool set.

### Fixed

- **Install detection no longer depends on a specific command.** The Codex/OpenAI skills-style detector keyed off `brain-init/SKILL.md`; it now matches any `brain-*` skill directory, so detection survives command-set changes.

## [0.1.0-beta.21] - 2026-06-03

### Changed

- **Primary domain moved to `brainmemory.ai`.** The website, dashboard, and Brain Cloud API now live at `brainmemory.ai`, `app.brainmemory.ai`, and `api.brainmemory.ai`. The plugin's default sync endpoint (`DEFAULT_API_URL`) is now `https://api.brainmemory.ai`. The old `brainmemory.work` hosts remain as redirects — `api.brainmemory.work` issues a `308` to the new API, so existing installs keep syncing without changes.

## [0.1.0-beta.20] - 2026-05-31

### Fixed

- **`memorize` and `skill add` now read piped stdin portably (fixes CI on Linux & Windows).** Both CLIs read input by opening the `/dev/stdin` *path*, which works on macOS but throws `ENXIO` on Linux CI runners and doesn't exist on Windows — so the contradiction-surfacing tests failed on every non-macOS job. Switched to reading file descriptor `0` (`fs.readFileSync(0, …)`), which reads piped stdin correctly across Linux, macOS, and Windows.

### Changed

- **Project moved to the Omelas organization.** Repository transferred to `github.com/omelas-tech/brain` (old `onurkarali/brain` URLs redirect). Updated `repository`, `bugs`, and all in-repo/website GitHub references accordingly, and set `homepage` to `https://brainmemory.work/`. No code or behavior changes — metadata only. The npm package name stays `brain-memory` (unscoped); install is unchanged.

## [0.1.0-beta.19] - 2026-05-30

### Fixed

- **Installer now removes stale command files on update**, so the beta.18 `/brain:skill` → `/brain:skills` rename actually takes effect for existing users. Previously the installer only *copied* the current command set and never deleted renamed/removed files — so an upgrader's old `skill.md` lingered next to the new `skills.md`, and on case-insensitive filesystems that leftover `skill.md` (== `SKILL.md`) kept the whole `commands/brain/` directory shadowed as a single skill, hiding every `/brain:*` command. `installForRuntime` now wipes the `brain` command dir (and stale `brain-*` skill dirs for the Codex skills layout) before writing the fresh set.

## [0.1.0-beta.18] - 2026-05-30

### Fixed

- **`/brain:*` slash commands now actually register in Claude Code** (completes the beta.17 fix). On case-insensitive filesystems (default on macOS), the `skill` command file `skill.md` collides with `SKILL.md` — Claude Code's skill loader treated the entire `commands/brain/` directory as a single skill named `brain`, shadowing all 14 commands so none appeared in autocomplete. Renamed the command `skill` → `skills` (`commands/brain/skills.md`, invoked as `/brain:skills`) to remove the collision. The CLI subcommand remains `brain skill`. Updated slash-command references in `prompts/{claude,gemini,opencode}.md`, `CLAUDE.md`, and `README.md`.

## [0.1.0-beta.17] - 2026-05-29

### Fixed

- **Claude Code now registers all `/brain:*` slash commands.** The command files (`commands/brain/*.md`) shipped without YAML frontmatter; current Claude Code requires a `description` field to register a `.md` as a slash command, so all 14 commands were silently skipped (only `/brain:skill` surfaced, via the separate skills path). Added `description` + `argument-hint` frontmatter to every command file — the field Claude Code needs, and tolerated by the Gemini / Codex / OpenCode install targets too.

## [0.1.0-beta.16] - 2026-05-28

### Changed

- **Benchmark redesigned around 2025-2026 long-term-memory SOTA.** No runtime changes to the brain CLI; this release is a milestone marker for the new evaluation methodology shipped in `benchmark/` and documented at `/docs/benchmarks/`.
  - New N-arm matrix harness with cross-family LLM judge (Claude judges Gemini and vice-versa) — mitigates preference leakage (arxiv 2502.01534) and position bias (arxiv 2509.20293).
  - Six pitchable scenarios (A-F) replacing the legacy 5-scenario suite: Noisy Project Folder (LongMemEval-S retrieval-under-distractors), Three Sessions / One Decision (Pinned Tier ablation), The Contradiction Test (decay + recency), Skill Progressive Disclosure (CoALA Phase-2 L0/L1/L2 ablation), Continual Coding (SWE-Bench-CL style with real `brain memorize` between tasks), Abstention (confabulation resistance).
  - Deterministic 200-memory distractor haystack; real `brain session-start` / `brain recall` integration with Recall@k / NDCG@k scoring against oracle ID sets.
  - Tokens-per-successful-task adopted as the headline efficiency metric (Mem0/BEAM standard); write-side cost co-reported.
  - New OpenCode CLI agent adapter (default model `deepseek/deepseek-v4-pro`), with `--opencode-model` override for cheaper DeepSeek variants.
  - Codex CLI dropped from the default benchmark suite (no token reporting); remains a fully supported brain install target.
  - Legacy scenarios 1-5 stay on disk for reproducing historical reports; invoke explicitly via `--scenario scenario-N-…`.

## [0.1.0-beta.15] - 2026-05-27

### Changed

- **BREAKING: unified CLI surface** — the five separate binaries (`brain-memory`, `brain-recall`, `brain-reinforce`, `brain-cloud`, `brain-memorize`) are replaced by a single `brain` dispatcher with subcommands: `brain recall`, `brain memorize`, `brain reinforce`, `brain cloud <…>`, and `brain install|update|uninstall` (bare `brain` runs the installer). New features ship as subcommands rather than new top-level binaries. Re-run the installer/update to refresh prompts; agents now invoke `brain <command>`. (`bin/brain.js`)

### Added

- `brain --help` / `brain --version` on the unified dispatcher
- **CoALA Phase 0 — budget-aware working memory.** New `brain session-start` aggregator returns a single deterministic, token-budget-bounded startup payload (`memory_count`, `pinned`, `skills_index`, `context_recall`, `due_for_review`, `low_confidence_alerts`, `budget`); `~/.brain/config.json` holds the working-memory budget (created lazily with safe defaults); each new memory records a `token_estimate`. Session-start prompts/hook now make one `brain session-start` call instead of hand-rolled recall + review + low-confidence checks.
- **CoALA Phase 3 — procedural crystallization.** New `/brain:sleep` phase (4b) clusters repeated procedural/experience memories and proposes distilling a recurring task-solving procedure into a `SKILL.md` (user-confirmed, never silent) — learned skills, not just hand-authored ones.
- **CoALA Phase 4 — host skill export.** `brain skill export <name> [--target claude|gemini]` emits a native `.claude/skills/<name>/SKILL.md` (or `.gemini/...`) so distilled skills become directly executable by the host. The new state files (`config.json`, `pinned.json`, `skills-index.json`, `_skills/`) sync automatically via the existing whole-directory git/export-import engines.
- **Tier B §10.1 — obsolescence / context-shift detection.** `/brain:sleep` Prune phase flags memory clusters whose project/role has been absent from recent sessions (`contexts.json`) as reversible archive candidates — catching abrupt relevance loss that decay misses. Never flags pinned memories.
- **Tier B §10.2 — contradiction surfacing.** `brain memorize` now reports `potential_conflicts` when a new memory heavily overlaps a pinned/stable memory; `/brain:memorize` guidance has the agent adjudicate (supersede / keep-both-scoped / reject) instead of silently keeping both.
- **Tier B §10.4 — primacy/recency ordering.** `brain session-start` orders recalled memories so the highest-ranked land at the edges of the payload, mitigating "lost in the middle."
- **CoALA Phase 2 — procedural skills layer.** Skills are stored as `~/.brain/_skills/<name>/SKILL.md` and served via three-level progressive disclosure (L0 session-start advertises name + description only; L1 reads the full skill on a matching task; L2 loads resources at execution). `brain skill list|show <name>|use <name> [--failed]|add|remove <name>` and `/brain:skill`. Procedural strength rises on successful `use` and falls on `--failed`; a skill that fails too often demotes itself out of the advertised L0 index (Tier B §10.3). `~/.brain/skills-index.json` holds the L0 list; session-start injects skill summaries budget-capped by `skills_index_budget_tokens`.
- **CoALA Phase 1 — pinned semantic tier + stable flag.** `brain pin <id> [--scope global|project:<name>] [--priority N]` / `brain unpin <id>` and the `/brain:pin` `/brain:unpin` commands. Pinned memories are injected at every session start regardless of recall score and are decay-exempt; `stable: true` exempts a memory from decay without forcing it to always load. `pinned`/`stable` memories are skipped by sleep-cycle homeostasis and pruning. `~/.brain/pinned.json` manifest; `/brain:memorize` now proposes pinning durable conventions. Fixes the long-standing hole where a stored preference (e.g. "always use tabs") only applied if recall happened to surface it.

## [0.1.0-beta.14] - 2026-04-25

### Added

- **OpenCode support** — `brain --opencode` installs Brain Memory for the OpenCode agent (`prompts/opencode.md`), bringing the supported runtimes to Claude Code, Gemini CLI, OpenAI Codex CLI, and OpenCode.

### Fixed

- **Graceful handling of corrupt brain state files** — CLI tools now emit a clear, actionable error (naming the offending JSON and suggesting a sync/backup restore) instead of crashing when `index.json`, `associations.json`, or the search index is malformed.

### Changed

- **Install docs recommend `npm install -g` over `npx`** — `npx` discards the temporary install, so the `brain` CLI never lands in `PATH` and agents fall back to less reliable manual file operations.

## [0.1.0-beta.13] - 2026-04-05

### Added

- **`brain-memorize` CLI** — single-command memory storage that handles all plumbing (ID generation, strength/decay computation, directory creation, file writing, index updates, association edges, search index) in one call
- `--sync` flag for `/brain:memorize` — auto-pushes to cloud/git after storing, eliminating the separate `/brain:sync push` step
- `--confirm` flag for `/brain:memorize` — opt-in confirmation (was previously the default)
- Install check for `brain-cloud` CLI in `/brain:sync cloud push` — shows install instructions if missing

### Changed

- **`/brain:memorize` is now non-interactive by default** — stores immediately and shows results after, instead of asking "Store these memories?" before writing. The user said "memorize" — they want it stored.
- **`/brain:sync push` and `cloud push` are now non-interactive** — execute immediately without confirmation, matching `git push` behavior. Pull/import still confirm before overwriting.
- **Memorize prompt reduced ~60%** — AI classifies memories and pipes JSON to `brain-memorize` CLI instead of manually writing files. One bash call instead of 6-8 tool calls.
- **Session start behavior made lightweight** — recall engine skips if project has no matching memories, output condensed to single status line, removed heavy mandatory phrasing

## [0.1.0-beta.12] - 2026-04-02

### Added

- **Brain Cloud sync** — push/pull `~/.brain/` to Brain Cloud (`api.brainmemory.work`) via new cloud subcommands
- `brain-cloud` CLI (`bin/cloud-sync.js`) — device code auth, push, pull, status, logout
- `src/cloud-sync.js` — zero-dependency cloud sync engine using Node.js built-in `https` module
- Device code OAuth flow for CLI authentication (`/brain:sync cloud login`)
- Tar.gz archive-based sync protocol for efficient uploads/downloads
- Token management with automatic refresh
- Cloud subcommands in `/brain:sync`: `cloud login`, `cloud push`, `cloud pull`, `cloud status`, `cloud logout`

## [0.1.0-beta.11] - 2026-03-22

### Added

- **Ambient Session Tracking** — agent maintains a running mental log of decisions, learnings, insights, experiences, and goals as they happen throughout the session, so nothing is lost by session end
- **Periodic Memory Checkpoint** — every ~10 substantive interactions, the agent appends a one-liner nudge to its next response, never interrupting flow
- `notable_unsaved` field in session context — preserves what happened even when the user doesn't memorize, so future sessions can reference it
- `update` subcommand — auto-detects existing installations and refreshes commands + prompt sections (`brain-memory update`)
- `uninstall` subcommand — removes commands and prompt sections, preserves `.brain/` by default (`brain-memory uninstall`)
- `detectInstallations()`, `removePromptSection()`, `removeCommands()`, `uninstallForRuntime()` in `src/installer.js`
- Subcommand routing in `bin/install.js` with `parseArgs()`, `runUpdate()`, `runUninstall()`
- 20 new tests covering detection, removal, and round-trip install/uninstall
- Git-based sync — push/pull `.brain/` to any private Git remote (GitHub, GitLab, Codeberg, self-hosted) via `/brain:sync setup/push/pull`
- Export/Import — single-file encrypted backup for portable transfers via `/brain:sync export` and `/brain:sync import`
- `src/crypto.js` — standalone AES-256-GCM crypto module extracted from the old sync code
- `src/git-sync.js` — Git sync engine using `child_process.execFileSync`
- `src/export-import.js` — single-file export/import with encryption and merge mode
- 74 new tests: installer unit tests (`test/install.test.js`) and prompt content validation + integration tests (`test/prompts.test.js`)
- Deterministic recall engine with TF-IDF scoring (`bin/recall.js`, `bin/reinforce.js`)
- Benchmark suite with automated multi-agent evaluation
- Website with full documentation site at brainmemory.work

### Changed

- **Session End Behavior** — context save to `contexts.json` is now the first action (was an afterthought), saves unconditionally even for trivial sessions, and proactively detects session endings without waiting for explicit signals
- **`/brain:memorize` command** — restructured prompt for efficiency: batches all file writes into a single parallel call, skips reads when state is already in context, presents proposed memories for user confirmation before writing, targets 3-4 tool call rounds total (was 6+)
- `/brain:sync` now uses Git remotes instead of OAuth cloud providers — no more registering OAuth apps
- Replaced cloud sync dashboard in `/brain:status` with git sync status (remote URL, ahead/behind counts)
- Extracted installer logic from `bin/install.js` into `src/installer.js` for testability — `bin/install.js` is now a thin CLI wrapper
- Hook files (`hooks/session-start.md`, `hooks/session-end.md`) now have reference notes clarifying that behavior is delivered through prompt injection, not native hook events
- Removed dead `settingsFile` config from runtime definitions — it was never used
- Removed `hooks/` from npm package since they are internal reference docs, not user-facing files
- Website redesigned with clean light theme and updated icon

### Removed

- Cloud sync module (`src/sync/`) — OAuth2, Dropbox, Google Drive, and OneDrive providers
- OAuth token storage (`credentials.enc`) and three-way diff sync state (`sync-state.json`)

### Fixed

- Git sync repo isolation — the `git()` helper in `src/git-sync.js` only used `cwd` to scope commands; if `.brain/.sync/repo/.git` didn't exist yet (first push or failed init), git would walk up the directory tree and commit brain files to the parent project repo. Now uses `GIT_DIR` + `GIT_WORK_TREE` env vars to fully isolate the sync repo.
- Session lifecycle was dead code — session-start/end hook instructions were defined in `hooks/` but never installed or referenced anywhere. The prompt injected into CLAUDE.md/GEMINI.md/AGENTS.md only had a weak one-liner about memorization. Now all three prompt files contain full "Session Start Behavior" and "Session End Behavior" sections with automatic brain context loading, review queue alerts, and end-of-session memorization suggestions.
- `release:beta` npm script now automatically updates the `latest` dist-tag after publishing
- Accurate model names in benchmark results

## [0.1.0-beta.4] - 2026-03-03

### Added

- `/brain:sync` command — cloud sync for pushing/pulling memories to Dropbox, Google Drive, or OneDrive
- Cloud sync module (`src/sync/`) with OAuth2 PKCE + Device Code Flow, AES-256-GCM encryption, three-way diff algorithm, and provider-specific implementations (Dropbox API v2, Google Drive API v3, Microsoft Graph API)
- Zero new dependencies — uses Node.js 18+ built-in `fetch`, `crypto`, `http`

### Changed

- Removed all v1 migration code and references — no v1 users exist
- Updated documentation to reflect 11 slash commands and cloud sync

## [0.1.0-beta.3] - 2026-02-28

### Added

- `/brain:sunshine` command — deep forensic memory erasure that traces and removes all references across the `.brain/` tree (related arrays, content mentions, association edges, context sessions, review queue, archive index, crystallization comments)
- `removeEdgesForMemory()` utility in index-manager for removing all association edges involving a memory
- `removeFromReviewQueue()` utility in index-manager for removing a memory from the review queue
- `_erased.json` audit log schema for tracking erasures without preserving erased content
- 16 new tests for erasure utilities
- npm release scripts (`release:beta`, `release:patch`, `release:minor`, `release:major`)

### Fixed

- Windows CI compatibility: explicit test file listing, bash shell for glob expansion, `path.join` in tests
- Relaxed stress test thresholds for CI runners (5x multiplier)

## [0.1.0-beta.1] - 2026-02-22

### Added

- 375x faster `rankMemories` via batch spreading activation

### Fixed

- Clamped recency bonus and optimized spreading activation loop
- Normalized `package.json` bin and repository fields for npm

## [0.1.0] - 2026-02-15

Initial beta release.

### Added

- 9 slash commands: `init`, `memorize`, `remember`, `review`, `explore`, `consolidate`, `forget`, `sleep`, `status`
- Neuroscience-inspired scoring with Ebbinghaus exponential decay
- Associative memory network with spreading activation (BFS, 2-hop, 50% decay per hop)
- Hebbian learning for co-retrieved memories
- Context-dependent recall scoring (project, topic Jaccard, task type matching)
- Spaced reinforcement with logarithmic spacing multiplier and diminishing returns
- 3 cognitive memory types: episodic, semantic, procedural (each with distinct decay behavior)
- Salience-based protection preventing auto-pruning of important memories
- Confidence tracking with contradiction detection
- 9-phase sleep cycle: replay, synaptic homeostasis, knowledge propagation, semantic crystallization, reorganize, consolidate, prune, REM dreaming, expertise detection
- SM-2 spaced repetition review scheduler
- Memory consolidation with salience anchoring
- Archive system with recoverable memories
- Multi-factor recall scoring formula (relevance, strength, recency, spreading, context, salience)
- Multi-runtime installer: Claude Code, Gemini CLI, OpenAI Codex CLI
- Interactive and non-interactive installation modes
- Session lifecycle hook definitions (session-start, session-end)
- 114 tests covering scorer, index-manager, and end-to-end lifecycle
- Zero external dependencies
