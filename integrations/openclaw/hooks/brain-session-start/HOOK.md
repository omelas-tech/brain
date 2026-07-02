---
name: brain-session-start
description: "Inject Brain Memory session context (pinned facts, relevant memories, skills) at agent bootstrap"
homepage: https://github.com/omelas-tech/brain/tree/main/integrations/openclaw
metadata: {"openclaw": {"emoji": "🧠", "events": ["agent:bootstrap"], "requires": {"bins": ["brain"]}, "install": [{"id": "node", "kind": "npm", "package": "brain-memory", "bins": ["brain"], "label": "Install the brain CLI (npm)"}]}}
---

# Brain Session Start Hook

Slot-neutral Brain Memory recall injection: works alongside whichever plugin
owns the OpenClaw memory slot (memory-core, Honcho, Mem0, ...). If you use the
`openclaw-brain-memory` plugin as your memory slot, you do **not** need this
hook — the plugin injects the same payload itself.

## What It Does

On `agent:bootstrap` (before workspace bootstrap files are injected):

1. Runs the deterministic, budget-bounded aggregator:
   `brain session-start --project <project>`
2. Formats the payload — pinned facts, memories relevant to the current
   context, the procedural skills index, review/low-confidence alerts — into a
   compact markdown block.
3. Appends it to the session's bootstrap context so the agent starts with
   ambient awareness of the user's brain (`~/.brain`), without reciting it.

The aggregator is budget-bounded on the brain side and the block is truncated
against the same budget here, so injection never blows up the context window.

## Requirements

- **Binary**: `brain` (from the `brain-memory` npm package) on the Gateway's PATH.
- If `~/.brain` does not exist yet, the hook silently no-ops.

## Configuration

| Option      | Type    | Default    | Description                                        |
| ----------- | ------- | ---------- | -------------------------------------------------- |
| `project`   | string  | `openclaw` | Project label for context-dependent recall scoring |
| `brainBin`  | string  | `brain`    | Path to the brain binary                           |
| `maxTokens` | number  | payload budget | Hard cap on injected tokens                    |

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "brain-session-start": {
          "enabled": true,
          "project": "openclaw"
        }
      }
    }
  }
}
```

## Disabling

```bash
openclaw hooks disable brain-session-start
```
