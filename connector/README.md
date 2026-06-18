# brain-connector

The **Brain Memory Claude connector** — a remote MCP server that exposes the brain's
scored recall to Claude (web / desktop / **iOS** / Cowork). Built with the official
[`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol) per Anthropic's
`build-mcp-server` guidance. Design rationale lives in
`brain-cloud/docs/connector-architecture.md`.

It lives in this repo (not the npm package — excluded from `package.json` `files`, like
`website/`) so it reuses the **real** recall engine in `../src` directly. One brain, one
engine, two faces.

## Status: 🟢 LIVE IN PRODUCTION — Phase 1 + 2 (read + write)

Deployed at **`https://mcp.brainmemory.ai/mcp`** (Node service on the VPS beside brain-cloud;
systemd + nginx + certbot — see `deploy/`). Added at claude.ai and verified on **Claude web +
iPhone**. Tools: `brain_recall`, `brain_status` (read) + `brain_memorize`, `brain_pin`,
`brain_unpin`, `brain_forget` (write — writes sync back to brain-cloud; hosts gate them behind
confirmation).

Two things to know in production:
- **One brain ↔ one Google account** — the connector serves the brain of whatever **Firebase
  (Google)** identity signs in, so the brain must be pushed to *that* brain-cloud account. See
  [Identity & accounts](#identity--accounts) below for how the connector now surfaces a wrong /
  empty / multi-brain account instead of silently serving a phantom brain.
- **Sync-back token window** — writes sync back using the Firebase token from login (~1 h); a write
  after it expires persists locally but syncs on next login. Local CLI memories (`brain cloud push`)
  now reach an active session automatically via a **TTL re-pull** (`CONNECTOR_REPULL_TTL_MS`, default
  120s) — it re-pulls only when the cloud checksum changed and never over an unsynced local write.

`npm test` typechecks and proves the whole path end-to-end **in one server** — the
complete OAuth 2.1 handshake through to real scored recall (token request is **form-urlencoded**,
matching real clients):

```
① unauthenticated MCP call → 401 + WWW-Authenticate (RFC 9728)
② discovery → AS metadata (RFC 8414), PKCE S256
③ Dynamic Client Registration (RFC 7591)
④ authorize → code (iss + state validated, RFC 9207)
⑤ token → audience-bound Bearer (PKCE verified, RFC 8707)
⑥ MCP initialize + tools/list → [brain_recall, brain_status, brain_memorize, brain_pin, brain_unpin, brain_forget]  (official SDK)
⑦ brain_recall(query) → the brain's REAL scored results (relevance + decayed
   strength + spreading activation), identical to the CLI
```

## How recall stays identical to the CLI

The engine bridge (`src/engine.ts`) runs the repo's `bin/recall.js` with `BRAIN_DIR`
pointed at the authenticated user's brain working copy — so the connector's scoring is
byte-for-byte the CLI's, with zero reimplementation. (`BRAIN_DIR` is the same override
the CLI ships.)

## Run / test

```bash
npm install
npm test          # end-to-end Phase 1 proof
npm start         # serve MCP on http://localhost:8788
```

## Tools

| Tool | Kind | Description |
|------|------|-------------|
| `brain_recall` | read (`readOnlyHint`) | Ranked recall for a query, scored by the brain engine. |
| `brain_status` | read (`readOnlyHint`) | Memory count + last-updated for the user's brain. |
| `brain_memorize` | write | Store the **explicit content** provided (never the conversation); immediately recallable. |
| `brain_pin` / `brain_unpin` | write | Toggle the always-present tier. |
| `brain_forget` | write (`destructiveHint`) | Archive a memory (recoverable — moved to `_archived/`, not hard-deleted). |

Writes reuse the deterministic CLIs (`memorize.js` / `pin.js` / `unpin.js` / `forget.js`) and then
`syncBack()` to brain-cloud.

## Identity & accounts

**One brain ↔ one Google account.** The connector has no idea which laptop you're on — it serves the
brain belonging to whatever Firebase (Google) identity completes the sign-in. The verified `uid` maps
deterministically to a brain user (`resolveBrainUserId`), and that user's canonical brain is pulled
from brain-cloud. So the rule is simple: **connect with the same Google account your CLI's
`brain cloud` syncs to.**

To keep that rule from failing silently, `ensureUserBrain` returns an `identity` signal that the
tools surface to you:

| Situation | `identity.status` | What you see |
|-----------|-------------------|--------------|
| Account has **no** brain in Brain Cloud | `no-cloud-brain` | A note (in `brain_status`, and in `brain_recall` when it finds nothing) telling you this account is empty — most likely you signed in with the wrong Google account, or you're brand new. |
| Account has exactly **one** brain | `ok` | Nothing — the common, unambiguous case. |
| (Pro) account has **several** brains | `multiple-brains` | A note that the connector is serving your **oldest** brain (the deterministic canonical pick). |

This is *guidance, not enforcement* — a genuinely new user with no brain yet still gets a usable
empty brain. **Account-linking** (letting one Google identity span several brains, or choosing which
brain a multi-brain account exposes) is deliberately deferred; see the design doc and `CHORES.md`.

## Auth

Two layers — both real now:

1. **OAuth 2.1 between Claude and the connector** (`src/oauth.ts`): authorize / token / register
   / metadata, PKCE S256, RFC 8707 audience binding, RFC 9207 `iss`. Tokens mint into
   `src/auth.ts`'s store; the `/mcp` guard validates them (incl. audience).
2. **Who is the human** (`src/firebase.ts`): `/authorize` bounces the user through **Firebase
   login** (the same project brain-cloud uses). The connector verifies the ID token
   **server-side and secret-free** — RS256 against Google's public certs, checking `aud`/`iss`/
   `exp` — so it needs only the public project config, no service-account key. The verified
   `uid` maps to the brain user, then the OAuth code is minted.

If `FIREBASE_*` env is **not** set, `/authorize` falls back to a fixed dev user
(`STUB:FIREBASE`) so the headless test runs without a browser.

### See the Firebase login work (demo)

```bash
cp .env.example .env      # fill in FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID
npm start                 # http://localhost:8788
# open http://localhost:8788/dev/whoami → "Sign in with Google"
```

`/dev/whoami` runs *only* the identity step in isolation: sign in, and the connector shows your
verified `firebase_uid`, `email`, and the resolved `brain_user_id` + `brain_dir` — exactly what
`/authorize` uses to pick whose brain to serve. (`localhost` is an authorized Firebase domain by
default, so popup sign-in works locally.)

## Per-user store (`src/store.ts`)

`ensureUserBrain({ userId, brainDir, idToken })` populates the user's brain working copy from a
pluggable provider, then the engine recalls over it. Providers (via `CONNECTOR_STORE`, else
inferred):

- **`brain-cloud`** (production) — pulls the user's `{brainID}.tar.gz` from
  `BRAIN_CLOUD_API_URL` (default `https://api.brainmemory.ai`) using their **Firebase ID token**
  (brain-cloud's middleware accepts it directly), then `tar xzf` into `brainDir`. Refreshed at
  each login.
- **`local`** (dev) — symlinks `brainDir` → `$DEV_LOCAL_BRAIN` (your live `~/.brain`), so your
  machine serves your real brain through the connector.
- **`none`** — assume pre-provisioned (tests).

Always graceful: if the brain is still missing, it empty-inits a valid (recall-safe) brain.

## Next

- **Account-linking** — let one user span several brains (or pick which brain a multi-brain account
  exposes), superseding today's "serve the oldest brain" canonical rule. See [Identity & accounts](#identity--accounts).
- **Directory submission** — remaining manual steps (test account, MCPB packaging, launch post); see
  the submission checklist in `brain-cloud/docs/connector-architecture.md` §7.
