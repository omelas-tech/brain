# brain-connector

The **Brain Memory Claude connector** — a remote MCP server that exposes the brain's
scored recall to Claude (web / desktop / **iOS** / Cowork). Built with the official
[`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol) per Anthropic's
`build-mcp-server` guidance. Design rationale lives in
`brain-cloud/docs/connector-architecture.md`.

It lives in this repo (not the npm package — excluded from `package.json` `files`, like
`website/`) so it reuses the **real** recall engine in `../src` directly. One brain, one
engine, two faces.

## Status: Phase 1 — read-only MVP with full OAuth (proven)

`npm test` typechecks and proves the whole path end-to-end **in one server** — the
complete OAuth 2.1 handshake through to real scored recall:

```
① unauthenticated MCP call → 401 + WWW-Authenticate (RFC 9728)
② discovery → AS metadata (RFC 8414), PKCE S256
③ Dynamic Client Registration (RFC 7591)
④ authorize → code (iss + state validated, RFC 9207)
⑤ token → audience-bound Bearer (PKCE verified, RFC 8707)
⑥ MCP initialize + tools/list → [brain_recall, brain_status]  (official SDK)
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

## Tools (Phase 1)

| Tool | Kind | Description |
|------|------|-------------|
| `brain_recall` | read (`readOnlyHint`) | Ranked recall for a query, scored by the brain engine. |
| `brain_status` | read (`readOnlyHint`) | Memory count + last-updated for the user's brain. |

Write tools (`brain_memorize`, `brain_pin`, `brain_forget`) come in Phase 2.

## Auth (integrated)

The full OAuth 2.1 AS now lives in `src/oauth.ts` (authorize / token / register / metadata,
PKCE S256, RFC 8707 audience binding, RFC 9207 `iss`) and mints tokens into `src/auth.ts`'s
store, which the `/mcp` guard validates (incl. audience). Two seams remain, clearly marked in
`src/oauth.ts`:

- **`STUB:FIREBASE`** — `/authorize` auto-approves a fixed user instead of bouncing through
  Firebase login. Real flow: verify Firebase, map uid → brain user.
- **`STUB:STORE`** — `resolveBrainDir(userId)` returns `CONNECTOR_BRAIN_BASE/<userId>/.brain`.
  Phase 2 populates that dir from the user's canonical store (brain-cloud bundle, or BYOS
  git/Drive — see arch doc §11/§12).

## Next

- **Phase 2:** resolve/populate the per-user store (the `STUB:STORE` seam) + write tools
  (`brain_memorize` / `brain_pin` / `brain_forget`) with sync-back.
- **Deploy:** Node host (reuses `scorer.js` + a brain working copy); not Cloudflare Workers
  (no `fs`). Co-locate with brain-cloud per arch doc §3.
