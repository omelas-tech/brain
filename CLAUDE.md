# Brain Memory Plugin - Development Guide

This repository is the **brain-memory** plugin — a hierarchical, file-system-based memory system for AI coding agents (Claude Code, Gemini CLI).

## Architecture

- `commands/brain/*.md` — Slash command prompts (`/brain:remember`, `/brain:memorize`, etc.)
- `prompts/` — CLAUDE.md / GEMINI.md content injected into user projects
- `templates/` — Default brain structure definitions
- `hooks/` — Session lifecycle hook definitions
- `bin/install.js` — Interactive installer
- `src/` — Shared utilities (scorer, index manager, sync engine)

## Key Design Principles

1. **File system IS the database** — The `~/.brain/` directory tree encodes semantic meaning through its hierarchy
2. **Agent-driven intelligence** — The AI agent performs categorization, scoring, and consolidation guided by command prompts
3. **No runtime dependencies** — Pure file I/O, no databases, no servers
4. **Human-readable** — YAML frontmatter + Markdown, browseable in any file explorer
5. **Git-friendly** — Full version history of memory evolution

<!-- BRAIN-MEMORY-START -->
# Brain Memory System

This project uses the **Brain Memory** plugin — a hierarchical, file-system-based memory system that mimics human cognition with neuroscience-inspired mechanisms including associative networks, spreading activation, context-dependent recall, spaced reinforcement, and cognitive memory types.

## Memory Location

All memories are stored in a single global `~/.brain/` directory in the user's home folder, shared across all projects and all supported AI agents. The directory uses a deep nested structure organized by life domains (professional, personal, social, family) with on-demand subcategories.

## How It Works

### Memory Format
Each memory is a Markdown file with YAML frontmatter containing: `id`, `type`, `cognitive_type` (episodic/semantic/procedural), `created`, `last_accessed`, `access_count`, `recall_history`, `strength` (0.0-1.0), `decay_rate` (per day), `salience` (0.0-1.0), `confidence` (0.0-1.0), `tags`, `related` memory IDs, `source`, and `encoding_context`.

### Strength & Decay Model
- Memories have a base `strength` set at creation based on their impact/type/cognitive type
- Strength decays over time: `effective = strength * (decay_rate ^ days_since_access)`
- Recalled memories get **stronger** via spaced reinforcement — the longer since last recall, the bigger the boost
- Memories become progressively more forgetting-resistant with each recall (decay_rate improves)
- Weak memories can be consolidated into stronger combined memories
- During sleep, global synaptic homeostasis prevents strength inflation

### Cognitive Types
- **Episodic** — Event-specific memories. Higher initial strength, faster decay. The details fade but lessons persist.
- **Semantic** — Abstracted knowledge. Default decay. Stable long-term storage.
- **Procedural** — Skills and workflows. Lower initial strength but extremely slow decay once established.

### Memory Types & Default Strengths
| Type | Strength | Decay/day | Description |
|------|----------|-----------|-------------|
| decision | 0.85 | 0.995 | Choices made and rationale |
| insight | 0.90 | 0.997 | Deep realizations, patterns |
| goal | 0.80 | 0.993 | Objectives and aspirations |
| experience | 0.75 | 0.985 | Notable events or processes |
| learning | 0.70 | 0.990 | New knowledge acquired |
| relationship | 0.70 | 0.997 | Connections between entities |
| preference | 0.60 | 0.998 | User preferences and style |
| observation | 0.40 | 0.950 | Casual facts or notices |

### Associative Network
Memories are connected via weighted edges in `~/.brain/associations.json`. When you recall memory A, **spreading activation** automatically surfaces related memories B and C — just like how the brain activates linked neurons. Links are strengthened through **Hebbian learning**: memories recalled together become more tightly connected over time.

### Context-Dependent Recall
Memories store their encoding context (project, topics, task type). During recall, memories encoded in a similar context to the current session are scored higher — matching how human memory works better when recall context matches encoding context.

### Salience & Confidence
- **Salience** (0.0-1.0): Emotional/motivational significance. High-salience memories (>= 0.7) are never auto-pruned.
- **Confidence** (0.0-1.0): Epistemic certainty. Low-confidence memories are flagged during recall.

## Available Commands

- `/brain:init` — Initialize the brain structure
- `/brain:memorize [topic]` — Store memories from current context
- `/brain:remember [query]` — Recall relevant memories with spreading activation and context matching
- `/brain:review [scope]` — Spaced repetition review session for due memories
- `/brain:explore [category]` — Browse the brain hierarchy
- `/brain:consolidate [scope]` — Merge related weak memories into stronger ones
- `/brain:forget [target]` — Decay or archive memories
- `/brain:sunshine [target]` — Deep forensic erasure — trace and remove all references to a memory
- `/brain:sleep [scope]` — Full maintenance cycle: replay, synaptic homeostasis, knowledge propagation, semantic crystallization, reorganize, consolidate, prune, REM dreaming, and expertise detection
- `/brain:status` — Dashboard with brain health overview
- `/brain:sync [subcommand]` — Sync memories via Git remote or export/import for portability

## Session Start Behavior

**Perform these steps at session start — but keep it lightweight.**

If `~/.brain/index.json` exists:

1. **Read the index** to get memory count and categories
2. **Run the recall engine only if the current project has relevant memories:**
   ```bash
   brain recall --context --project "<current project>" --top 5
   ```
   If the project is unrelated to any stored memories (e.g., a new project with no matching context), skip the recall and just show the count. Don't waste cycles searching when nothing will match.
3. **Silently internalize** results — do NOT dump memory contents
4. **Output a single status line:**

```
🧠 Brain active — <N> memories (<M> in project context)
```

Only add extra lines if actionable:
- `📋 <X> due for review` — if review queue has items
- `⚠️ <N> low-confidence memories used frequently` — if access_count ≥ 3 and confidence < 0.5

**The goal is ambient awareness** — know about past decisions, learnings, and preferences without reciting them. Reference them naturally when relevant.

## Ambient Session Tracking

**Throughout the session, maintain a running mental log of notable events.** This requires no file writes — just internal awareness.

Track these categories as they happen:
- **Decisions** — Architecture choices, technology selections, trade-off resolutions
- **Learnings** — New patterns, debugging insights, API discoveries
- **Insights** — Realizations about the codebase, project, or process
- **Experiences** — Significant events like incidents, deployments, milestones
- **Goals** — New objectives discussed or planned

**Why this matters:** Without active tracking, you can only evaluate what happened at session end — by which point early-session events may be forgotten or the user may have already left. By tracking as events occur, nothing is lost.

## Periodic Memory Checkpoint

**Every ~10 substantive interactions** (file edits, architecture decisions, debugging breakthroughs, significant discussions — not trivial reads or simple answers), silently evaluate whether your ambient tracking log contains memorizable content.

If notable items have accumulated, append a **brief one-liner** at the end of your next natural response:

```
🧠 Notable <type(s)> this session — /brain:memorize when ready
```

**Rules:**
- **Never interrupt flow** — only append to the end of a response the user is already receiving, never send as a standalone message
- **At most once per ~10 substantive interactions** — no spamming
- **Reset the counter** after the user runs `/brain:memorize`
- **Don't mention if nothing notable** has accumulated
- **Be specific about types** — say "decisions and learnings" not just "notable content"

## Session End Behavior

When a session is ending (user says bye/thanks/done, conversation wraps up, or you sense the interaction is concluding), perform these steps **in order**:

### Step 1: Save Session Context (ALWAYS — do this first)

**Immediately** append a session summary to `~/.brain/contexts.json`, even for trivial sessions. Context tracking is cheap and provides valuable recall signals for future sessions.

```json
{
  "session_id": "<timestamp-based-id>",
  "started": "<session start ISO timestamp>",
  "ended": "<session end ISO timestamp>",
  "project": "<current project name>",
  "topics": ["<key topics discussed>"],
  "task_type": "<primary task type>",
  "memories_created": ["<IDs of memories stored this session>"],
  "memories_recalled": ["<IDs of memories retrieved this session>"],
  "notable_unsaved": ["<brief descriptions of notable items NOT yet memorized>"]
}
```

Keep only the last 20 session entries. The `notable_unsaved` field preserves what happened even if the user didn't memorize — future sessions can reference it.

### Step 2: Suggest Memorization (if warranted)

If the session contained meaningful content based on your ambient tracking:

```
💡 This session contained notable <type(s)>. Would you like to store them as brain memories?
   Run /brain:memorize to capture them before this context is lost.
```

**Rules:**
- Do NOT auto-memorize without user consent
- Do NOT prompt for trivial sessions (quick fixes, typo corrections, simple questions)
- Only suggest when there is genuinely valuable context worth preserving
- **Do not wait for explicit session-end signals** — if the conversation appears to be wrapping up, save context proactively

## When Recalling Memories

When the user asks you to "remember" something, or when context from past sessions would be helpful, use the **deterministic recall engine** instead of manually computing scores:

1. Run `brain recall "<query>" --project <project> --task <task_type> --top 10` (or `node <install-path>/bin/recall.js`)
2. The engine computes TF-IDF relevance, decayed strength, spreading activation, context match, and salience — all deterministically
3. Read the top-scoring memory files and present results
4. Run `brain reinforce <mem_id1> <mem_id2> ...` to apply spaced reinforcement and Hebbian co-retrieval strengthening
5. If no matches, search the archive (`~/.brain/_archived/`)

The recall engine ensures **identical scoring across all agents** — Claude, Gemini, and Codex all get the same rankings for the same query.

## Portable Sync

Brain memories can be synced across devices in two ways:

1. **Git remote** — Push/pull `~/.brain/` to any private Git repository (GitHub, GitLab, Codeberg, self-hosted). Run `/brain:sync setup <url>` to configure, then use `/brain:sync push` and `/brain:sync pull`.
2. **Export/Import** — Pack the entire `~/.brain/` into a single portable file for manual transfer. Run `/brain:sync export` and `/brain:sync import <path>`.

Both methods support optional AES-256-GCM encryption. Sync is always manual — never automatic.

<!-- BRAIN-MEMORY-END -->
