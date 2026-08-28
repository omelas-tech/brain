# Codex CLI hooks integration

Deep integration with OpenAI Codex CLI's hooks engine (Codex **0.148.0+**), layered on
the installer's existing `--codex` runtime (prompt → `~/.codex/AGENTS.md`, skills →
`~/.agents/skills/`). Hooks add the two things prompts can't do:

1. **Deterministic session-start injection.** A `SessionStart` command hook runs
   `brain session-start --project <cwd>` and returns the budget-bounded payload
   (pinned facts, skills index, context recall) as
   `hookSpecificOutput.additionalContext` — the same ambient-awareness injection the
   Claude Code, Copilot, Kilo, OpenClaw, and Hermes integrations perform at their
   hosts' canonical injection points.
2. **Turn bookkeeping for import.** An async `Stop` hook appends
   `{ts, session_id, turn_id, transcript_path, cwd}` to
   `~/.brain/_import/codex-turns.jsonl`, so `/brain:import` and the sleep cycle know
   exactly which Codex transcripts are new instead of re-scanning
   `~/.codex/sessions/`.

**What the Stop hook deliberately does NOT do:** memorize. Capture happens through
`brain memorize` when the *model* decides something is worth remembering
([design principle 1](../README.md)) — a hook that pipes `last_assistant_message`
into memory is mechanical transcript dumping and produces observation-grade noise.

## Install (manual, until wired into `bin/install.js`)

```bash
mkdir -p ~/.codex/brain-hooks
cp hooks/session-start-hook.mjs hooks/stop-hook.mjs ~/.codex/brain-hooks/
# merge hooks/hooks.json into ~/.codex/hooks.json (create it if absent)
```

Then run `/hooks` inside Codex to review/trust the hook layer. Kill switch:
`[features] hooks = false` in `~/.codex/config.toml`.

## The hook contract we rely on (verified 2026-08-25)

- Events arrive as JSON on stdin: `session_id`, `transcript_path`, `cwd`,
  `hook_event_name`, plus `turn_id` on turn-scoped events; `Stop` adds
  `stop_hook_active` and optional `last_assistant_message`.
- Handler types: `command` and `mcp_tool` are supported (`prompt`/`agent` parsed but
  skipped). `async = true` exists **only for command hooks** (max 8 concurrent per
  session; cannot block/approve/rewrite; output delivered at the next safe point).
- Output: exit 0 continues; stdout JSON may carry
  `hookSpecificOutput.additionalContext` (capped ~2,500 tokens — brain's payload is
  budget-bounded well below that; raise with `additionalContextLimit` if needed).
- Config layers merge (user `~/.codex/hooks.json` / `[hooks]` in config.toml →
  project `.codex/` after trust review → plugin → enterprise `requirements.toml`).
- Sources: Codex hooks docs (`developers.openai.com/codex/hooks`), PR #37533 (async
  command hooks), PR #38705 (`mcp_tool` handlers).

## Alternative: `mcp_tool` handler against the hosted connector

Hooks can call a tool on an **already-connected** MCP server without any approval
prompt ("MCP tool hooks run synchronously. They don't request tool approval or
trigger other hooks"). If you use the hosted connector, register it first:

```toml
[mcp_servers.brain]
url = "https://mcp.brainmemory.ai/mcp"
```

and a `Stop` entry in `hooks.json` could then call `brain_memorize` directly with
`${...}` placeholders over the event payload. We ship the command-hook variant as the
default because (a) `mcp_tool` handlers are synchronous-only — they run before the
turn settles and add latency; (b) auto-memorizing on every turn violates the
model-decides capture principle; (c) hooks reuse the session's MCP connection and
fail open if the server is down. The `mcp_tool` path is the right shape for
*explicit* workflows (e.g. a `PostToolUse` matcher on a specific tool whose results
should always be archived) — not ambient capture.

## Codex-native memories (`~/.codex/memories/`) — hands off

Codex's own memory pipeline consolidates plain-Markdown memories under
`~/.codex/memories/` with a git baseline. Since 0.149.0 the workspace **rejects and
strips symlinks** (PR #39205), so never symlink `~/.brain` content in; out-of-band
writes may be rewritten by consolidation and surface in its diffs. Brain reads Codex
memories only through the normal `/brain:import` transcript path — the hooks above
are the sanctioned integration surface.

## Testing

Both hook scripts fail soft (missing `brain` CLI → single stderr line, exit 0, host
unaffected). Manual smoke test:

```bash
echo '{"cwd":"'$PWD'","session_id":"thr_test","hook_event_name":"SessionStart"}' \
  | node hooks/session-start-hook.mjs
echo '{"cwd":"'$PWD'","session_id":"thr_test","turn_id":"t1","transcript_path":"/tmp/x.jsonl","hook_event_name":"Stop"}' \
  | node hooks/stop-hook.mjs && tail -1 ~/.brain/_import/codex-turns.jsonl
```

## Installer wiring (TODO)

`--codex` in `bin/install.js` should additionally: copy the two scripts to
`~/.codex/brain-hooks/`, merge `hooks/hooks.json` into `~/.codex/hooks.json`
(non-destructive merge — Codex merges layers itself but two files in one layer warn
at startup), and print a reminder to trust via `/hooks`. Follow the
`INSTALLER-FACTS.md` pattern used by the Copilot integration.
