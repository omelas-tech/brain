# tasks/todo.md — Aug-31 scan build (items 3 → 1 → 5)

Source: brain-cloud/docs/scan-actions-2026-08-31.md. Started 2026-09-03.
No commits until the user asks; verify with `npm test` + integration tests after each item.

## Item 3 — Plugin + GitHub-synced marketplace (S–M)
- [x] `.claude-plugin/plugin.json` at repo root — plugin `brain` (commands stay `/brain:*`), commands `./commands/brain/`, hooks `./hooks/hooks.json`
- [x] `hooks/hooks.json` + `hooks/session-start.mjs` (+ `session-end.mjs`) — deterministic Claude Code injection via `node ${CLAUDE_PLUGIN_ROOT}/bin/session-start.js` (no npm dependency)
- [x] `.claude-plugin/marketplace.json` — `brain` (source `./`) + `brain-cloud` (MCP connector only)
- [x] `integrations/brain-cloud-plugin/` — `.claude-plugin/plugin.json` + `.codex-plugin/plugin.json` with inline http MCP server
- [x] `.codex-plugin/plugin.json` (Codex overlay: skills + hooks + interface) and `.agents/plugins/marketplace.json`
- [x] `claude plugin validate .` passes; README install section; CHANGELOG Unreleased entry
- [x] Tests: manifest JSON validity + referenced paths exist (test/plugin-manifests.test.js)

## Item 1 — Codex integration as hooks (M)
- [x] `integrations/codex/hooks/prompt-hook.mjs` — UserPromptSubmit → `brain recall` → additionalContext with `◉ brain-context` marker, token ceiling
- [x] Installer wiring: `--codex` copies hooks to `~/.codex/brain-hooks/`, merges `~/.codex/hooks.json` non-destructively; uninstall reverses; `files` includes `integrations/codex/hooks/`
- [x] Codex harvest adapter in `src/harvest.js` (rollout JSONL) — waits on format research
- [x] Loop prevention: strip brain-injected blocks in harvest; `_import` vs `.import` path fix
- [x] Per-agent budget override (Codex 2,500-token cap)
- [x] Tests: installer wiring, prompt hook, codex adapter; update `integrations/codex/README.md`

## Item 5 — Consent taxonomy + positioning refresh (S–M)
- [x] `sensitivity: standard | sensitive | blocked` frontmatter + index; `memorize --sensitivity`; lint backstop (ID patterns → blocked; category keywords → sensitive)
- [x] `config.json` `sensitive_topics` (default false) → `sensitive` quarantined with `sensitive_opt_out`; `blocked` refused
- [x] session-start / recall exclude `sensitive` unless opted in; receipt `⚠ sensitive`
- [x] Docs: README consent section, prompts/*.md memorize guidance; brain-cloud `positioning-2026-08.md` §6
- [x] Tests: memorize sensitivity, lint, recall exclusion

## Review (2026-09-03)

All three items built in the `brain` repo, uncommitted, unstaged. Verification:
`npm test` 874 → 900+ tests passing (full suite green), all five integration suites
green, `claude plugin validate .` passes (one benign warning about CLAUDE.md at the
plugin root).

What changed vs. the plan:
- Codex "extension" became Codex *hooks* (the extension API is compile-time). One
  `hooks/hooks.json` at the repo root now serves Claude Code and Codex; the old
  `integrations/codex/hooks/` copies and the Stop-hook turn queue were deleted
  because `brain import --source codex` reads `~/.codex/sessions/` directly.
- The prompt-time recall hook (`UserPromptSubmit`) landed for both hosts, not only
  Codex, since the contract is identical.
- `brain recall` gained an in-process `computeRecall` export; `brain session-start`
  gained `--budget`.
- `brain-cloud` docs: `positioning-2026-08.md` §6 addendum.

Not done / follow-ups:
- Codex plugin loading was not exercised on a real Codex install (no `codex` binary
  on this machine); manifests follow the published spec and Codex's own
  `manifest.rs`. Claude Code plugin was validated but not installed into the live
  config (`claude plugin marketplace add ./` to try it).
- brain-cloud Inspector `TreeNode` does not yet surface `sensitivity`.
- Consider registering hooks into `~/.claude/settings.json` from `brain --claude`
  for npm-path users (the plugin is the hook path for Claude Code today).
