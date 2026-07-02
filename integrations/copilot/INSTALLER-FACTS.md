# Copilot CLI — installer facts (internal)

Facts needed to wire a `copilot` entry into `src/installer.js` `RUNTIMES`,
mirroring the `openai` (Codex) entry. Every fact below was verified against
GitHub Docs on 2026-07-02 (Copilot CLI GA docs); source URL per item.

## (a) Custom instructions files

Source: <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions>

- **Global (user-level): `$HOME/.copilot/copilot-instructions.md`** — the
  documented user-wide instructions file. This is the injection target for
  the global prompt (`prompts/copilot.md` content), analogous to
  `~/.codex/AGENTS.md` for Codex.
- **Repo-level (all combined, order non-deterministic on conflict):**
  - `AGENTS.md` at the repository root — "treated as primary instructions".
    Also read from the current working directory and from any directory in
    the `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` env var (comma-separated).
    `CLAUDE.md` / `GEMINI.md` at the repo root are accepted as alternatives.
  - `.github/copilot-instructions.md` — repository-wide; used *in addition
    to* `AGENTS.md` when both exist.
  - `.github/instructions/NAME.instructions.md` — path-scoped.
- **Installer implication:** local scope can reuse the same `AGENTS.md`
  injection the `openai` runtime already performs (one file serves both
  Codex and Copilot). Global scope needs a new file name:
  `copilot-instructions.md` under `~/.copilot/` — note the global and local
  prompt file names differ, unlike existing runtimes.

## (b) Skills directories

Source: <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills>

- **User-level:** `~/.copilot/skills/` **and** `~/.agents/skills/` — both are
  documented personal-skill locations. **Yes, Copilot CLI reads the
  cross-tool `~/.agents/skills/`** (the agentskills.io convention Codex
  uses), so `skillsGlobalDir` can stay `~/.agents/skills` and be shared with
  the `openai` entry.
- **Project-level:** `.github/skills/`, `.claude/skills/`, `.agents/skills/`
  — so `skillsLocalDir: '.agents/skills'` (already used by `openai`) works
  for Copilot too.
- Skills can be toggled in-session with `/skills`.

## (c) SKILL.md frontmatter

Source: <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills>
(and <https://docs.github.com/en/copilot/concepts/agents/about-agent-skills>)

- `name` — **required**. "Must be lowercase, using hyphens for spaces.
  Typically, this matches the name of the skill's directory" — matching the
  folder is convention, not a hard requirement. Keep them matching anyway
  (the existing `skillName: true` behavior).
- `description` — **required** (what the skill does + when to use it).
- `license` — optional. No other required fields documented.
- Layout: one directory per skill containing `SKILL.md`
  (e.g. `skills/brain-remember/SKILL.md`).

## (d) Config directory

Source: <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks>
and <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers>

- **`~/.copilot/`** is the config home (overridable via `COPILOT_HOME`).
  Known contents: `copilot-instructions.md`, `skills/`, `hooks/*.json`
  (user-level hooks), `mcp-config.json`, `settings.json` (has a `hooks`
  field), `installed-plugins/`.

## Suggested RUNTIMES entry

```js
copilot: {
  name: 'GitHub Copilot CLI',
  globalDir: path.join(os.homedir(), '.copilot'),
  localDir: '.copilot',
  commandsSubdir: 'skills',
  // Copilot reads the cross-tool ~/.agents/skills/ (same as Codex) plus its
  // own ~/.copilot/skills/. Reuse the shared cross-tool dir.
  skillsGlobalDir: path.join(os.homedir(), '.agents', 'skills'),
  skillsLocalDir: path.join('.agents', 'skills'),
  // NB: global instructions file is ~/.copilot/copilot-instructions.md, but
  // the LOCAL (repo) file is AGENTS.md — the same file the `openai` runtime
  // writes. If the installer's promptFile abstraction assumes one name for
  // both scopes, Copilot needs a global/local split (or local injection can
  // simply be skipped when the openai runtime already wrote AGENTS.md).
  promptFile: 'copilot-instructions.md',
  promptSource: 'copilot.md',
  commandStyle: 'skills',
  skillName: true,
},
```

## Extra facts the parent may want

- **Plugin install (end-user command):**
  `copilot plugin install omelas-tech/brain:integrations/copilot/plugin`
  — the `OWNER/REPO:PATH/TO/PLUGIN` GitHub-subdirectory form. Local path and
  git-URL forms also documented. Installed plugins land under
  `~/.copilot/installed-plugins/`. Manifest discovery order:
  `.plugin/plugin.json`, `plugin.json`, `.github/plugin/plugin.json`,
  `.claude-plugin/plugin.json`.
  Source: <https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference>
- **Hooks:** full lifecycle exists — `sessionStart` (output
  `{"additionalContext": "..."}` injects context as a user message),
  `sessionEnd`, `userPromptSubmitted`, `preToolUse` (allow/deny/modify),
  `postToolUse`, `agentStop`, and more. Hook config: `{"version": 1,
  "hooks": {event: [{"type": "command", "bash": ..., "powershell": ...,
  "cwd": ..., "timeoutSec": N}]}}`; `cwd` is "absolute or relative to the
  configuration file" and supports `${PLUGIN_ROOT}`. Default timeout 30 s;
  hooks are fail-open except preToolUse crashes.
  Source: <https://docs.github.com/en/copilot/reference/hooks-reference>
- **MCP:** `~/.copilot/mcp-config.json`; remote servers use
  `{"type": "http", "url": ..., "headers": {...}, "tools": [...]}`. OAuth is
  supported for remote HTTP servers (Dynamic Client Registration;
  re-auth via `/mcp auth <name>`).
  Sources: <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers>,
  <https://github.com/github/copilot-cli/issues/2717> (DCR behavior).
- **Built-in memory:** Copilot CLI's first-party repository/cross-session
  memory is not pluggable; brain layers alongside it (documented in this
  integration's README for end users).
