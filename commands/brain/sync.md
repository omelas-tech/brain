---
description: Sync memories via Git remote, Brain Cloud, or export/import
argument-hint: "[subcommand]"
---

# /brain:sync — Portable Sync

You are managing synchronization for the Brain Memory system. This enables manual push/pull of `~/.brain/` memories via any Git remote, plus encrypted single-file export/import for portable transfers.

**CRITICAL RULES:**
- NEVER auto-sync — always require explicit user action
- NEVER silently overwrite files on pull/import — show a preview first
- NEVER display passphrases or secrets in output
- Push operations execute immediately (no confirmation) — the user said "push"
- Pull/import operations warn before overwriting local data

## First run — auto-initialize if missing

The installer normally creates `~/.brain/` at install time. If `~/.brain/index.json` is
**missing** when any sync subcommand runs, create the standard structure first (no separate
init command is needed), then continue:

```
~/.brain/
├── index.json          # { version: 2, memory_count: 0, memories: {}, config: {…} }
├── associations.json   # { version: 1, edges: {} }
├── contexts.json       # { version: 1, sessions: [] }
├── review-queue.json   # { version: 1, items: [] }
├── professional/_meta.json
├── personal/_meta.json
├── social/_meta.json
├── family/_meta.json
├── _consolidated/_meta.json
└── _archived/index.json   # { version: 1, archived_count: 0, memories: {} }
```

Each `_meta.json` is `{ "category": "<name>", "description": "<from defaults>", "created":
"<ISO>", "memory_count": 0, "subcategories": [] }`. The `index.json` `config` block carries the
standard decay/association defaults (max_depth 6, consolidation_threshold 0.3, association_config
with spreading-activation depth 2, etc.). After creating the structure, proceed with the
requested subcommand.

## Subcommands

Parse the user's input to determine the subcommand:

**Cloud Sync (Brain Cloud API):**
- `cloud login [--api-url URL]` → Authenticate via device code flow
- `cloud push` → Upload ~/.brain/ to Brain Cloud
- `cloud pull` → Download from Brain Cloud to ~/.brain/
- `cloud status` → Show cloud connection info
- `cloud logout` → Clear stored credentials

**Git Sync (any Git remote):**
- `setup <url>` → Configure a Git remote for sync
- `push` → Commit and push local changes to remote
- `pull` → Fetch and merge remote changes to local
- `status` → Show sync state (ahead/behind)
- `export [path]` → Export ~/.brain/ to an encrypted single file
- `import <path>` → Import from an export file
- `disconnect` → Remove sync configuration

If no subcommand is given, show available subcommands.

---

## `/brain:sync cloud login [--api-url URL]`

### Steps

1. **Check if already logged in:**
   - Read `~/.brain/.cloud/config.json` via `readConfig()` from `src/cloud-sync.js`.
   - If already connected, show current user and ask if they want to re-authenticate.

2. **Start device code flow:**
   - Run `brain cloud login` (or call `login()` from `src/cloud-sync.js`).
   - This calls `POST /auth/device/request` and returns a user code + verification URL.

3. **Display instructions to user:**
   ```
   🔐 Brain Cloud Login
   
   Open this URL in your browser:
     <verify_url>
   
   Your code: <user_code>
   
   Waiting for approval...
   ```

4. **Wait for approval:**
   - The CLI polls `POST /auth/device/poll` every 5 seconds.
   - Once approved, tokens are saved to `~/.brain/.cloud/config.json`.

5. **Show result:**
   ```
   ✓ Logged in as <email>
     Brain ID: <brain_id>
     API: <api_url>
   ```

---

## `/brain:sync cloud push`

### Prerequisites

Check that the `brain` CLI is available (run `brain --version`). If not:
```
brain CLI is not installed. Install it with:
  npm install -g brain-memory
```
Then return — do not attempt the push.

### Steps

1. **Check logged in.** If not, suggest `cloud login`.

2. **Execute push immediately** — no confirmation needed:
   - Run `brain cloud push`.
   - Show result:
   ```
   ✓ Push complete!
     Size:     <size>
     Files:    <count>
     Checksum: <checksum>
   ```

---

## `/brain:sync cloud pull`

### Steps

1. **Check logged in.**

2. **Warn about overwrite:**
   ```
   📥 Cloud Pull Preview:
     Source: <api_url>
     ⚠️  This will overwrite local files with the cloud version.
   ```

3. **Ask for confirmation.**

4. **Execute pull:**
   - Run `brain cloud pull` (or call `pull()` from `src/cloud-sync.js`).
   - Downloads tar.gz from `GET /api/brains/{id}/sync` and extracts to `~/.brain/`.
   - Show result:
   ```
   ✓ Pull complete!
     Size:     <size>
   ```

5. **Rebuild index:**
   - After pull, run the index manager to rebuild `~/.brain/index.json`.

---

## `/brain:sync cloud status`

### Steps

1. **Read cloud config** using `readConfig()` from `src/cloud-sync.js`.

2. **Fetch live status** (if connected) by calling `status()` from `src/cloud-sync.js`.

3. **Display dashboard:**
   ```
   ☁️  Brain Cloud Status
   ─────────────────────────
   API:          <api_url or "not connected">
   User:         <email>
   Brain ID:     <brain_id>
   Cloud Size:   <size>
   Cloud Files:  <count>
   Last Push:    <timestamp or "never">
   Last Pull:    <timestamp or "never">
   Last Synced:  <timestamp or "never">
   Connected:    <timestamp>
   ```

---

## `/brain:sync cloud logout`

### Steps

1. **Show current connection** (API URL, email).
2. **Ask for confirmation:** "This will clear your stored credentials. Cloud data will NOT be deleted."
3. **Remove `~/.brain/.cloud/` directory.**
4. **Confirm:** "✓ Logged out. Cloud data is untouched."

---

## `/brain:sync setup <url>`

### Steps

1. **Check prerequisites:**
   - Verify `~/.brain/` exists. If not, auto-initialize it first (see "First run" above).
   - Verify `git` is available (`checkGitAvailable()` from `src/git-sync.js`).
   - Check if sync is already configured (`~/.brain/.sync/config.json`). If so, ask if they want to reconfigure.

2. **Get remote URL** (if not provided):
   - Ask for the Git remote URL (SSH or HTTPS).
   - Auto-detect `gh` CLI: if available, offer to create a private repo with `gh repo create brain-data --private`.
   - Examples:
     - `git@github.com:user/brain-data.git`
     - `https://github.com/user/brain-data.git`
     - `git@gitlab.com:user/brain-data.git`

3. **Ask about encryption** (optional):
   - "Would you like to encrypt memories before pushing? (recommended for sensitive data)"
   - If yes, ask for a passphrase (will be needed on every push/pull and on other devices).

4. **Initialize sync:**
   - Call `initSyncRepo()` and `configureRemote()` from `src/git-sync.js`.
   - Write config to `~/.brain/.sync/config.json` via `writeSyncConfig()`.

5. **Show result:**
   ```
   ✓ Git sync configured!
     Remote:      <remote-url>
     Branch:      main
     Encryption:  <enabled/disabled>

   Use /brain:sync push to upload your memories.
   Use /brain:sync pull to download from remote.
   ```

---

## `/brain:sync push`

### Steps

1. **Check sync is configured.** If not, suggest `/brain:sync setup`.

2. **Check status** via `getStatus()`. If behind > 0, warn: "Remote has newer changes. Consider pulling first." and stop.

3. **Execute push immediately** — no confirmation needed:
   - If encryption is enabled, ask for passphrase.
   - Call `push()` from `src/git-sync.js`.
   - Show result:
   ```
   ✓ Push complete!
     Committed: <message>
     Remote:    <remote-url>
   ```

---

## `/brain:sync pull`

### Steps

1. **Check sync is configured.**

2. **Preview:**
   - Call `getStatus()` to show ahead/behind count.
   ```
   📥 Pull Preview:
     Remote:  <remote-url>
     Status:  <behind> new commits to pull
   ```

3. **Ask for confirmation.**

4. **Execute pull:**
   - If encryption is enabled, ask for passphrase.
   - Call `pull()` from `src/git-sync.js`.
   - Show result:
   ```
   ✓ Pull complete!
     Updated <count> files from remote.
   ```

---

## `/brain:sync status`

### Steps

1. **Read sync config** using `getSyncConfig()` from `src/git-sync.js`.

2. **Display dashboard:**
   ```
   🔄 Sync Status
   ─────────────────────
   Remote:      <remote-url or "not configured">
   Branch:      <branch>
   Encryption:  <enabled/disabled>
   Last Push:   <timestamp or "never">
   Last Pull:   <timestamp or "never">
   Ahead:       <count> commits
   Behind:      <count> commits
   ```

---

## `/brain:sync export [path]`

### Steps

1. **Determine output path:**
   - Default: `.brain-export` in the current directory.
   - User can specify a custom path.

2. **Ask about encryption:**
   - "Would you like to encrypt the export? (recommended)"
   - If yes, ask for a passphrase.

3. **Execute export:**
   - Call `exportBrain()` from `src/export-import.js`.
   - Show result:
   ```
   ✓ Brain exported!
     File:     <output-path>
     Memories: <count> files packed
     Encrypted: <yes/no>
     Size:     <file-size>

   Transfer this file to another machine and run /brain:sync import <path>
   ```

---

## `/brain:sync import <path>`

### Steps

1. **Preview the import:**
   - Call `previewImport()` from `src/export-import.js`.
   - Display:
   ```
   📦 Import Preview:
     File:        <path>
     Exported at: <date>
     Total files: <count>
     New:         <count> (will be created)
     Existing:    <count> (will be overwritten)
   ```

2. **Ask for import mode:**
   - **Overwrite** (default): Replace all matching files with the imported versions.
   - **Merge**: Only import files newer than local versions.

3. **If encrypted, ask for passphrase.**

4. **Ask for confirmation.**

5. **Execute import:**
   - Call `importBrain()` from `src/export-import.js`.
   - Show result:
   ```
   ✓ Import complete!
     Imported: <count> files
     Skipped:  <count> (merge mode, local was newer)
   ```

---

## `/brain:sync disconnect`

### Steps

1. **Show current config** (remote URL).
2. **Ask for confirmation:** "This will remove sync configuration. Your remote data will NOT be deleted."
3. **Remove `~/.brain/.sync/` directory.**
4. **Confirm:** "✓ Sync disconnected. Remote repository is untouched."

---

## Key Implementation Notes

- **Cloud sync engine**: `src/cloud-sync.js` — API client for Brain Cloud
- **Cloud CLI**: `bin/cloud-sync.js` — installed as `brain cloud` command
- **Cloud config**: stored in `~/.brain/.cloud/config.json` (tokens, brain ID, API URL)
- **Cloud protocol**: tar.gz archives uploaded/downloaded via REST API
- Git sync engine: `src/git-sync.js`
- Export/import: `src/export-import.js`
- Crypto utilities: `src/crypto.js`
- Git sync config stored in `~/.brain/.sync/config.json` (local only)
- Hidden git repo at `~/.brain/.sync/repo/` — never interferes with the project's own git
- All operations use Node.js built-ins only — no npm runtime dependencies
