<p align="center">
  <img src="assets/icon.png" alt="Brain Memory" width="128" height="128">
</p>

<h1 align="center">Brain Memory</h1>

<p align="center">
  <a href="https://github.com/omelas-tech/brain/actions/workflows/ci.yml"><img src="https://github.com/omelas-tech/brain/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/brain-memory"><img src="https://img.shields.io/npm/v/brain-memory" alt="npm version"></a>
  <a href="https://github.com/omelas-tech/brain/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/brain-memory" alt="license"></a>
</p>

A hierarchical, file-system-based memory plugin for AI coding agents. Inspired by human neuroscience — memories are organized into deep nested life-domain categories, connected via associative networks, strengthened through spaced recall, and naturally decay over time.

Works with **Claude Code**, **Gemini CLI**, **OpenAI Codex CLI**, and **OpenCode**.

```
~/.brain/
├── professional/
│   └── companies/
│       └── acme-corp/
│           └── projects/
│               └── alpha-launch.md        ⚡ 0.88
├── personal/
│   └── education/
│       └── typescript-generics.md         ⚡ 0.72
├── social/
│   └── communities/
│       └── open-source-contrib.md         ⚡ 0.65
└── family/
    └── events/
        └── annual-reunion-planning.md     ⚡ 0.55
```

## Why Brain Memory?

Existing AI memory solutions use flat databases with tag-based retrieval. Brain Memory is different:

- **The directory tree IS the semantic structure** — `professional/companies/acme/projects/` tells the agent everything about context without vector search
- **Human-inspectable** — Browse your "brain" in any file explorer
- **Git-friendly** — Full version history of how memories evolve
- **Strength + decay** — Recalled memories get stronger, forgotten ones fade. Just like your brain
- **Associative network** — Memories link to each other with weighted connections. Recalling one activates related ones automatically
- **Context-dependent recall** — Memories encoded in a similar context to the current session are scored higher
- **Spaced reinforcement** — Memories recalled after longer intervals get bigger boosts, cramming produces diminishing returns
- **Cognitive types** — Episodic, semantic, and procedural memories each decay differently, just like in the brain
- **Always-present knowledge** — Pin critical conventions and preferences so they load every session, bypassing recall and never decaying — the facts your agent must never miss
- **Procedural skills** — Reusable how-to workflows with progressive disclosure, learned automatically from repeated experience and exportable to your agent's native skills
- **On-demand depth** — Subcategories are created as needed, not pre-defined
- **Consolidation** — Weak related memories merge into stronger combined knowledge
- **Zero dependencies** — Pure file I/O, no databases, no servers, no embeddings required

## Install

```bash
npm install -g brain-memory@beta
brain
```

The first command installs the package globally — this gives you both the interactive setup wizard and the `brain` CLI (`brain recall`, `brain memorize`, `brain reinforce`, …) that agents rely on for deterministic scoring.

The second command runs the setup wizard, which asks which runtime(s) to configure (Claude Code, Gemini CLI, OpenAI Codex CLI, or all) and whether to install globally or for the current project.

### Non-interactive

```bash
brain --claude --global   # Claude Code, global
brain --gemini --local    # Gemini CLI, local project
brain --codex --global    # OpenAI Codex CLI, global
brain --opencode --global # OpenCode, global
brain --all --global      # All runtimes, global
```

### Update

```bash
npm install -g brain-memory@beta
brain update
```

The first command updates the package and the `brain` CLI. The second command refreshes the slash command prompts for your installed runtimes. Target specific runtimes with `--claude`, `--gemini`, `--openai`, or `--all`.

> **Upgrading from an older version?** The separate binaries (`brain-recall`, `brain-memorize`, `brain-reinforce`, `brain-cloud`, `brain-memory`) were unified into a single `brain` dispatcher — use `brain recall`, `brain memorize`, `brain reinforce`, `brain cloud <…>` instead. Run `brain update` to refresh your runtime prompts to the new command surface.

> **Why not `npx`?** `npx` runs the setup wizard in a temporary directory that is discarded after execution. The `brain` CLI (`brain recall`, `brain memorize`, `brain reinforce`) won't be available in your PATH, which means agents will fall back to less reliable manual file operations. Always use `npm install -g` to ensure everything works correctly.

### Uninstall

```bash
brain uninstall
npm uninstall -g brain-memory
```

The first command removes slash commands and prompt sections from your agent configs. The second removes the package and CLI tools. Your `~/.brain/` directory (memories) is preserved by default. Add `--delete-data` to the uninstall command to remove it too. Use `--yes` to skip confirmation prompts.

### Manual Install

Copy the `commands/brain/` directory to your agent's commands folder:

```bash
# Claude Code
cp -r commands/brain/ ~/.claude/commands/brain/

# Gemini CLI
cp -r commands/brain/ ~/.gemini/commands/brain/

# OpenAI Codex CLI (each command becomes a skill)
for f in commands/brain/*.md; do
  name=$(basename "$f" .md)
  mkdir -p ~/.codex/skills/brain-"$name"
  cp "$f" ~/.codex/skills/brain-"$name"/SKILL.md
done
```

Then append the contents of the corresponding prompt file to your agent's instructions file:
- `prompts/claude.md` → `CLAUDE.md`
- `prompts/gemini.md` → `GEMINI.md`
- `prompts/openai.md` → `AGENTS.md`

## Commands

The everyday loop is **ambient** — `remember` and `memorize` run automatically at session start/end, so you rarely type a command. The surface is a small core plus a background maintenance job:

| Command | Description |
|---------|-------------|
| `/brain:remember [query]` | Recall relevant memories with spreading activation and context matching |
| `/brain:memorize [topic] [--sync]` | Store memories from current session context (add `--sync` to auto-push) |
| `/brain:status` | Dashboard with brain health metrics and recommendations |
| `/brain:pin [id\|query]` | Pin a memory to the always-present tier — loads every session, never decays. Toggles: also unpins (`--off`) |
| `/brain:forget [target]` | Decay, archive, or remove memories. `--deep` performs forensic erasure — traces and removes every reference |
| `/brain:sync [subcommand]` | Sync via Brain Cloud, Git remote, or export/import (auto-initializes the brain on first run) |
| `/brain:skills [list\|show\|add\|use\|remove\|export]` | Manage procedural skills — reusable how-to workflows with progressive disclosure |
| `/brain:sleep [scope]` | Full maintenance cycle — 9 neuroscience-inspired phases (replay, consolidation, review reinforcement, pruning, dreaming, …). Usually runs automatically/in the background |

## Session Lifecycle

Brain Memory works automatically in the background — no commands needed for basic context awareness.

### Session Start

When a session begins and `~/.brain/` exists, the agent makes a single `brain session-start` call. This aggregator returns one deterministic, **token-budget-bounded** payload so the brain can never bloat the context window (the budget lives in `~/.brain/config.json`):

1. **Pinned memories** — always-present conventions and preferences, injected verbatim regardless of recall score
2. **Skills index** — the name + description of each available procedural skill (~100 tokens each; full instructions are loaded only when a task matches)
3. **Context recall** — the top memories relevant to the current project
4. **Review queue + low-confidence alerts**, then a brief status line:

```
◉ Brain active — 42 memories loaded (8 in current project context)
📋 3 memories due for review — reinforced automatically during /brain:sleep
```

The agent treats pinned facts as active constraints, notes which skills exist, silently internalizes relevant memories, and references them naturally during the session — no information dump.

### Ambient Session Tracking

Throughout the session, the agent maintains a running mental log of notable events — decisions made, things learned, insights realized, significant experiences. This is purely internal awareness with no file writes. It ensures that early-session events aren't forgotten by the time the session ends.

### Periodic Memory Checkpoint

Every ~10 substantive interactions (file edits, architecture decisions, debugging breakthroughs), the agent evaluates whether memorizable content has accumulated. If so, it appends a brief reminder to its next response:

```
◉ Notable decisions and learnings this session — /brain:memorize when ready
```

This never interrupts your flow — it's a one-liner appended to an existing response, at most once per ~10 interactions. The counter resets after you run `/brain:memorize`.

### Session End

When a session ends, the agent performs two steps in order:

1. **Saves session context** to `~/.brain/contexts.json` — always, even for trivial sessions. This includes a `notable_unsaved` field listing items you didn't memorize, so future sessions can reference what happened.

2. **Suggests memorization** if the session contained meaningful decisions, learnings, or insights:

```
💡 This session contained notable decisions and learnings.
   Would you like to store them as brain memories?
   Run /brain:memorize to capture them before this context is lost.
```

The agent never auto-memorizes without user consent. Context is saved proactively — the agent doesn't wait for an explicit goodbye signal.

## How It Works

### Memory Lifecycle

```
Create → Store → Decay → Recall → Reinforce → Review → Sleep → Archive
                                      ↑                   │
                                      └── Associations ────┘
```

1. **Create** — When you use `/brain:memorize`, the agent analyzes the session and extracts significant decisions, learnings, insights, or experiences
2. **Store** — Each memory is filed into the hierarchy at the appropriate depth, with YAML frontmatter tracking metadata. Association edges are created to related memories.
3. **Decay** — Memories naturally weaken over time: `effective_strength = base_strength * (decay_rate ^ days_since_access)`
4. **Recall** — `/brain:remember` searches, scores with spreading activation and context matching, and returns the best memories. Archived memories are searched as a fallback.
5. **Reinforce** — Each recall applies spaced reinforcement (longer gaps = bigger boosts) and improves the memory's decay resistance
6. **Review** — SM-2 spaced repetition surfaces memories at optimal intervals for long-term retention; reinforcement runs automatically during the sleep cycle
7. **Sleep** — `/brain:sleep` performs a 9-phase maintenance cycle inspired by real neuroscience (replay, consolidation, review reinforcement, pruning, dreaming, …), usually run automatically/in the background
8. **Archive** — Fully decayed memories move to `_archived/` (recoverable and searchable) or can be permanently deleted

### Neuroscience Foundations

Brain Memory is grounded in peer-reviewed neuroscience research. Here's how each mechanism maps to the brain:

| Brain Mechanism | Implementation |
|-----------------|---------------|
| **Spreading activation** | Recalling memory A automatically surfaces linked memories B and C via weighted association graph |
| **Hebbian learning** | "Neurons that fire together wire together" — memories recalled together strengthen mutual links |
| **Context-dependent recall** | Memories encoded in a similar context (project, task type) are scored higher at retrieval |
| **Spacing effect** | Longer intervals between recalls produce larger strength boosts; cramming yields diminishing returns |
| **Ebbinghaus decay** | Exponential forgetting curve with per-memory decay rates |
| **Episodic → Semantic** | Event-specific memories crystallize into abstract principles during sleep |
| **Synaptic homeostasis (SHY)** | Global strength downscaling during sleep prevents inflation, then selectively re-boosts important memories |
| **REM dreaming** | Creative cross-domain association discovery via analogical reasoning |
| **Memory reconsolidation** | Recent knowledge updates and reshapes older related memories during sleep |
| **Cue-dependent forgetting** | Archival preserves availability — memories aren't deleted, just moved to `_archived/` |
| **Targeted forgetting** | Deep erasure that traces and removes all references, like how the brain can selectively erase specific memory traces |

### Memory Types

| Type | Base Strength | Daily Decay | Use Case |
|------|:---:|:---:|---|
| `insight` | 0.90 | 0.997 | Deep realizations, patterns discovered |
| `decision` | 0.85 | 0.995 | Choices made and their rationale |
| `goal` | 0.80 | 0.993 | Objectives and aspirations |
| `experience` | 0.75 | 0.985 | Notable events or processes |
| `learning` | 0.70 | 0.990 | New knowledge acquired |
| `relationship` | 0.70 | 0.997 | Connections between people/things |
| `preference` | 0.60 | 0.998 | User style and preferences |
| `observation` | 0.40 | 0.950 | Casual facts or notices |

### Cognitive Types

Each memory is also classified by how the brain processes it:

| Cognitive Type | Strength Modifier | Decay Behavior | Example |
|----------------|:-:|---|---|
| **Episodic** | +0.10 | Faster decay — event details fade | "The deploy failed Tuesday because of X" |
| **Semantic** | default | Standard decay — stable knowledge | "React hooks must follow rules of hooks" |
| **Procedural** | -0.10 | Very slow decay — skills persist | "Steps to debug memory leaks" |

During sleep, frequently-recalled episodic memories are **crystallized** into semantic memories — the specific event fades but the lesson persists. This mirrors how humans extract general principles from repeated experiences.

### Always-Present Memories (Pinning)

Recall is probabilistic — a stored preference only applies if scoring happens to surface it. For the facts an agent must **never** miss (coding conventions, standing decisions, hard constraints), that's not good enough. Pinning fixes it:

- **`pinned`** — the memory is injected at **every** session start regardless of recall score, and is **decay-exempt** (it never fades). Scope it `global` (loads everywhere) or `project:<name>` (loads only in that project).
- **`stable`** — an independent flag that exempts a memory from decay and pruning **without** forcing it to always load — for timeless facts you recall on demand but don't want to fade.

```bash
brain pin <id> --scope global --priority 1   # or: /brain:pin always use tabs
```

Pinned and stable memories are skipped by sleep-cycle homeostasis and pruning, and `/brain:memorize` proactively proposes pinning durable conventions. The always-present set is budget-capped (`pin_budget_tokens`) so it can't crowd out the context window. This maps cleanly to the **semantic memory** type in the [CoALA](https://arxiv.org/abs/2309.02427) agent-memory model — knowledge that is always in context — decomposed into two orthogonal properties (always-loaded vs. non-decaying).

### Procedural Skills

Procedural memory is *how* to do things — reusable, step-by-step workflows stored as `~/.brain/_skills/<name>/SKILL.md`. To keep them from flooding the context window, skills use **three-level progressive disclosure**:

| Level | When | What loads |
|-------|------|------------|
| **L0** | Every session start | Only each skill's name + description (~100 tokens) |
| **L1** | A task matches a skill | The full `SKILL.md` step-by-step instructions |
| **L2** | A step needs them | Referenced `resources/` (templates, scripts) |

```bash
brain skill list                       # advertised skills (L0)
brain skill show structured-code-review # full instructions (L1)
brain skill use structured-code-review  # record outcome (--failed weakens it)
brain skill export structured-code-review --target claude  # → native .claude/skills/
```

Skills strengthen on successful `use` and weaken on `--failed` — one that fails too often demotes itself out of the advertised L0 index. And they aren't only hand-authored: during sleep, Brain **crystallizes** recurring task-solving patterns from repeated experience into new skills (user-confirmed). Finally, `brain skill export` emits a skill in your agent's **native** format so it becomes directly executable.

### Memory File Format

Each memory is a Markdown file with YAML frontmatter:

```markdown
---
id: mem_20260213_a3f2c1
type: decision
cognitive_type: semantic
created: 2026-02-13T14:30:00Z
last_accessed: 2026-02-13T14:30:00Z
access_count: 3
recall_history: ["2026-02-13T14:30:00Z", "2026-02-13T18:00:00Z", "2026-02-14T09:00:00Z"]
strength: 0.92
decay_rate: 0.995
salience: 0.8
confidence: 0.9
tags: [architecture, microservices, scaling]
related: [mem_20260210_b4e5d6]
source: project-alpha-session
encoding_context:
  project: project-alpha
  topics: [architecture, scaling, kafka]
  task_type: designing
---

# Chose Event-Driven Architecture for Project Alpha

We decided to use event-driven architecture with Kafka instead of synchronous
REST calls between services, because the traffic analysis showed 10x burst
patterns that would overwhelm synchronous endpoints.

## Context

Sprint planning for Q2, evaluating scaling strategy for the notification system.

## Key Details

- Kafka chosen over RabbitMQ for its replay capability
- Event schema registry added to prevent breaking changes
- Estimated 3-week implementation vs 1-week for REST (but REST would need rework at scale)

## Connections

Related to the capacity planning decision (mem_20260210_b4e5d6) where we
identified the 10x burst pattern in notification traffic.
```

### Scoring Formula

When recalling memories, each candidate is scored using a 6-factor formula:

```
score = 0.38 * relevance
      + 0.18 * decayed_strength
      + 0.08 * recency_bonus
      + 0.14 * spreading_bonus
      + 0.14 * context_match
      + 0.08 * salience
```

- **relevance** (0.38) — How well the memory matches the query
- **decayed_strength** (0.18) — Base strength after time decay
- **recency_bonus** (0.08) — Linear bonus that fades over one year
- **spreading_bonus** (0.14) — Activation received from linked memories in the association graph
- **context_match** (0.14) — How similar the encoding context is to the current session
- **salience** (0.08) — Emotional/motivational significance

The agent then decides the response strategy:
- **Single strong match** (top score > 0.7) → Return the full memory
- **Multiple related** (2-5 candidates > 0.4) → Synthesize a consolidated response
- **Many weak** (>5, all < 0.4) → List candidates for the user to choose
- **No active matches** → Search the archive, then suggest alternatives

### Associative Network

Memories are connected via weighted edges in `~/.brain/associations.json`:

```json
{
  "edges": {
    "mem_20260213_a3f2c1": {
      "mem_20260210_b4e5d6": {
        "weight": 0.45,
        "co_retrievals": 3,
        "last_activated": "2026-02-14T09:00:00Z",
        "origin": "co_retrieval"
      }
    }
  }
}
```

**Spreading activation**: When you recall memory A, activation spreads along weighted edges to surface related memories B and C — even if they didn't match the query directly. Activation decays by 50% per hop, up to 2 hops deep.

**Hebbian learning**: When multiple memories are recalled together, their mutual edge weights are strengthened: `new_weight = min(1.0, weight + 0.10 * (1.0 - weight))`. Memories that fire together wire together.

**Link dynamics**: Edges decay over time (`weight * 0.998^days`) and are pruned below 0.05 during sleep. New links are created automatically when memories share 2+ tags (weight 0.10) or are explicitly related (weight 0.20).

### Spaced Reinforcement

Spaced reinforcement rewards optimal recall timing:

```
spacingMultiplier = min(3.0, 1.0 + log2(1 + daysSinceLastAccess))
diminishingFactor = 1.0 / (1.0 + 0.1 * recallCount)
boost = 0.05 * spacingMultiplier * diminishingFactor
```

| Scenario | Boost |
|----------|:---:|
| 1 day gap, first recall | +0.05 |
| 7 day gap | +0.08 |
| 30 day gap | +0.10 |
| Same day, 20th recall (cramming) | +0.02 |

Each recall also improves the memory's decay rate: `new_rate = rate + 0.10 * (0.999 - rate)`. Memories become progressively more forgetting-resistant with each retrieval.

### Salience & Confidence

**Salience** (0.0-1.0) captures emotional/motivational significance. High-salience memories (>= 0.7) are **never auto-pruned** — they must be explicitly forgotten via `/brain:forget`. They also serve as anchors during consolidation.

**Confidence** (0.0-1.0) tracks epistemic certainty. Set at encoding based on source quality, reduced when contradictions are found during Knowledge Propagation (-0.20), boosted during validations (+0.10). Low-confidence memories are flagged during recall.

### Consolidation

When memories decay below the threshold (default: 0.3), they become candidates for consolidation. The agent groups related weak memories by path proximity, tag overlap, and temporal closeness, then merges them into a single stronger memory:

```
consolidated_strength = max(source_strengths) + 0.15   (capped at 1.0)
consolidated_decay    = min(source_decay_rates)         (slowest decay wins)
```

The highest-salience memory in each group serves as the anchor — its framing and key details take priority in the synthesis. Original memories are moved to `_archived/` (recoverable and searchable).

### Sleep Cycle

`/brain:sleep` is the brain's overnight maintenance — inspired by how human brains reorganize memories during sleep. It runs nine phases:

1. **Replay** — Scans all memories and computes current decayed strengths, categorizing into tiers (Strong / Moderate / Weak / Fading)
2. **Synaptic Homeostasis** — If mean strength exceeds 0.5, proportionally scales down ALL strengths to prevent inflation, then selectively re-boosts high-salience, recently-accessed, and frequently-recalled memories. Based on Tononi & Cirelli's SHY hypothesis.
3. **Knowledge Propagation** — Evaluates recent memories against the hierarchy (ancestors, descendants, siblings, tag-related, association-linked) and updates existing memories through enrichment, contradiction detection, validation, obsolescence marking, and cross-referencing. Based on memory reconsolidation research.
4. **Semantic Crystallization** — Finds frequently-recalled episodic memories and extracts generalizable principles into new semantic memories. The event details begin fading but the lesson persists.
5. **Reorganize** — Detects flat clusters (3+ related memories at the same level) and restructures them into deeper sub-categories automatically
6. **Consolidate** — Merges weak related memories into stronger combined knowledge with salience anchoring
7. **Prune** — Archives memories that have faded below 0.1 strength (salience-protected memories are exempt)
8. **REM Dreaming** — Selects random memories from different categories and discovers creative cross-domain connections via analogical reasoning. Scored by novelty, utility, and surprise.
9. **Expertise Detection** — Identifies dense knowledge areas and generates expertise profiles, then populates the spaced repetition review queue

| Expertise Level | Score | Meaning |
|-------|:---:|---------|
| Awareness | 0.2 - 0.4 | Surface familiarity |
| Working Knowledge | 0.4 - 0.6 | Competent with reference |
| Deep Knowledge | 0.6 - 0.8 | Strong command, can reason about trade-offs |
| Expert | 0.8 - 1.0 | Mastery — dense, frequently-recalled, long-standing |

Each expertise area gets an `_expertise.md` profile documenting what you know well, knowledge gaps, and contributing memories. Sleep can target a specific subtree (e.g., `/brain:sleep professional/skills`) or process the entire brain.

### Spaced Repetition Review

Brain Memory implements the SM-2 algorithm to surface memories at optimal intervals for long-term retention. The review queue is generated and reinforced during `/brain:sleep`, and tracks:

- **Interval** — Time until next review (grows exponentially with successful recalls)
- **Ease factor** — How easily the memory is recalled (adjusts based on recall quality 1-5)
- **Review count** — Total number of review sessions

Failed recalls reset the interval to 1 day. Successful recalls extend the interval by the ease factor. This ensures you spend time on memories that need reinforcement, not ones you already know well.

### Cross-Agent Memory Sharing

`~/.brain/` is a single global directory in the user's home folder. All memories are shared across every project and every supported agent automatically. A decision stored by Claude Code in one project is immediately available to Gemini CLI, OpenAI Codex CLI, or OpenCode in any other project — no configuration, no export, no per-project setup. The format is agent-agnostic: plain Markdown files with YAML frontmatter, readable by any tool.

Brain Memory is **model-agnostic** as well as agent-portable: because memory is plain files rather than embeddings welded to a particular model, the LLM underneath your agent can be anything — GPT, Claude, Gemini, or any model routed through a gateway — and your memory is unaffected. **Switch your model or switch your agent, and you keep remembering and pick up exactly where you left off.**

To share memories across different machines, use `/brain:sync` (see below).

### Portable Sync — your memory, no lock-in

**Your brain is plain files in a folder — sync it however you already sync files.** No account or cloud provider is required.

**Any synced folder** — Point `BRAIN_DIR` at a folder your existing tools already sync, and you're done:

```bash
export BRAIN_DIR="$HOME/Google Drive/brain"   # or Dropbox, iCloud Drive, OneDrive, Syncthing…
```

**Git remote** — `/brain:sync` push/pull `~/.brain/` to any private Git repository (GitHub, GitLab, Codeberg, or self-hosted), using your existing Git/SSH auth.

**Export/Import** — Pack the entire brain into a single encrypted file for manual transfer via USB, email, or any file-sharing service.

**Brain Cloud** (optional) — A hosted, zero-config hub if you'd rather not run your own. Entirely optional — everything above works without it.

**Key features:**
- **Manual push/pull** — No background watchers, no auto-sync. You control when data moves.
- **Optional encryption** — AES-256-GCM encryption with a user-provided passphrase. When enabled, all files are encrypted before committing or exporting.
- **Merge mode** — Import supports merge mode (only import newer files) or overwrite mode.
- **Zero dependencies** — Uses Node.js built-in `crypto` and the system `git` binary.

**Setup:**
1. Create a private Git repo (e.g., `gh repo create brain-data --private`)
2. Run `/brain:sync setup git@github.com:you/brain-data.git`
3. Use `/brain:sync push` and `/brain:sync pull` to keep memories in sync

For one-off transfers, use `/brain:sync export` and `/brain:sync import <path>`.

Sync state is stored locally in `~/.brain/.sync/` and is never pushed to the remote.

### Brain in Claude apps (web & mobile) — beta

Beyond the CLI, you can recall your brain from the **Claude apps** (web, desktop, and your
**phone**) via the **Brain connector** — a remote MCP server hosted by [Brain Cloud](https://app.brainmemory.ai).
Add it once on claude.ai (**Settings → Connectors → Add custom connector → `https://mcp.brainmemory.ai/mcp`**),
sign in with the Google account holding your cloud brain, and it syncs to every Claude client on
your account. Read-only today (`Recall memories`, `Brain status`); writes are coming.

→ Full guide: **[Use Brain in Claude apps](https://brainmemory.ai/docs/getting-started/claude-apps)**

## File Structure

```
~/.brain/
├── index.json              # Memory inventory — fast lookup for all memories
├── config.json             # Working-memory token budgets (session-start injection)
├── associations.json       # Weighted associative network between memories
├── contexts.json           # Session context snapshots for context-dependent recall
├── review-queue.json       # Spaced repetition scheduling
├── pinned.json             # Always-present tier manifest (pinned memory IDs + scope)
├── skills-index.json       # Advertised procedural skills (L0 — name + description)
├── _skills/                # Procedural skills
│   └── <skill-name>/
│       ├── SKILL.md        # Advertised description + step-by-step instructions
│       └── resources/      # Optional templates/scripts (loaded only at execution)
├── professional/           # Work, career, technical skills
│   ├── _meta.json          # Category metadata and stats
│   ├── _expertise.md       # Generated expertise profile
│   ├── companies/          # On-demand: created when first needed
│   │   └── <company>/
│   │       ├── projects/
│   │       └── decisions/
│   ├── skills/
│   └── career/
├── personal/               # Education, health, hobbies, goals
│   ├── _meta.json
│   ├── education/
│   ├── health/
│   └── goals/
├── social/                 # Communities, networks, collaborations
│   ├── _meta.json
│   └── communities/
├── family/                 # Family relationships and events
│   ├── _meta.json
│   └── events/
├── _consolidated/          # Merged memories from consolidation
│   └── _meta.json
├── _archived/              # Decayed memories (recoverable + searchable)
│   ├── _meta.json
│   └── index.json          # Searchable archive index
└── .sync/                  # Sync state (local only, never pushed)
    ├── config.json          # Remote URL, encryption flag
    └── repo/                # Hidden git repo for sync
```

Subdirectories are created **on demand** — the agent decides placement depth based on how specific the memory is. A generic career thought lands in `professional/`, but a specific deployment incident goes to `professional/companies/acme/projects/alpha/`.

## Configuration

Brain configuration lives in `~/.brain/index.json` under the `config` key:

```json
{
  "config": {
    "max_depth": 6,
    "consolidation_threshold": 0.3,
    "decay_check_interval_days": 7,
    "strength_boost_on_recall": 0.05,
    "auto_consolidate": true,
    "propagation_window_days": 7,
    "association_config": {
      "co_retrieval_boost": 0.10,
      "link_decay_rate": 0.998,
      "link_prune_threshold": 0.05,
      "spreading_activation_depth": 2,
      "spreading_activation_decay": 0.5
    }
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `max_depth` | 6 | Maximum directory nesting depth |
| `consolidation_threshold` | 0.3 | Strength below which memories are consolidation candidates |
| `decay_check_interval_days` | 7 | How often to suggest decay maintenance |
| `strength_boost_on_recall` | 0.05 | Base strength increase per recall event |
| `auto_consolidate` | true | Suggest consolidation when candidates are found |
| `propagation_window_days` | 7 | How far back to look for recent memories during knowledge propagation |
| `association_config.co_retrieval_boost` | 0.10 | Hebbian reinforcement increment for co-retrieved memories |
| `association_config.link_decay_rate` | 0.998 | Daily decay factor for association edge weights |
| `association_config.link_prune_threshold` | 0.05 | Minimum weight before an association link is pruned |
| `association_config.spreading_activation_depth` | 2 | Maximum hops for spreading activation traversal |
| `association_config.spreading_activation_decay` | 0.5 | Decay factor per hop during spreading activation |

### Working-Memory Budget

A separate `~/.brain/config.json` (created lazily with safe defaults) caps how much the brain injects into the context window at session start, so the always-present tier can never crowd out your actual work:

```json
{
  "working_memory_budget_tokens": 3000,
  "pin_budget_tokens": 1500,
  "skills_index_budget_tokens": 800,
  "recall_budget_tokens": 700
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `working_memory_budget_tokens` | 3000 | Total token ceiling for the whole `brain session-start` payload |
| `pin_budget_tokens` | 1500 | Sub-budget for pinned, always-present memories |
| `skills_index_budget_tokens` | 800 | Sub-budget for the advertised skills index (L0) |
| `recall_budget_tokens` | 700 | Sub-budget for context-relevant recalled memories |

Token counts use a dependency-free heuristic stored on each memory at write time. When pins exceed their budget they're selected by `--priority` then strength, and the overflow is reported rather than silently dropped.

## Benchmark

Brain Memory ships with a controlled benchmark suite grounded in the 2025-2026 SOTA in long-term-memory evaluation. The system itself is a direct implementation of the [**CoALA**](https://arxiv.org/abs/2309.02427) agent-memory model (Sumers et al., 2023) — Pinned Tier maps to CoALA's *semantic* memory, procedural skills to *procedural* memory.

**Six scenarios**, each describable in one sentence:

| Id | Pitch | Tests |
|---|---|---|
| **A** *Noisy Project Folder* | "Your brain has 200 memories from 6 projects — does it find the 3 relevant ones?" | Retrieval under distractors (LongMemEval-S analog) |
| **B** *Three Sessions, One Decision* | "Postgres Monday, gRPC rewrite Wednesday, new resource Friday — still Postgres?" | Multi-session continuity + Pinned Tier ablation |
| **C** *The Contradiction Test* | "Tabs, then spaces, then tabs again — which version wins?" | Decay-weighted recency + contradiction handling |
| **D** *Skill Progressive Disclosure* | "Five skills indexed, one needed — does brain load just the one?" | CoALA Phase-2 L0/L1/L2 token efficiency |
| **E** *Continual Coding* | "Five bugs in order — does bug 5 finish faster than bug 1?" | Forward transfer; agent writes memories between tasks |
| **F** *Abstention* | "No deployment target in memory — does the agent ask or invent?" | Confabulation resistance |

**Methodology highlights** — cross-family LLM judge (Claude judges Gemini and vice-versa) with explicit rubric and position-swap; deterministic 200-memory distractor haystack; real `brain session-start` / `brain recall` integration; tokens-per-successful-task as the headline efficiency metric.

> Preliminary smoke results (1 run × Scenario A × Gemini Flash, May 2026): `brain-real` resolves the task at **27.8K tokens-per-success**, vs **50.8K** for naïve context-dump and **86.3K** for brain with pinning disabled — a ~3× token economy improvement attributable directly to the Pinned Tier. Full multi-run results are in progress.

Run the benchmarks yourself:

```bash
cd benchmark
cp .env.example .env   # Add your API keys
npm test               # Unit tests
node harness/runner.js # Full benchmark (cloud APIs)
```

Live methodology and per-scenario detail: [brainmemory.ai/docs/benchmarks](https://brainmemory.ai/docs/benchmarks) · Source: [`benchmark/`](benchmark/)

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, project structure, and how to submit changes.

## References

Brain Memory's architecture and benchmark methodology are grounded in the following work.

### Foundations — the agent-memory model Brain implements

- [**CoALA — Cognitive Architectures for Language Agents**](https://arxiv.org/abs/2309.02427) (arxiv 2309.02427) — Sumers, Yao, Narasimhan, Griffiths. The agent-memory taxonomy Brain implements directly. Pinned Tier → semantic memory, Skills → procedural memory, session-start aggregator → working memory.
- [**MemGPT — LLMs as Operating Systems**](https://arxiv.org/abs/2310.08560) (arxiv 2310.08560) — Packer et al. Paging-style memory management.
- [**Generative Agents — Interactive Simulacra of Human Behavior**](https://arxiv.org/abs/2304.03442) (arxiv 2304.03442) — Park et al. Recency · importance · relevance retrieval blend.
- [**Memory in the Age of AI Agents**](https://arxiv.org/abs/2512.13564) (arxiv 2512.13564) — Comprehensive survey on agent memory architectures.
- [**Mem0**](https://arxiv.org/abs/2504.19413) (arxiv 2504.19413) — Human-like memory reinforcement and decay.
- [**MemOS**](https://arxiv.org/abs/2507.03724) (arxiv 2507.03724) — Memory lifecycle state management.

### Memory benchmarks (the suite this work follows)

- [**LongMemEval**](https://arxiv.org/abs/2410.10813) (arxiv 2410.10813) — distractor haystacks (S / M / Oracle), abstention category, GPT-4o judge with 97% human agreement.
- [**MemoryAgentBench**](https://arxiv.org/abs/2507.05257) (arxiv 2507.05257) — four-competency framework; FactConsolidation inspired Scenario C.
- [**SWE-Bench-CL**](https://arxiv.org/abs/2507.00014) (arxiv 2507.00014) — repo-scoped chronological evaluation; template for Scenario E.
- [**LoCoMo**](https://arxiv.org/abs/2402.17753) (arxiv 2402.17753) — long-conversation memory benchmark.
- [**MIRIX**](https://arxiv.org/abs/2507.07957) (arxiv 2507.07957) — realistic synthetic-but-grounded memory benchmarks.

### Methodology — judging and benchmark hygiene

- [**Preference Leakage in LLM-as-judge**](https://arxiv.org/abs/2502.01534) (arxiv 2502.01534) — drives cross-family judging.
- [**When Judgment Becomes Noise — position bias**](https://arxiv.org/abs/2509.20293) (arxiv 2509.20293) — drives position-swap mitigation.
- [**Silent Judge — shortcut bias**](https://arxiv.org/abs/2509.26072) (arxiv 2509.26072) — drives rubric-based judging.
- [**LastingBench**](https://arxiv.org/abs/2506.21614) (arxiv 2506.21614) — benchmark-leakage defense.

### Neuroscience

- [**Ebbinghaus forgetting curve**](https://en.wikipedia.org/wiki/Forgetting_curve) — exponential memory decay.
- [**Spreading activation**](https://en.wikipedia.org/wiki/Spreading_activation) — Collins & Loftus network model of semantic memory.
- [**Hebbian theory**](https://en.wikipedia.org/wiki/Hebbian_theory) — "neurons that fire together wire together."
- [**Synaptic homeostasis hypothesis**](https://doi.org/10.1016/j.neuron.2013.10.024) — Tononi & Cirelli's theory of sleep function.
- [**SM-2 algorithm**](https://en.wikipedia.org/wiki/SuperMemo#Description_of_SM-2_algorithm) — spaced repetition scheduling.
- [**Memory reconsolidation**](https://en.wikipedia.org/wiki/Memory_consolidation#Reconsolidation) — recalling memories makes them temporarily malleable.

### Related projects

- [get-shit-done](https://github.com/gsd-build/get-shit-done) — Structured file-based workflow orchestration for AI agents.

## License

MIT
