# Changelog — hermes-brain-memory

## 0.1.0 (2026-07-04)

Initial release.

- Vendors the Brain Memory provider for Hermes Agent (provider payload v1.0.0,
  stdlib only): `brain_recall` / `brain_memorize` / `brain_reinforce` tools,
  budget-bounded session-start context, background prefetch, pre-compression
  reminder, session-context logging, MEMORY.md mirroring, `backup_paths()`.
- `hermes-brain-memory` console script with `install` (idempotent, `--force`),
  `uninstall`, and `status` subcommands targeting `$HERMES_HOME/plugins/brain`
  (mechanism mirrors the `hermes-memori` precedent).
- Verified live end-to-end on Hermes Agent v0.18.0.
