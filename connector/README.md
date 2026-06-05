# brain-connector

The **Brain Memory Claude connector** — a remote MCP server that exposes the brain's
scored recall to Claude (web / desktop / **iOS** / Cowork). Built with the official
[`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol) per Anthropic's
`build-mcp-server` guidance. Design rationale lives in
`brain-cloud/docs/connector-architecture.md`.

It lives in this repo (not the npm package — excluded from `package.json` `files`, like
`website/`) so it reuses the **real** recall engine in `../src` directly. One brain, one
engine, two faces.

## Status: Phase 1 — read-only MVP (proven)

`npm test` proves the full path end-to-end:

```
① unauthenticated MCP call → 401 + WWW-Authenticate (RFC 9728)
② MCP initialize over the official SDK (client ↔ server)
③ tools/list → [brain_recall, brain_status]
④ brain_status → real memory_count from the user's brain
⑤ brain_recall(query) → the brain's REAL scored results (relevance + decayed
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

## What's stubbed (next steps)

- **OAuth issuance.** `src/auth.ts` is the resource-server *guard* + session model + RFC 9728
  metadata; `issueToken` is the seam where the proven OAuth AS from
  `brain-cloud/connector-spike` (authorize / token / register / PKCE / DCR) lands.
- **Per-user store.** `session.brainDir` is set directly today; Phase 2 resolves it from the
  user's canonical store (brain-cloud bundle, or BYOS git/Drive — see arch doc §11/§12).
- **Deploy.** Node host (reuses `scorer.js` + a brain working copy); not Cloudflare Workers
  (no `fs`). Co-locate with brain-cloud per arch doc §3.
