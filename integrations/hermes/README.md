# Brain Memory × Hermes Agent

Give [Hermes Agent](https://github.com/NousResearch/hermes-agent) a real long-term memory backed by [Brain Memory](https://brainmemory.ai) — the only memory provider whose store is **local-first, human-readable Markdown**, shared across Hermes, Claude Code, Codex, OpenCode, and OpenClaw. One `~/.brain/` directory, every agent.

Memories live as Markdown files with YAML frontmatter, organized by life domains (`professional/`, `personal/`, `social/`, `family/`). They decay over time, strengthen with use (spaced reinforcement), and connect through an associative network with spreading activation. The model decides *what* to remember; the `brain` CLI handles scoring and storage deterministically — same rankings in every agent.

## Prerequisites

- **Brain Memory CLI** — `npm install -g brain-memory`, then run its installer once so `~/.brain/` and `~/.brain/index.json` exist.
- **Hermes Agent** installed (`hermes` on your PATH). Python 3.10+.

## Install option A — memory provider plugin (recommended)

The full integration: session-start context injection, pre-turn recall prefetch, `brain_recall` / `brain_memorize` / `brain_reinforce` tools, a save-before-compression reminder, session context tracking, and MEMORY.md mirroring.

```bash
# user-installed plugin dir ($HERMES_HOME is usually ~/.hermes)
mkdir -p ~/.hermes/plugins
cp -r plugins/memory/brain ~/.hermes/plugins/brain
```

Then activate it — either guided:

```bash
hermes memory setup      # pick "brain", answer the config prompts
hermes memory status     # verify
```

or directly in `~/.hermes/config.yaml`:

```yaml
memory:
  provider: brain
```

Hermes allows one external memory provider at a time; the built-in MEMORY.md/USER.md memory keeps running alongside, and this provider mirrors its writes into `~/.brain` as deduplicated observations.

> Shipping in-tree? The same directory drops into `plugins/memory/brain/` of a hermes-agent checkout unchanged — bundled providers take precedence over user-installed ones on name collisions.

### Provider configuration

Saved by `hermes memory setup` to `$HERMES_HOME/brain.json`; environment variables override defaults, the JSON file overrides both.

| Key | Default | Env var | Description |
|---|---|---|---|
| `project` | `hermes` | `BRAIN_PROJECT` | Project label recorded on new memories and used for context-dependent recall |
| `top_recall` | `6` | `BRAIN_TOP_RECALL` | Max memories returned per recall (1–25) |
| `auto_reinforce` | `true` | `BRAIN_AUTO_REINFORCE` | Automatically reinforce memories surfaced by `brain_recall` |
| `brain_bin` | `brain` | `BRAIN_BIN` | Path to the brain CLI binary |
| `sync_on_memorize` | `false` | `BRAIN_SYNC_ON_MEMORIZE` | Push each store to Brain Cloud / your Git remote |

### Tools the model gets

| Tool | What it does |
|---|---|
| `brain_recall` | Deterministic recall (TF-IDF relevance, decayed strength, spreading activation, context match, salience) — returns full memory bodies and reinforces what it surfaces |
| `brain_memorize` | Validated storage of model-authored memories (typed, classified, filed under life domains) |
| `brain_reinforce` | Explicit spaced reinforcement + Hebbian co-retrieval strengthening by memory ID |

## Install option B — shell hooks (keep your current provider)

Already committed to Mem0, Honcho, or another provider in the memory slot? The hooks glue adds Brain Memory context injection and session tracking without occupying it.

```bash
mkdir -p ~/.hermes/agent-hooks
cp agent-hooks/brain_context.sh agent-hooks/brain_session_end.sh agent-hooks/_brain_hook.py ~/.hermes/agent-hooks/
chmod +x ~/.hermes/agent-hooks/brain_context.sh ~/.hermes/agent-hooks/brain_session_end.sh
```

`~/.hermes/config.yaml`:

```yaml
hooks:
  pre_llm_call:
    - command: "~/.hermes/agent-hooks/brain_context.sh"
      timeout: 20
  on_session_end:
    - command: "~/.hermes/agent-hooks/brain_session_end.sh"
      timeout: 20
```

Notes:
- Context injection is wired to `pre_llm_call` (not `on_session_start`) because that is the only shell-hook event whose `{"context": "..."}` stdout is honored; the script injects only on the first turn of a session.
- Hermes prompts once for consent per hook command (`hermes hooks doctor` to verify). Hook failures never crash the agent.
- Set `BRAIN_PROJECT` in your environment to tag sessions with a project other than `hermes`.

## Install option C — zero-install remote MCP

No plugin, no hooks, no local CLI required — connect Hermes to Brain Cloud's remote MCP server in `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  brain:
    url: "https://mcp.brainmemory.ai/mcp"
    auth: oauth
```

Recall and memorize tools are served remotely against your synced brain. Best for machines where you don't want a local store; options A/B remain the local-first path.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `brain CLI not found` in logs | `npm install -g brain-memory`; if Hermes runs from a GUI/daemon that misses your shell PATH, set `brain_bin` (or `BRAIN_BIN`) to the absolute path (`which brain`) |
| Empty session-start block | `~/.brain/index.json` missing — run the brain-memory installer once, or store a first memory |
| `brain` works in terminal but not in Hermes | Node version managers (nvm, fnm) only patch interactive shells — point `brain_bin` at the absolute binary path |
| Provider not listed in `hermes memory setup` | Plugin must live at `~/.hermes/plugins/brain/` (directory name `brain`) with `__init__.py` and `plugin.yaml` present |
| Another provider already active | Only one external provider can hold the slot — use install option B alongside it, or `hermes memory off` first |
| Hooks do nothing | Approve the consent prompt on first run, mark the `.sh` files executable, and check `hermes hooks doctor` |
| Store not on this machine | `brain` syncs via Brain Cloud or any private Git remote (`/brain:sync` in other agents), or use install option C |

## Layout

```
integrations/hermes/
├── plugins/memory/brain/   # the provider plugin (option A) — drop into ~/.hermes/plugins/ or in-tree
│   ├── __init__.py         # register(ctx)
│   ├── provider.py         # BrainMemoryProvider
│   ├── cli.py              # `hermes memory status|recall`
│   ├── plugin.yaml
│   └── README.md
├── agent-hooks/            # the hooks glue (option B)
│   ├── brain_context.sh
│   ├── brain_session_end.sh
│   └── _brain_hook.py
└── tests/                  # python3 -m unittest discover -s integrations/hermes/tests
```
