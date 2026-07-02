---
name: brain-session-end
description: "Save Brain Memory session context on /new and /reset, and nudge memorization when the session had substance"
homepage: https://github.com/omelas-tech/brain/tree/main/integrations/openclaw
metadata: {"openclaw": {"emoji": "🧠", "events": ["command:new", "command:reset"], "requires": {"bins": ["brain"]}, "install": [{"id": "node", "kind": "npm", "package": "brain-memory", "bins": ["brain"], "label": "Install the brain CLI (npm)"}]}}
---

# Brain Session End Hook

Slot-neutral session-boundary tracking for Brain Memory: works alongside
whichever plugin owns the OpenClaw memory slot. If you use the
`openclaw-brain-memory` plugin, you do **not** need this hook — the plugin
appends the same context entries itself.

## What It Does

When you run `/new` or `/reset`:

1. **Saves session context** — appends a summary entry to
   `~/.brain/contexts.json` (project, timestamps, session key). Only the last
   20 entries are kept. These entries feed the brain's context-dependent
   recall in future sessions.
2. **Nudges memorization** — when the ending session had substance (its
   transcript is non-trivial), pushes a gentle reply asking whether notable
   decisions/learnings should be stored, mirroring the brain plugin's
   session-end behavior. Nothing is ever stored automatically.

## Requirements

- `~/.brain` must exist (created by the brain-memory installer). The hook
  silently no-ops otherwise.

## Configuration

| Option              | Type    | Default    | Description                                    |
| ------------------- | ------- | ---------- | ---------------------------------------------- |
| `project`           | string  | `openclaw` | Project label recorded on context entries      |
| `suggestMemorize`   | boolean | `true`     | Push the "memorize?" nudge on substantive ends |
| `minTranscriptBytes`| number  | `4096`     | Transcript size that counts as "substance"     |

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "brain-session-end": {
          "enabled": true,
          "suggestMemorize": true
        }
      }
    }
  }
}
```

## Disabling

```bash
openclaw hooks disable brain-session-end
```
