# Brain Memory for Cursor

Persistent memory for Cursor's agent. It recalls your past decisions,
conventions and learnings at the start of a task and saves new ones as you go.
It's the same brain you use in Claude, Codex and other agents, synced through
[Brain Cloud](https://brainmemory.ai).

## What's in the plugin

| Component | What it does |
|-----------|--------------|
| `mcp.json` | Connects Cursor to the hosted Brain Memory MCP server at `https://mcp.brainmemory.ai/mcp` (streamable HTTP, OAuth). |
| `rules/brain-memory.mdc` | Tells the agent to recall before non-trivial tasks and to offer to save decisions and learnings. |

### Tools

| Tool | Kind | What it does |
|------|------|--------------|
| `brain_recall` | read | Ranked recall for a query, scored by the brain engine (relevance, decayed strength, spreading activation). |
| `brain_status` | read | Memory count and last update for your brain. |
| `brain_memorize` | write | Store an explicit statement; recallable immediately. |
| `brain_pin` / `brain_unpin` | write | Move a memory in or out of the always-present tier. |
| `brain_forget` | write | Archive a memory. It can be restored. |

## Setup

1. Install **Brain Memory** from the Cursor Marketplace.
2. The first time the agent uses a tool, Cursor opens a browser window to sign
   in. Use the same account your brain syncs to. A new account starts with an
   empty brain on the free plan.
3. Ask the agent something like *"What do you remember about this project?"*

### Already using the `brain` CLI?

If you use Brain Memory locally (`npm i -g brain-memory`), push your local
brain to the cloud once so Cursor sees it:

```bash
brain cloud login
brain cloud push
```

### Manual setup without the plugin

Add this to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one
project):

```json
{
  "mcpServers": {
    "brain-memory": { "url": "https://mcp.brainmemory.ai/mcp" }
  }
}
```

## Privacy

Memories are stored in Brain Cloud and encrypted at rest with server-held
keys. Writes happen only through `brain_memorize`, which stores the explicit
text the agent passes, never the conversation itself. See
[brainmemory.ai/privacy](https://brainmemory.ai/privacy).

## License

MIT
