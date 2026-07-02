# Brain Memory provider for Hermes Agent

Backs Hermes Agent's memory slot with [Brain Memory](https://brainmemory.ai) — a local-first, human-readable Markdown memory store in `~/.brain/`, shared across Hermes, Claude Code, Codex, OpenCode, and OpenClaw. Memories decay, strengthen with use, and connect through an associative network — the model decides *what* to remember; the `brain` CLI handles the plumbing deterministically.

## Requirements

- The `brain` CLI: `npm install -g brain-memory` (then run its installer once so `~/.brain/` exists)
- Python 3.10+ (no pip dependencies)

## Setup

1. Copy this directory to `$HERMES_HOME/plugins/brain/` (usually `~/.hermes/plugins/brain/`), or use it in-tree at `plugins/memory/brain/`.
2. Activate it:

```bash
hermes memory setup        # guided
```

or in `~/.hermes/config.yaml`:

```yaml
memory:
  provider: brain
```

3. Verify: `hermes memory status`

## What it does

| Lifecycle | Behavior |
|---|---|
| Session start | Injects a budget-bounded context block from `brain session-start`: status line, pinned facts, skills index, relevant memory titles, memorize guidance |
| Pre-turn | Prefetches relevant memories for the user's message (background thread) |
| Tools | `brain_recall` (recall + auto-reinforce + full bodies), `brain_memorize` (validated store), `brain_reinforce` |
| Pre-compression | Reminds the model to store un-memorized notable content before context is discarded |
| Session end | Appends a session entry to `~/.brain/contexts.json` (last 20 kept) |
| Built-in memory writes | Mirrors MEMORY.md entries into `~/.brain` as deduplicated observations |

## Configuration

Stored in `$HERMES_HOME/brain.json`; environment variables override defaults.

| Key | Default | Env var | Description |
|---|---|---|---|
| `project` | `hermes` | `BRAIN_PROJECT` | Project label for context-dependent recall |
| `top_recall` | `6` | `BRAIN_TOP_RECALL` | Max memories per recall (1–25) |
| `auto_reinforce` | `true` | `BRAIN_AUTO_REINFORCE` | Reinforce memories surfaced by `brain_recall` |
| `brain_bin` | `brain` | `BRAIN_BIN` | Path to the brain CLI |
| `sync_on_memorize` | `false` | `BRAIN_SYNC_ON_MEMORIZE` | Push each store to Brain Cloud / Git remote |

The built-in MEMORY.md/USER.md memory keeps running alongside — this provider supplements it with a long-lived, cross-agent store. See `integrations/hermes/README.md` in the brain-memory repository for hooks-based and MCP-based alternatives.
