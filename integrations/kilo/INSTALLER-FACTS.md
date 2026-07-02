# Kilo — installer facts (internal)

Facts needed to wire a `kilo` entry into `src/installer.js` `RUNTIMES`.
Verified against kilo.ai docs and the Kilo-Org/kilocode / sst/opencode repos
on 2026-07-02; source per item. Applies to **Kilo v7+** (OpenCode-based
rebuild) — the old Roo-derived v5 paths (`.kilocoderules`, mode files) are
gone, though several `.kilocode/` directories remain as legacy fallbacks.

## (a) Instructions files

Source: <https://kilo.ai/docs/customize/custom-rules>,
<https://kilo.ai/docs/customize/agents-md>

- **Repo-level:** `AGENTS.md` at the repo root is read natively (also
  per-directory `AGENTS.md`, loaded dynamically; `AGENT.md` accepted).
  → The `openai` runtime's repo-local `AGENTS.md` injection already covers
  Kilo locally.
- **Global:** there is **no global markdown file read directly**. Global
  instructions go through the `instructions` array in
  `~/.config/kilo/kilo.jsonc` (file paths / globs). Installer flow: write
  `~/.config/kilo/rules/brain-memory.md` (any path works) and add it to the
  `instructions` array — **this requires editing JSONC**, preserve comments
  or document the manual step.
- Priority: agent prompt > project `kilo.jsonc` instructions > root
  `AGENTS.md` > global `kilo.jsonc` instructions > skills.

## (b) Skills directories

Source: <https://kilo.ai/docs/customize/skills>

- **Global:** `~/.kilo/skills/` — NB: under `~/.kilo/`, **not**
  `~/.config/kilo/` and **not** `~/.agents/`. The cross-tool home-level
  `~/.agents/skills/` is *not* documented for Kilo.
- **Project:** `.kilo/skills/` plus compatibility dirs `.agents/skills/`
  and `.claude/skills/` (project-level) — so `skillsLocalDir:
  '.agents/skills'` (already used by `openai`) works for Kilo too.
- Extra paths configurable: `"skills.paths": [...]` and `"skills.urls"`
  in `kilo.jsonc`. Collisions: project `.kilo/skills/` beats global
  `~/.kilo/skills/`.
- SKILL.md frontmatter: `name` required (≤64 chars, lowercase/numbers/
  hyphens), `description` required (≤1024 chars); optional `license`,
  `compatibility`, `metadata` — same constraints as Copilot, so the Copilot
  skill files are reusable verbatim (only the BRAIN_AGENT flavor differs;
  the Kilo plugin's `shell.env` hook sets `BRAIN_AGENT=kilo` regardless).

## (c) Commands (slash commands / workflows)

Source: <https://kilo.ai/docs/customize/workflows>

- **Global:** `~/.config/kilo/commands/` · **Project:** `.kilo/commands/`
- Markdown; filename (minus `.md`) = command name; frontmatter fields:
  `description`, `agent`, `model`, `subtask` (all optional).
- `$ARGUMENTS` substitution is **not documented** for Kilo (upstream
  OpenCode has it; the runtime's `command.execute.before` hook receives an
  `arguments` string, so trailing text reaches the model). The shipped
  commands avoid placeholders and say "treat text after the command as the
  query". // VERIFY on a live Kilo install if placeholder support matters.
- Legacy `.kilocode/workflows/` auto-migrates.

## (d) Config dir(s)

Source: <https://kilo.ai/docs/cli>, <https://kilo.ai/docs/customize/skills>

- **`~/.config/kilo/`** is the main config home: `kilo.jsonc` (legacy
  `opencode.jsonc` read too), `commands/`, `plugin/`, `tui.jsonc`.
- **`~/.kilo/`** additionally holds global `skills/`. Two homes — mind the
  difference.
- Project: `kilo.jsonc` or `.kilo/` (`.kilo/kilo.jsonc`, `.kilo/commands/`,
  `.kilo/plugin/`, `.kilo/skills/`, `.kilo/rules/`); `.kilocode/*` legacy.
- Env: `{env:VAR}` substitution inside config values; `KILO_*` provider
  overrides.

## Suggested RUNTIMES entry

```js
kilo: {
  name: 'Kilo',
  globalDir: path.join(os.homedir(), '.config', 'kilo'),
  localDir: '.kilo',
  commandsSubdir: 'commands',
  // Global skills live under ~/.kilo/skills (NOT ~/.agents/skills);
  // project-level .agents/skills is read via the compatibility dir.
  skillsGlobalDir: path.join(os.homedir(), '.kilo', 'skills'),
  skillsLocalDir: path.join('.agents', 'skills'),
  // Repo-level prompt: AGENTS.md (same file the openai runtime writes).
  // There is NO global prompt file — global injection means adding an
  // entry to the `instructions` array in ~/.config/kilo/kilo.jsonc (JSONC).
  promptFile: 'AGENTS.md',
  promptSource: 'kilo.md',
  commandStyle: 'flat',
},
```

## Extra facts

- **Plugin system (the big one):** stable, OpenCode-compatible runtime
  plugins. Auto-discovery dirs: `.kilo/plugin/` (project),
  `~/.config/kilo/plugin/` (global), `.kilocode/plugin/` (legacy); or the
  `plugin` array in `kilo.jsonc` (npm specifier, `[name, options]` tuple, or
  local path). Module format: `export default { id, server }` where
  `server: async (input, options) => hooks` — matches upstream
  `PluginModule` in `@opencode-ai/plugin` (sst/opencode
  `packages/plugin/src/index.ts`). Hooks used by this integration:
  `chat.message` (mutable `output.parts` — session-start injection), `event`
  (`session.created` / `session.idle` / `session.deleted` — boundary
  tracking), `shell.env` (BRAIN_AGENT labeling). Plugin runtime is **Bun**;
  `node:` builtins work.
  Sources: <https://kilo.ai/docs/automate/extending/plugins>,
  <https://github.com/sst/opencode> (plugin types).
- **Known Kilo bug:** `kilo plugin <module>` currently writes registrations
  to `.opencode/opencode.jsonc` instead of Kilo-named configs
  (<https://github.com/Kilo-Org/kilocode/issues/9503>) — prefer the
  auto-discovery directory copy, which sidesteps it.
- **MCP:** `"mcp"` key in `kilo.jsonc`. Local:
  `{"type":"local","command":[...],"environment":{...},"enabled":true}`.
  Remote: `{"type":"remote","url":...,"headers":{...},"enabled":true}` —
  **OAuth 2.0 supported and auto-started** for remote servers; disable with
  `"oauth": false`.
  Source: <https://kilo.ai/docs/automate/mcp/using-in-kilo-code>
- **No first-class session lifecycle hooks for external tools** (the
  Copilot-style hooks.json). The plugin event bus covers it in-process;
  Kilo-Org/kilocode#5827 tracks the external variant.
