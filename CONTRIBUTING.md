# Contributing to Brain Memory

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Development Setup

```bash
git clone https://github.com/omelas-tech/brain.git
cd brain
npm install  # no dependencies — installs devDependencies only
```

Node.js >= 18.0.0 is required.

## Running Tests

```bash
npm test
```

Tests use Node.js built-in test runner (`node --test`) with no external test framework.

## Project Structure

```
brain/
├── bin/                        # The `brain` CLI: one entry point (brain.js) plus a
│                               #   script per subcommand (recall, memorize, reinforce,
│                               #   pin, forget, verify, audit, restore, import, …)
│                               #   and the interactive installer (install.js)
├── commands/brain/             # Slash command prompts (/brain:remember, /brain:memorize,
│                               #   /brain:status, /brain:pin, /brain:forget, /brain:import,
│                               #   /brain:sync, /brain:skills, /brain:sleep, /brain:verify)
├── prompts/                    # Instruction files the installer injects, one per agent
├── hooks/                      # Session lifecycle hooks (session start/end, prompt recall)
├── integrations/               # Native integrations for individual agents
├── templates/                  # Default brain category definitions
├── src/
│   ├── scorer.js               # Decay, spreading activation, context match, reinforcement
│   ├── tfidf.js                # TF-IDF / BM25 search
│   ├── index-manager.js        # Index, associations, contexts, review queue, archive
│   ├── temporal.js             # Bitemporal validity (valid time vs record time)
│   ├── contradiction.js        # Validity-boundary suggestions for conflicting memories
│   ├── pinning.js              # The always-present tier
│   ├── skills.js               # Procedural skills
│   ├── skill-verify.js         # Skill verification
│   ├── receipt.js              # Recall receipts
│   ├── provenance.js           # Origin and trust policy
│   ├── content-lint.js         # Flags instruction-shaped writes
│   ├── quarantine.js           # Pending-verification state
│   ├── anomaly.js              # Anomalous-write detection
│   ├── integrity.js            # SHA-256 baselines and content-drift detection
│   ├── audit.js                # Append-only audit trail
│   ├── sensitivity.js          # Sensitive-topic consent tiers
│   ├── harvest.js              # Cold-start import from agent transcripts
│   ├── crypto.js               # AES-256-GCM encryption (PBKDF2 key derivation)
│   ├── git-sync.js             # Git-based sync (push/pull via system git)
│   ├── export-import.js        # Single-file encrypted export/import
│   ├── cloud-sync.js           # Optional Brain Cloud sync client
│   └── installer.js            # Per-agent install targets
├── connector/                  # Remote MCP server used by the optional hosted service
├── benchmark/                  # Recall benchmark harness and data
├── scripts/                    # Release and maintenance scripts
├── test/                       # node --test suites
├── website/                    # brainmemory.ai source
├── CLAUDE.md                   # Development guide for this repo
├── GOVERNANCE.md               # How the project is run
├── MAINTAINERS.md              # Who maintains it
└── README.md
```

## Submitting Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add or update tests as needed
4. Run `npm test` and ensure all tests pass
5. Open a pull request with a clear description of what changed and why

Looking for somewhere to start? Issues labelled
[`good first issue`](https://github.com/omelas-tech/brain/labels/good%20first%20issue)
and [`help wanted`](https://github.com/omelas-tech/brain/labels/help%20wanted)
are the best entry points.

Changes to the memory file format, the scoring model or the security model are
discussed in a public `rfc` issue before they land. [GOVERNANCE.md](GOVERNANCE.md)
describes that process, how decisions are made, and how to become a maintainer.
By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Releasing

Maintainers only. Tests run automatically before every release via the `prerelease` script.

```bash
# Beta release (bumps 0.1.0-beta.3 → 0.1.0-beta.4)
npm run release:beta

# Stable releases
npm run release:patch   # 0.1.0 → 0.1.1
npm run release:minor   # 0.1.1 → 0.2.0
npm run release:major   # 0.2.0 → 1.0.0
```

Each release command:
1. Runs the full test suite
2. Bumps the version in `package.json` — the `version` lifecycle script then
   syncs `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` and the
   marketplace entry to the same version (`test/plugin-manifests.test.js`
   fails if they drift)
3. Creates a git commit and tag
4. Publishes to npm

Cut the changelog first: move the `[Unreleased]` items under a new
`## [x.y.z] - YYYY-MM-DD` header with a short summary paragraph, then run
`node scripts/release.mjs sync-web` so the website feed picks it up. Plugin
installs (Claude Code, Codex, ChatGPT workspace imports) update from the
tagged repository on their own sync schedule; nothing extra to publish.

After publishing, push the commit and tag:

```bash
git push && git push --tags
```

## Reporting Issues

Open an issue at [github.com/omelas-tech/brain/issues](https://github.com/omelas-tech/brain/issues). Include steps to reproduce, expected vs actual behavior, and your Node.js version.
