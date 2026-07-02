# Brain Memory × Kilo

Give [Kilo](https://kilo.ai) (VS Code, CLI, and Cloud Agents) the same
persistent, neuroscience-inspired memory your other coding agents already
share — a single global `~/.brain/` with deterministic recall, spreading
activation, spaced reinforcement, and model-driven capture.

Targets **Kilo v7+** (the OpenCode-based rebuild with `kilo.jsonc` config and
the runtime plugin system).

**Prerequisite for paths 1 and 2:** the `brain` CLI.

```bash
npm install -g brain-memory
```

## Install paths (pick one)

### 1. Runtime plugin — recommended

One self-contained file gives you the full ambient loop. Copy it into a
plugin directory (they auto-register — no config edits needed):

```bash
# global (all projects):
mkdir -p ~/.config/kilo/plugin
cp integrations/kilo/plugin/brain-memory.js ~/.config/kilo/plugin/

# or per project:
mkdir -p .kilo/plugin
cp integrations/kilo/plugin/brain-memory.js .kilo/plugin/
```

What you get:

- **Session-start injection** (`chat.message` hook) — on the first message
  of each session the plugin runs the budget-bounded `brain session-start`
  aggregator and appends the context block (pinned facts, memories relevant
  to the current project, procedural-skills index) to that message. One
  injection per session; subagent sessions are skipped.
- **Session tracking** (`event` hook) — on `session.idle` /
  `session.deleted` the plugin upserts one session-boundary entry per
  session into `~/.brain/contexts.json` (newest 20 kept), feeding
  context-dependent recall in future sessions.
- **Agent labeling** (`shell.env` hook) — every shell command the agent runs
  gets `BRAIN_AGENT=kilo`, so all `brain` CLI calls record their host agent.

The plugin is dependency-free, spawns the `brain` CLI via argv arrays only
(never a shell), caps calls at 10 s, and is fail-soft throughout: a missing
`brain` binary logs one warning and the session continues untouched.

### 2. Slash commands

Port of the brain command set as Kilo workflows. Copy into a commands
directory and invoke as `/brain-remember`, `/brain-memorize`,
`/brain-status`:

```bash
# global:
mkdir -p ~/.config/kilo/commands
cp integrations/kilo/commands/brain-*.md ~/.config/kilo/commands/

# or per project:
mkdir -p .kilo/commands
cp integrations/kilo/commands/brain-*.md .kilo/commands/
```

Commands and the plugin compose — the plugin handles the ambient loop, the
commands give you explicit control. Kilo also loads agent skills from
`~/.kilo/skills/` and the compatibility directories (`.agents/skills/`,
`.claude/skills/`), so the Brain Memory skill set installed for other agents
is discovered too.

### 3. Zero-install remote MCP

No `brain` CLI on this machine? Point Kilo at the hosted Brain Memory MCP
server. Merge `mcp/kilo-mcp.snippet.json` into your `kilo.jsonc`
(global: `~/.config/kilo/kilo.jsonc`, or project: `kilo.jsonc` /
`.kilo/kilo.jsonc`):

```jsonc
{
  "mcp": {
    "brain-memory": {
      "type": "remote",
      "url": "https://mcp.brainmemory.ai/mcp",
      "enabled": true
    }
  }
}
```

Kilo supports OAuth 2.0 for remote MCP servers and starts the flow
automatically on first connect. For a static credential instead, add
`"headers": { "Authorization": "Bearer YOUR-BRAIN-CLOUD-TOKEN" }`.

Your brain lives in Brain Cloud; nothing to install or sync locally.

## How it composes with Kilo's own context features

Kilo has rules (`kilo.jsonc` `instructions`, `AGENTS.md`), skills, and
built-in context management. Brain Memory does not replace any of them — it
adds the layer they don't have:

| | Kilo rules / AGENTS.md | Brain Memory |
|---|---|---|
| Scope | Per repo / per config | Global — every project, all life domains |
| Content | Static, hand-written | Living memories with strength, decay, salience, associations |
| Agents | Kilo | Shared across Kilo, Claude Code, Copilot CLI, Codex, OpenClaw, … |
| Portability | Files in repo | Git remote / export-import / Brain Cloud sync, optional AES-256-GCM encryption |

Rules say *how to work*; brain remembers *what happened and what was
decided* — across sessions, projects, and tools.

## Configuration & environment

| Variable | Default | Effect |
|---|---|---|
| `BRAIN_AGENT` | `kilo` | Host-agent label recorded on memories and recalls |
| `BRAIN_BIN` | `brain` | Path to the brain binary when it is not on PATH |
| `BRAIN_DIR` | `~/.brain` | Brain directory override (matches the brain CLI) |

Plugin options can also be passed through `kilo.jsonc` when registering the
plugin explicitly instead of using the auto-discovery directory:

```jsonc
{
  "plugin": [["~/.config/kilo/plugin/brain-memory.js", { "project": "my-label" }]]
}
```

## Troubleshooting

**No context block at session start** — the aggregator returns an empty
payload until `~/.brain/index.json` exists. Run the brain-memory installer
or store a first memory with `brain memorize`. Then start a new session —
injection happens once, on the first message.

**"brain CLI not found" in the log** — install it
(`npm install -g brain-memory`) or set `BRAIN_BIN` to its absolute path. The
plugin warns once and continues; it never blocks the session.

**Plugin doesn't load** — confirm the file is directly inside a plugin
directory (`~/.config/kilo/plugin/` or `.kilo/plugin/`) and restart Kilo.
The legacy `.kilocode/plugin/` directory also works.

**Commands don't appear** — commands are picked up from
`~/.config/kilo/commands/` and `.kilo/commands/`; the filename (without
`.md`) is the slash command name.

**Remote MCP won't authenticate** — Kilo starts the OAuth flow automatically
when the server supports it. Behind a proxy that blocks the browser
callback, use the static `headers` bearer-token form, or set
`"oauth": false` and rely on headers only.

## Development

```bash
node --test integrations/kilo/test/*.test.mjs
```

Tests are self-contained: the `brain` CLI is mocked and no real `~/.brain`
is touched. The plugin runs under Kilo's Bun runtime in production and under
Node for tests — it uses `node:` builtins only.
