# Native integrations

Deep, first-class integrations that make `~/.brain/` the memory engine of always-on agentic assistants — the same brain the coding-agent installs (Claude Code, Codex CLI, OpenCode, Antigravity) read and write.

| Integration | What it is | Docs |
|-------------|-----------|------|
| **OpenClaw / NVIDIA NemoClaw** | Native memory-slot plugin (`openclaw-brain-memory`) replacing `memory-core`, plus a slot-neutral hook pack, a ClawHub skill, and a NemoClaw egress-policy preset | [integrations/openclaw](openclaw/) |
| **Hermes Agent** (Nous Research) | Native `MemoryProvider` plugin (`plugins/memory/brain/`) implementing the full provider lifecycle, plus hook-script glue | [integrations/hermes](hermes/) |
| **GitHub Copilot CLI** | Copilot plugin (skills + `sessionStart`/`sessionEnd` hooks with `additionalContext` injection) layered on the installer's native `--copilot` runtime | [integrations/copilot](copilot/) |
| **Kilo** | Runtime plugin (`chat.message` session-start injection, session event tracking, `BRAIN_AGENT` labeling) + slash commands, layered on the installer's native `--kilo` runtime | [integrations/kilo](kilo/) |

Every integration shells out to the same `brain` CLI (from the [`brain-memory`](https://www.npmjs.com/package/brain-memory) npm package) for deterministic recall scoring, so all agents get identical rankings for the same query. Hosts that only need on-demand recall can skip these entirely and use the hosted MCP connector: `https://mcp.brainmemory.ai/mcp` (streamable-HTTP + OAuth).

## Design principles

1. **The model decides what to remember; the plumbing is deterministic.** Capture happens through a `brain_memorize` tool the model calls with structured payloads — never mechanical transcript dumping.
2. **Session-start injection is deterministic.** Each integration injects the budget-bounded `brain session-start` payload (pinned facts, skills index, context recall) at its host's canonical injection point.
3. **Fail soft.** If the `brain` binary is missing or errors, integrations log once and no-op. They never crash the host agent.
4. **One brain, every agent.** Memories are tagged with their host via `BRAIN_AGENT`, but live in the single global `~/.brain/` tree.

## Testing

```bash
npm run test:integrations            # all suites
npm run test:integrations:openclaw   # node --test (Node 22+)
npm run test:integrations:copilot    # node --test (Node 22+)
npm run test:integrations:kilo       # node --test (Node 22+)
npm run test:integrations:hermes     # python3 stdlib unittest
```
