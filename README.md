<p align="center">
  <img src="assets/icon.png" alt="Brain Memory" width="128" height="128">
</p>

<h1 align="center">Brain Memory</h1>

<p align="center">
  <a href="https://github.com/onurkarali/brain/actions/workflows/ci.yml"><img src="https://github.com/onurkarali/brain/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/brain-memory"><img src="https://img.shields.io/npm/v/brain-memory" alt="npm version"></a>
  <a href="https://github.com/onurkarali/brain/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/brain-memory" alt="license"></a>
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

| Command | Description |
|---------|-------------|
| `/brain:init` | Initialize `~/.brain/` directory structure with default categories |
| `/brain:memorize [topic] [--sync]` | Store memories from current session context (add `--sync` to auto-push) |
| `/brain:remember [query]` | Recall relevant memories with spreading activation and context matching |
| `/brain:review [scope]` | Spaced repetition review session for due memories |
| `/brain:explore [category]` | Browse the brain hierarchy with visual tree view |
| `/brain:consolidate [scope]` | Merge related weak memories into stronger combined ones |
| `/brain:forget [target]` | Decay, archive, or remove memories |
| `/brain:sunshine [target]` | Deep forensic erasure — trace and remove all references |
| `/brain:sleep [scope]` | Full maintenance cycle — 9 neuroscience-inspired phases |
| `/brain:status` | Dashboard with brain health metrics and recommendations |
| `/brain:sync [subcommand]` | Sync memories via Git remote or export/import for portability |

## Session Lifecycle

Brain Memory works automatically in the background — no commands needed for basic context awareness.

### Session Start

When a session begins and `~/.brain/` exists, the agent automatically:

1. Reads the brain index and loads the top 3-5 memories relevant to the current project
2. Checks the review queue for memories due for spaced repetition
3. Outputs a brief status line:

```
🧠 Brain active — 42 memories loaded (8 in current project context)
📋 3 memories due for review — run /brain:review
```

The agent silently internalizes relevant memories and references them naturally during the session — no information dump.

### Ambient Session Tracking

Throughout the session, the agent maintains a running mental log of notable events — decisions made, things learned, insights realized, significant experiences. This is purely internal awareness with no file writes. It ensures that early-session events aren't forgotten by the time the session ends.

### Periodic Memory Checkpoint

Every ~10 substantive interactions (file edits, architecture decisions, debugging breakthroughs), the agent evaluates whether memorizable content has accumulated. If so, it appends a brief reminder to its next response:

```
🧠 Notable decisions and learnings this session — /brain:memorize when ready
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
6. **Review** — `/brain:review` implements SM-2 spaced repetition, surfacing memories at optimal intervals for long-term retention
7. **Sleep** — `/brain:sleep` performs a 9-phase maintenance cycle inspired by real neuroscience
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

`/brain:review` implements the SM-2 algorithm to surface memories at optimal intervals for long-term retention. The review queue is generated during sleep and tracks:

- **Interval** — Time until next review (grows exponentially with successful recalls)
- **Ease factor** — How easily the memory is recalled (adjusts based on recall quality 1-5)
- **Review count** — Total number of review sessions

Failed recalls reset the interval to 1 day. Successful recalls extend the interval by the ease factor. This ensures you spend time on memories that need reinforcement, not ones you already know well.

### Cross-Agent Memory Sharing

`~/.brain/` is a single global directory in the user's home folder. All memories are shared across every project and every supported agent automatically. A decision stored by Claude Code in one project is immediately available to Gemini CLI or Codex CLI in any other project — no configuration, no export, no per-project setup. The format is agent-agnostic: plain Markdown files with YAML frontmatter, readable by any tool.

To share memories across different machines, use `/brain:sync` (see below).

### Portable Sync

`/brain:sync` provides two ways to sync memories across devices — no OAuth apps, no cloud provider setup.

**Git remote** — Push/pull `~/.brain/` to any private Git repository. Works with GitHub, GitLab, Codeberg, or any self-hosted Git server. Uses your existing Git/SSH authentication — no additional credentials needed.

**Export/Import** — Pack the entire `~/.brain/` into a single encrypted file for manual transfer via USB, email, or any file-sharing service.

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

## File Structure

```
~/.brain/
├── index.json              # Memory inventory — fast lookup for all memories
├── associations.json       # Weighted associative network between memories
├── contexts.json           # Session context snapshots for context-dependent recall
├── review-queue.json       # Spaced repetition scheduling
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

## Benchmark

Empirical benchmarks show that agents with Brain Memory produce **more consistent** and **more successful** outputs across sessions.

| Scenario | What it tests | Consistency Improvement | Success Improvement |
|----------|---------------|:---:|:---:|
| Multi-Session Continuity | Decisions carry from Session 1 → Session 2 | **+26.2%** | 0% |
| Cross-Agent Consistency | All agents follow memorized style guide | 0% | 0% |
| Accumulated Knowledge | 5 sessions of learning → better Session 6 | **+7.3%** | 0% |
| Error Pattern Learning | Past debugging → faster fix | **+4.8%** | 0% |
| Preference Retention | Preferences applied without re-stating | **+34.7%** | **+33.3%** |

**Per-agent consistency gains (Scenario 1 — Continuity):**

| Agent | With Brain | Without Brain | Improvement |
|-------|:---:|:---:|:---:|
| Claude Code | 0.944 | 0.645 | +46.4% |
| Gemini CLI | 0.822 | 0.555 | +48.1% |
| Codex CLI | 0.767 | 0.545 | +40.7% |

**Preference retention (Scenario 5) — the strongest result:**

| Agent | With Brain | Without Brain | Notes |
|-------|:---:|:---:|:---|
| Claude Code | 0.866 / PASS | 0.359 / **FAIL** | Brain prevented failure |
| Gemini CLI | 0.800 / PASS | 0.534 / PASS | +49.8% consistency |
| Codex CLI | 0.934 / PASS | 0.666 / PASS | +40.2% consistency |

> Average across 5 scenarios: **+18.3% consistency**, **+33.3% success improvement**. Agents with Brain Memory use more tokens (memory context is injected as prompt), but the consistency and reliability gains justify the cost. In the preference scenario, Claude Code without Brain Memory failed entirely — with Brain Memory, it passed every run.

Run the benchmarks yourself:

```bash
cd benchmark
cp .env.example .env   # Add your API keys
npm test               # Unit tests
node harness/runner.js # Full benchmark (cloud APIs)
```

Full methodology, per-scenario breakdowns, and raw data: [`benchmark/`](benchmark/) | [Detailed Report](benchmark/results/REPORT.md)

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, project structure, and how to submit changes.

## Inspired By

- [get-shit-done](https://github.com/gsd-build/get-shit-done) — Structured file-based workflow orchestration for AI agents
- [Memory in the Age of AI Agents](https://arxiv.org/abs/2512.13564) — Comprehensive survey on agent memory architectures
- [Mem0](https://arxiv.org/pdf/2504.19413) — Human-like memory reinforcement and decay
- [MemOS](https://arxiv.org/pdf/2507.03724) — Memory lifecycle state management
- [Ebbinghaus forgetting curve](https://en.wikipedia.org/wiki/Forgetting_curve) — Exponential memory decay
- [Spreading activation](https://en.wikipedia.org/wiki/Spreading_activation) — Collins & Loftus network model of semantic memory
- [Hebbian theory](https://en.wikipedia.org/wiki/Hebbian_theory) — "Neurons that fire together wire together"
- [Synaptic homeostasis hypothesis](https://doi.org/10.1016/j.neuron.2013.10.024) — Tononi & Cirelli's theory of sleep function
- [SM-2 algorithm](https://en.wikipedia.org/wiki/SuperMemo#Description_of_SM-2_algorithm) — Spaced repetition scheduling
- [Memory reconsolidation](https://en.wikipedia.org/wiki/Memory_consolidation#Reconsolidation) — How recalling memories makes them temporarily malleable

## License

MIT
