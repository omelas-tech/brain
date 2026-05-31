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
├── bin/
│   └── install.js              # Interactive setup wizard (brain-memory)
├── commands/
│   └── brain/                  # Slash command definitions
│       ├── init.md
│       ├── memorize.md
│       ├── remember.md
│       ├── review.md
│       ├── explore.md
│       ├── consolidate.md
│       ├── forget.md
│       ├── sunshine.md
│       ├── sleep.md
│       ├── status.md
│       └── sync.md
├── prompts/
│   ├── claude.md               # CLAUDE.md content (injected by installer)
│   ├── gemini.md               # GEMINI.md content (injected by installer)
│   └── openai.md               # AGENTS.md content (injected by installer)
├── hooks/
│   ├── session-start.md        # Ambient memory loading + review notifications
│   └── session-end.md          # Auto-memorize suggestion + context capture
├── templates/
│   └── default-categories.json # Default brain category definitions
├── src/
│   ├── scorer.js               # Decay, spreading activation, context matching, spaced reinforcement
│   ├── index-manager.js        # Index, associations, contexts, review queue, archive CRUD
│   ├── crypto.js               # AES-256-GCM encryption (PBKDF2 key derivation)
│   ├── git-sync.js             # Git-based sync engine (push/pull via system git)
│   └── export-import.js        # Single-file encrypted export/import
├── CLAUDE.md                   # Development guide for this repo
├── package.json
└── README.md
```

## Submitting Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add or update tests as needed
4. Run `npm test` and ensure all tests pass
5. Open a pull request with a clear description of what changed and why

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
2. Bumps the version in `package.json`
3. Creates a git commit and tag
4. Publishes to npm

After publishing, push the commit and tag:

```bash
git push && git push --tags
```

## Reporting Issues

Open an issue at [github.com/omelas-tech/brain/issues](https://github.com/omelas-tech/brain/issues). Include steps to reproduce, expected vs actual behavior, and your Node.js version.
