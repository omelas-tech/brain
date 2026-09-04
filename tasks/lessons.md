# tasks/lessons.md — brain

Patterns worth keeping from the Aug-31 scan build (2026-09-03). No user corrections
this session; these are self-observed.

- **Verify the vendor surface before designing to it.** The scan's "Codex extension"
  item was compile-time Rust inside the Codex binary; hooks were the real surface.
  Read the vendor repo (`ext/`, `hooks/`) before scoping anything that depends on a
  third-party API.
- **One hooks.json, two hosts.** Codex exports `CLAUDE_PLUGIN_ROOT` to plugin hooks
  for compatibility. Keep host-agnostic scripts at the repo root and expand the
  placeholder in the installer rather than shipping per-host copies.
- **Piping JSON through `echo "$VAR"` in zsh mangles escapes.** Write hook output to
  a file and parse from there when checking it.
- **`git rm` stages the deletion.** Use `git reset -q -- <path>` afterwards when the
  session must leave everything unstaged.
- **Codex `memorize.js` takes `{memories: [...]}`, not a bare memory.** Tests that
  seed a brain must wrap the payload.
