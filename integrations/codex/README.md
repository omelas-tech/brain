# Codex CLI integration

Brain reaches OpenAI Codex CLI three ways. They share one `~/.brain/`.

| Path | What Codex gets | Install |
|------|-----------------|---------|
| **Plugin** (recommended) | `SessionStart` context injection, `UserPromptSubmit` recall, `SessionEnd` tracking, the `brain-memory` skill | `codex /plugins` → add marketplace `omelas-tech/brain` → install `brain`. Also how ChatGPT workspace admins distribute it (Admin → Plugins → Import marketplace). |
| **Installer** | The same three hooks (registered in `~/.codex/hooks.json`), `AGENTS.md` prompt, `brain-*` skills in `~/.agents/skills/` | `npm i -g brain-memory && brain --codex --global`, then `/hooks` once inside Codex to trust them |
| **Hosted connector** | `brain_recall` / `brain_memorize` / … over MCP, no local brain | `codex mcp add brain --url https://mcp.brainmemory.ai/mcp` (or the `brain-cloud` plugin) |

## The hooks

The scripts live at the repository root in [`hooks/`](../../hooks/) and are shared with
the Claude Code plugin — Codex exports `CLAUDE_PLUGIN_ROOT` to plugin hooks for exactly
this kind of compatibility, and the installer expands the same placeholder to the npm
package path. They run the brain engine in-process (no `brain` binary needed) and fail
soft: any error is one stderr line, `{}` on stdout, exit 0.

- **`SessionStart`** → `brain session-start` payload (pinned facts, relevant memories,
  skills index) plus the ambient rules, as `hookSpecificOutput.additionalContext`.
  Codex caps hook context at ~2,500 tokens; brain's default working-memory budget is
  3,000, so lower `working_memory_budget_tokens` in `~/.brain/config.json` (2,000 is
  comfortable) or raise Codex's `additionalContextLimit` for the handler.
- **`UserPromptSubmit`** → deterministic recall against the prompt; top
  `prompt_recall_top` (3) memories within `prompt_recall_budget_tokens` (600), with
  receipts and a short excerpt. Unrelated prompts inject nothing (relevance floor);
  short prompts, slash commands and acknowledgements are skipped. Nothing is
  reinforced by the hook — only by the model, when it actually uses a memory.
- **`SessionEnd`** → one boundary entry in `~/.brain/contexts.json` (Codex allows 1 s
  here, so this is a single in-process write).

What the hooks deliberately do **not** do: memorize. Capture is the model's decision
via `brain memorize` ([design principle 1](../README.md)); a hook that pipes
`last_assistant_message` into memory is transcript dumping.

Injected blocks are wrapped in `<brain-session-context>` / `<brain-context>` so
`brain import` strips them — recalled memories never get harvested back in.

## Cold start from Codex history

`brain import --source codex` reads `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`
directly (format verified against Codex 0.153): user prompts are the `response_item`
messages whose `content_item_kinds` are `user.*` (marker matching for pre-0.148
files), subagent / guardian / consolidation threads are skipped, thread names come
from `session_index.jsonl`, and touched files are read out of `apply_patch` calls.
The import cursor is the rollout id from the filename.

## Codex-native memories (`~/.codex/memories/`) — hands off

Codex 0.15x ships its own `memories` extension (`memories/list|read|search`) over
plain-Markdown files with a git baseline. Since 0.149.0 that workspace rejects and
strips symlinks (PR #39205), so never symlink `~/.brain` content in; out-of-band
writes may be rewritten by consolidation. Brain reads Codex only through the
transcript import path above.

## Testing

```bash
npm test                                   # includes test/plugin-hooks.test.js, test/install.test.js, test/harvest.test.js
echo '{"cwd":"'$PWD'","session_id":"t","hook_event_name":"SessionStart"}' | node hooks/session-start.mjs
echo '{"cwd":"'$PWD'","prompt":"what did we decide about pooling?"}' | node hooks/prompt-recall.mjs
```

Contract references: Codex hooks (`learn.chatgpt.com/docs/hooks`), rollout format
(`openai/codex` `codex-rs/rollout/`, `codex-rs/history/`), plugin hook env
(`codex-rs/hooks/src/engine/discovery.rs`).
