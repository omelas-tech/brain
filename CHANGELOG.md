# Changelog

All notable changes to brain-memory will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
