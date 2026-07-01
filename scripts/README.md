# scripts/

Repo maintenance scripts. The main one is the **agentic release/changelog tool**.

## Release & changelog (`release.mjs`)

`CHANGELOG.md` (Keep a Changelog) is the single source of truth. The website
changelog page (`/docs/reference/changelog`) is **derived** from it at build time
by `website/scripts/build-changelog.mjs` → `website/public/data/changelog.json`, so
the site can never drift from the committed changelog.

`release.mjs` writes the next `CHANGELOG.md` entry for you: it collects the git
delta since the last `v*` tag, asks `claude -p` to classify it into Keep-a-Changelog
categories (`{ summary, changes }`), lets you review/edit, then bumps
`package.json`, regenerates the website feed, and commits + tags the release.

```bash
npm run changelog:status          # what would ship: pending commits + next version
npm run changelog                 # generate entry → review → bump → commit → tag
node scripts/release.mjs generate --dry-run   # classify + preview the entry, write nothing
node scripts/release.mjs generate --skip-claude   # enter the notes by hand (no model)
node scripts/release.mjs sync-web             # just regenerate changelog.json from CHANGELOG.md
```

**Flags** (for `generate`): `--dry-run`, `--yes` (accept the model's proposal — for
non-interactive use), `--skip-claude`, `--no-commit`, `--since <ref>`, `--as <version>`.

**Versioning:** bumps the `-beta.N` prerelease counter by default (the brain
convention). Override with `--as 0.1.0` to graduate.

**Requirements:** the `claude` CLI must be installed and authenticated (the tool
shells out to `claude -p`). If it's unavailable, times out (120s, override with
`BRAIN_RELEASE_CLAUDE_TIMEOUT_MS`), or returns junk, `release.mjs` falls back to
manual entry — a broken model never blocks a release.

**Publishing stays separate and deliberate.** After the release commit + tag, ship it:

```bash
npm publish --tag beta
npm dist-tag add brain-memory@<version> latest   # promote to `latest` so `npm i brain-memory` gets it
git push --follow-tags
```

## Other

- `add-command-frontmatter.js` — one-off: adds YAML frontmatter to command files.
