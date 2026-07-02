# Brain Memory × GitHub Copilot CLI

Give [GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli)
the same persistent, neuroscience-inspired memory your other coding agents
already share — a single global `~/.brain/` with deterministic recall,
spreading activation, spaced reinforcement, and model-driven capture.

**Prerequisite for paths 1 and 2:** the `brain` CLI.

```bash
npm install -g brain-memory
```

## Install paths (pick one)

### 1. Copilot CLI plugin — recommended

One command installs the full ambient loop — skills plus lifecycle hooks:

```bash
copilot plugin install omelas-tech/brain:integrations/copilot/plugin
```

(Installing from a GitHub subdirectory uses the documented
`OWNER/REPO:PATH/TO/PLUGIN` specification. From a local checkout:
`copilot plugin install ./integrations/copilot/plugin`.)

What you get:

- **`sessionStart` hook** — runs the budget-bounded `brain session-start`
  aggregator and injects the payload (pinned facts, memories relevant to the
  current project, procedural-skills index) into the session via the hook's
  `additionalContext` output. Ambient recall with zero prompting.
- **`sessionEnd` hook** — appends a session-boundary entry to
  `~/.brain/contexts.json` (newest 20 kept), feeding context-dependent recall
  in future sessions.
- **Skills** — `brain-remember`, `brain-memorize`, `brain-status` (see below).
  Copilot loads a skill's instructions automatically when your request
  matches its description; check them with `/skills list`.

Verify with `copilot plugin list` and `/skills list` inside a session.
Note that plugin components are cached at install time — after updating,
reinstall the plugin to pick up changes.

### 2. Skills only

If you don't want hooks, copy the skill directories into a personal skills
location — Copilot CLI reads both its own directory and the cross-tool
`~/.agents/skills/` convention (shared with other agents):

```bash
cp -r integrations/copilot/plugin/skills/brain-* ~/.copilot/skills/
# or, shared with every agent that honors the agentskills convention:
cp -r integrations/copilot/plugin/skills/brain-* ~/.agents/skills/
```

Per-repository installs also work: `.github/skills/`, `.agents/skills/`, or
`.claude/skills/` inside the repo.

With skills only there is no automatic session-start injection. To get
ambient recall without hooks, add the Brain Memory instructions block to
`~/.copilot/copilot-instructions.md` (global) or your repo's `AGENTS.md` —
the brain-memory installer can do this for you.

### 3. Zero-install remote MCP

No `brain` CLI on this machine? Point Copilot at the hosted Brain Memory MCP
server. Merge `mcp/mcp-config.snippet.json` into `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "brain-memory": {
      "type": "http",
      "url": "https://mcp.brainmemory.ai/mcp",
      "tools": ["*"]
    }
  }
}
```

Copilot CLI supports OAuth for remote streamable-HTTP MCP servers — run
`/mcp` (or `/mcp auth brain-memory`) inside a session to complete the browser
sign-in; the CLI registers itself via Dynamic Client Registration. If you
prefer a static credential, add a Brain Cloud token instead:

```json
"headers": { "Authorization": "Bearer YOUR-BRAIN-CLOUD-TOKEN" }
```

Your brain lives in Brain Cloud; nothing to install or sync locally.

## How it composes with Copilot's built-in memory

Copilot CLI ships first-party repository/cross-session memory. It is not
pluggable, and Brain Memory does not replace it — the two layer cleanly:

| | Copilot built-in memory | Brain Memory |
|---|---|---|
| Scope | Per repository | Global — every project, all life domains (professional, personal, social, family) |
| Agents | Copilot only | Shared across Copilot, Claude Code, Codex, Gemini, OpenClaw, … |
| Model | Managed by Copilot | Human-readable Markdown + deterministic scoring (strength, decay, salience, spreading activation) |
| Portability | Tied to Copilot | Git remote / export-import / Brain Cloud sync, optional AES-256-GCM encryption |

Let the built-in memory keep repo-local working notes; Brain Memory carries
the durable, cross-agent knowledge — decisions, preferences, people,
conventions — between machines and tools.

## What the hooks do (and honestly don't)

- `sessionStart` **can** inject context: its documented output is
  `{"additionalContext": "..."}`, which Copilot adds to the session. That is
  the entire ambient-recall path — deterministic, budget-bounded, no model
  round-trip.
- `sessionEnd` **cannot** talk to the model (its output has no documented
  effect), so the hook only records a session-boundary entry (id, project,
  timestamps) in `~/.brain/contexts.json`. The richer session-end behavior —
  topics, memories created/recalled, the "worth memorizing?" nudge — comes
  from the skills and the optional instructions block, where the model itself
  wraps up the session.
- Hooks are fail-soft: missing `brain` binary logs one stderr warning and the
  hook exits 0 with `{}`. A brain-memory problem never blocks your session.

## Configuration & environment

| Variable | Default | Effect |
|---|---|---|
| `BRAIN_AGENT` | `copilot-cli` | Host-agent label recorded on memories and recalls |
| `BRAIN_BIN` | `brain` | Path to the brain binary when it is not on PATH |
| `BRAIN_DIR` | `~/.brain` | Brain directory override (matches the brain CLI) |

Hook timeouts are set to 15 s in `plugin/hooks.json` (`timeoutSec`); the
internal `brain` call is capped at 10 s. Hooks never write outside
`~/.brain/`.

## Troubleshooting

**No context block at session start** — the aggregator returns an empty
payload until `~/.brain/index.json` exists. Run the brain-memory installer or
store a first memory with `brain memorize`. Also confirm the plugin is
active: `copilot plugin list`.

**"brain CLI not found" on stderr** — install it
(`npm install -g brain-memory`) or set `BRAIN_BIN` to its absolute path.
The hook logs this once and continues; it never blocks the session.

**Skills don't trigger** — run `/skills list` and check the three `brain-*`
skills are present and enabled (toggle with `/skills`). Skills are selected
by description match; asking "what do you remember about X" reliably engages
`brain-remember`.

**Hook changes not picked up** — plugin components are cached at install
time. Reinstall: `copilot plugin uninstall brain-memory && copilot plugin
install omelas-tech/brain:integrations/copilot/plugin`. Hook configs are also
only re-read when the CLI starts.

**Remote MCP won't authenticate** — re-run the OAuth flow with
`/mcp auth brain-memory`. Corporate proxies that block the browser callback
can use the static `headers` bearer-token form instead.

## Development

```bash
node --test integrations/copilot/test/*.test.mjs
```

Tests are self-contained: the `brain` CLI is mocked and no real `~/.brain`
is touched.
