# Brain Memory × OpenClaw

Give your [OpenClaw](https://github.com/openclaw/openclaw) assistant the same
persistent, neuroscience-inspired memory your coding agents already share — a
single global `~/.brain/` with deterministic recall, spreading activation,
spaced reinforcement, and model-driven capture. Works with NVIDIA NemoClaw
sandboxes too.

**Prerequisite for paths 1 and 2:** the `brain` CLI on the Gateway machine.

```bash
npm install -g brain-memory
```

## Install paths (pick one)

### 1. Memory-slot plugin — recommended

Replaces the built-in `memory-core` plugin as OpenClaw's memory slot.
`memory_search` runs on the deterministic `brain recall` engine (recalled
memories are reinforced automatically), `memory_get` reads memory files from
`~/.brain`, and a `brain_memorize` tool lets the model store classified
memories as they emerge. The plugin injects the budget-bounded
`brain session-start` payload (pinned facts + relevant memories + skills
index) into the system prompt once per session, prompts a memorize pass
before context compaction, and appends session summaries to
`~/.brain/contexts.json` on `/new` and `/reset`.

```bash
openclaw plugins install openclaw-brain-memory
# or from source:
openclaw plugins install github.com/omelas-tech/brain#main:integrations/openclaw/plugin
```

Then select the memory slot in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "slots": { "memory": "brain-memory" },
    "entries": {
      "brain-memory": {
        "enabled": true,
        "config": {
          "project": "openclaw",
          "topRecall": 6,
          "autoReinforce": true,
          "syncOnMemorize": false
        }
      }
    }
  }
}
```

Restart the Gateway. Your assistant now recalls before answering questions
about prior conversations, people, preferences, and decisions — and remembers
what matters across all life domains, not just code.

### 2. Slot-neutral hook pack + skill

Keeping Mem0, Honcho, or `memory-core` in the memory slot? Add Brain Memory
alongside it:

- **`hooks/brain-session-start`** — injects the `brain session-start` payload
  at `agent:bootstrap` (ambient recall without touching the memory slot).
- **`hooks/brain-session-end`** — appends a session entry to
  `~/.brain/contexts.json` on `/new`/`/reset` (last 20 kept) and nudges
  memorization when the session had substance.
- **`skill/brain-memory`** — teaches the agent the `brain recall` /
  `brain reinforce` / `brain memorize` workflow with life-domain examples.

```bash
# hooks (copy each hook directory into the managed hooks dir, then enable)
cp -r integrations/openclaw/hooks/brain-session-start ~/.openclaw/hooks/
cp -r integrations/openclaw/hooks/brain-session-end ~/.openclaw/hooks/
openclaw hooks enable brain-session-start
openclaw hooks enable brain-session-end

# skill (from ClawHub once published, or copy into your workspace skills dir)
openclaw skills install @omelas/brain-memory
```

### 3. Zero-install remote MCP

No CLI on the Gateway host? Point OpenClaw at the hosted Brain Memory MCP
server and authenticate with OAuth:

```bash
openclaw mcp add brain-memory --url https://mcp.brainmemory.ai/mcp --auth oauth
openclaw mcp login brain-memory
```

Your brain lives in Brain Cloud; nothing to install or sync locally.

## NVIDIA NemoClaw

NemoClaw runs OpenClaw inside an OpenShell sandbox with deny-by-default
egress. Apply the bundled policy preset so the remote MCP path (and OAuth
login) work from inside the sandbox:

```bash
nemoclaw <sandbox-name> policy-add --from-file integrations/openclaw/nemoclaw/brainmemory-policy.yaml --yes
```

Persist it by merging the entry into your baseline `openclaw-sandbox.yaml`
and re-running `nemoclaw onboard`.

**Persistence rule:** keep nothing brain-critical *only* inside the sandbox.
Sandboxes are disposable — if you run the local `brain` CLI in one, configure
`~/.brain` sync (Brain Cloud or a private git remote, both support AES-256-GCM
encryption) so memories survive recreation. The policy file contains
commented-out endpoint entries for both sync paths. Set `BRAIN_AGENT=nemoclaw`
in the sandbox environment so memories record their host agent.

## Configuration reference (plugin)

`plugins.entries.brain-memory.config`:

| Option           | Type    | Default    | Description                                                                 |
| ---------------- | ------- | ---------- | --------------------------------------------------------------------------- |
| `brainBin`       | string  | `"brain"`  | Path/name of the brain binary when it is not on the Gateway's PATH          |
| `project`        | string  | `"openclaw"` | Project label on encoding contexts; drives context-dependent recall        |
| `topRecall`      | integer | `6`        | Default `memory_search` result count                                        |
| `autoReinforce`  | boolean | `true`     | `brain reinforce` every memory returned by `memory_search`                  |
| `syncOnMemorize` | boolean | `false`    | Pass `--sync` to `brain memorize` (requires Brain Cloud or git sync set up) |

Hook pack options live under `hooks.internal.entries.<hook-name>` — see each
hook's `HOOK.md` for its table.

## Tools exposed by the plugin

| Tool             | What it does                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `memory_search`  | Deterministic recall over `~/.brain` via `brain recall`; auto-reinforces returned memories |
| `memory_get`     | Bounded excerpt read of a memory file by its relative brain path                           |
| `brain_memorize` | Store classified memories (type, cognitive type, life-domain path, salience, tags)         |

## Troubleshooting

**"brain CLI not found" in the Gateway log** — install it
(`npm install -g brain-memory`) or set `plugins.entries.brain-memory.config.brainBin`
to its absolute path. The plugin logs this once and disables itself
gracefully; it never blocks the Gateway.

**Tools don't show up in the agent's tool list** — OpenClaw has a known issue
where factory-registered plugin tools occasionally miss the runtime tool list
(openclaw/openclaw#50328). The plugin declares its tools in
`contracts.tools` for lazy discovery, which avoids the common case; if it
still bites, restart the Gateway or run `openclaw plugins doctor`. Recall
injection is hook-based and unaffected.

**Memory slot didn't switch** — verify `plugins.slots.memory` is exactly
`"brain-memory"` and the plugin is enabled, then restart the Gateway. Run
`openclaw plugins list` to confirm the active memory plugin.

**Empty session context block** — the aggregator returns an empty payload
until `~/.brain/index.json` exists. Run the brain-memory installer, or store a
first memory with `brain memorize`.

**Recall works but nothing is ever stored** — capture is model-driven by
design. Check that `brain_memorize` appears in the tool list, and that your
agent's prompt surface includes the memory section (the plugin adds it via the
memory slot's prompt builder).

**Sandbox egress denials in NemoClaw** — apply the policy preset above; watch
the OpenShell TUI for interception prompts on first use.

**Sync from inside a sandbox fails** — allowlist your Brain Cloud or git host
endpoints in the policy file (commented examples included).

## Development

```bash
cd integrations/openclaw/plugin
npm install          # dev-only: typescript + @types/node
npm run typecheck    # plugin + hook pack
npm test             # node --test ../test/*.test.mjs
```

On Node 23+ you can also run the suite with a directory argument:
`node --test integrations/openclaw/test/`.

The plugin ships with local type shims (`plugin/types/openclaw-plugin-sdk.d.ts`)
transcribed from the OpenClaw plugin SDK, so type-checking works offline
without an OpenClaw checkout.
