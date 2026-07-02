# openclaw-brain-memory

Brain Memory as [OpenClaw](https://github.com/openclaw/openclaw)'s memory
slot: neuroscience-inspired persistent memory backed by the
[`brain-memory`](https://www.npmjs.com/package/brain-memory) CLI and a single
global `~/.brain/` directory shared across all your AI agents.

- **`memory_search`** — deterministic recall via `brain recall` (TF-IDF
  relevance + decayed strength + spreading activation + context match);
  recalled memories are automatically reinforced (spaced reinforcement +
  Hebbian co-retrieval).
- **`memory_get`** — bounded excerpt reads of memory files under `~/.brain`.
- **`brain_memorize`** — model-driven capture: the model classifies durable
  decisions, learnings, insights, and preferences across life domains
  (personal, family, social, professional); the CLI handles IDs,
  strength/decay, associations, and indexing.
- **Session-start injection** — the budget-bounded `brain session-start`
  payload (pinned facts, relevant memories, skills index) is appended to the
  system prompt once per session.
- **Pre-compaction flush** — prompts a silent `brain_memorize` pass before
  context compaction so nothing durable is lost.
- **Session boundaries** — `/new` and `/reset` append a summary entry to
  `~/.brain/contexts.json` (last 20 kept) for context-dependent recall in
  future sessions.

## Install

```bash
npm install -g brain-memory          # the brain CLI (prerequisite)
openclaw plugins install openclaw-brain-memory
```

`~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "slots": { "memory": "brain-memory" },
    "entries": { "brain-memory": { "enabled": true } }
  }
}
```

Full documentation, alternative install paths (slot-neutral hook pack, remote
MCP), NVIDIA NemoClaw sandbox policy, and troubleshooting:
[integrations/openclaw](https://github.com/omelas-tech/brain/tree/main/integrations/openclaw).

## Configuration

| Option           | Default      | Description                                          |
| ---------------- | ------------ | ---------------------------------------------------- |
| `brainBin`       | `"brain"`    | Brain binary path when not on the Gateway's PATH     |
| `project`        | `"openclaw"` | Project label for context-dependent recall           |
| `topRecall`      | `6`          | Default `memory_search` result count                 |
| `autoReinforce`  | `true`       | Reinforce memories returned by `memory_search`       |
| `syncOnMemorize` | `false`      | `--sync` after memorize (Brain Cloud / git remote)   |

If the `brain` CLI is missing, the plugin logs one warning and disables
itself gracefully — it never blocks the Gateway.

## License

MIT © Omelas
