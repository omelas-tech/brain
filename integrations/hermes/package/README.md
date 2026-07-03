# hermes-brain-memory

**[Brain Memory](https://brainmemory.ai) provider for [Hermes Agent](https://hermes-agent.nousresearch.com)** — one local-first memory shared across all your AI agents. The same human-readable Markdown store in `~/.brain/` is read and written by Claude Code, Codex, OpenCode, and OpenClaw, so Hermes remembers what your other agents learned — and vice versa.

Memories are plain Markdown files with YAML frontmatter (greppable, diffable, editable). They decay over time, strengthen with use (spaced reinforcement), and connect through an associative network with spreading activation. The model decides *what* to remember via explicit tools; the `brain` CLI scores recall deterministically.

**Zero pip dependencies** — this package and the provider it installs are Python stdlib only.

## Install

```bash
# 1. The brain CLI (once, if you don't already use Brain Memory)
npm install -g brain-memory

# 2. This package + the provider
pip install hermes-brain-memory       # or: uv tool install / pipx install hermes-brain-memory
hermes-brain-memory install           # copies the provider into $HERMES_HOME/plugins/brain
```

## Activate

```bash
hermes config set memory.provider brain
hermes memory setup        # optional guided configuration
hermes memory status       # verify: "brain" should show as installed & available
```

Or set it directly in `$HERMES_HOME/config.yaml` (usually `~/.hermes/config.yaml`):

```yaml
memory:
  provider: brain
```

Only one external memory provider can be active at a time; Hermes' built-in MEMORY.md/USER.md memory keeps running alongside.

## What it does

| Lifecycle | Behavior |
|---|---|
| Session start | Injects a budget-bounded context block from `brain session-start`: status line, pinned facts, procedural-skills index, relevant memory titles, memorize guidance |
| Pre-turn | Prefetches relevant memories for the user's message (background thread, non-blocking) |
| Tools | `brain_recall` (deterministic recall + full bodies + auto-reinforce), `brain_memorize` (validated store), `brain_reinforce` (spaced reinforcement by ID) |
| Pre-compression | Reminds the model to store un-memorized notable content before context is discarded |
| Session end | Appends a session entry to `~/.brain/contexts.json` (last 20 kept) |
| Built-in memory writes | Mirrors MEMORY.md entries into `~/.brain` as content-hash-deduplicated observations |
| Backup | `~/.brain` is declared via `backup_paths()` so `hermes backup` captures it |

No transcript dumping: `sync_turn` does lightweight in-memory topic tracking only. Nothing leaves the machine unless you enable Brain's own sync (Brain Cloud or a private Git remote).

## Installer commands

```bash
hermes-brain-memory install [--force]   # copy/update the provider (idempotent; --force overwrites)
hermes-brain-memory uninstall           # remove it ($HERMES_HOME/plugins/brain only — ~/.brain is untouched)
hermes-brain-memory status              # install state, brain CLI, active memory.provider
```

`HERMES_HOME` (or `--hermes-home PATH`) selects the Hermes profile to install into; default `~/.hermes`.

## Configuration

Stored in `$HERMES_HOME/brain.json` (written by `hermes memory setup`); environment variables override.

| Key | Default | Env var | Description |
|---|---|---|---|
| `project` | `hermes` | `BRAIN_PROJECT` | Project label for context-dependent recall |
| `top_recall` | `6` | `BRAIN_TOP_RECALL` | Max memories per recall (1–25) |
| `auto_reinforce` | `true` | `BRAIN_AUTO_REINFORCE` | Reinforce memories surfaced by `brain_recall` |
| `brain_bin` | `brain` | `BRAIN_BIN` | Path to the brain CLI |
| `sync_on_memorize` | `false` | `BRAIN_SYNC_ON_MEMORIZE` | Push each store to Brain Cloud / Git remote |

## Requirements

- [Hermes Agent](https://hermes-agent.nousresearch.com) (a version with pluggable memory providers)
- The `brain` CLI from the [`brain-memory`](https://www.npmjs.com/package/brain-memory) npm package
- Python 3.10+ — no pip dependencies

## Docs & source

- Brain Memory: [brainmemory.ai](https://brainmemory.ai)
- Source & full integration docs: [github.com/omelas-tech/brain](https://github.com/omelas-tech/brain) (`integrations/hermes/`)
- Hermes memory providers: [hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers)

## License

MIT © Omelas
