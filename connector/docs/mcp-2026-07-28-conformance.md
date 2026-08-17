# MCP 2026-07-28 conformance — verified status

**Verified 2026-08-16.** Reassess when the TypeScript SDK ships protocol support.

The 2026-07-28 specification is **final** (published Jul 28, 2026; RC locked May 21).
Being conformant is the prerequisite for the Google *Gemini Enterprise Agent
Platform* managed-MCP catalog and for passing enterprise MCP discovery/registry
scanners — the third distribution rail alongside the Anthropic surface and the
`SKILL.md` route.

## Headline: we are blocked on the SDK, not on our own code

```
@modelcontextprotocol/sdk@1.29.0 (installed)  LATEST_PROTOCOL_VERSION = 2025-11-25
@modelcontextprotocol/sdk@1.30.0 (latest)     LATEST_PROTOCOL_VERSION = 2025-11-25
```

Neither version defines `cacheScope`, `ttlMs`, `CacheableResult`, or
`server/discover` anywhere in `dist/`. The spec is final; the TS SDK has not
shipped support. **We therefore negotiate 2025-11-25 at best and cannot claim
2026-07-28 conformance.**

Do not hand-roll the 2026-07-28 wire format around the SDK to close this. The
transport rewrite is large, it duplicates work the SDK will ship, and the
failure mode (a subtly wrong stateless core in an OAuth resource server) is
worse than being one spec behind.

## What the spec actually requires, item by item

| Requirement | Status | Note |
|---|---|---|
| Stateless core — no `Mcp-Session-Id` | ✅ **met** | `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`; non-POST `/mcp` answered `405 + Allow: POST` |
| Runs behind a round-robin LB, no sticky sessions | ✅ **met** | No session store; every request re-authenticates from its Bearer token |
| `initialize`/`initialized` retired → `server/discover` | ❌ **blocked** | Not in SDK. We still serve the old handshake |
| Per-request `_meta` carries protocol version, client identity, capabilities | ❌ **blocked** | Not in SDK |
| `MCP-Protocol-Version: 2026-07-28` request header | ❌ **blocked** | SDK rejects unknown versions during negotiation |
| `ttlMs` + `cacheScope` on `tools/list` (SEP-2549) | ❌ **blocked** | Not in SDK types; `ListToolsResultSchema` is where they belong |
| `cacheScope` on `tools/call` memory results | ⚠️ **n/a by spec** | See below |

### The `cacheScope` correction

An earlier note in `src/result.ts` claimed the `_meta` cache marker was
"forward-compatible with the final spec". Checked against SEP-2549, that is not
right, in two ways:

1. **Placement** — `cacheScope`/`ttlMs` are *top-level fields* on
   `CacheableResult`, not `_meta` entries.
2. **Message type** — they apply to `tools/list`, `prompts/list`,
   `resources/list`, `resources/read`, and `resources/templates/list`.
   **`tools/call` is not a cacheable result**, so a memory response has no spec
   `cacheScope` to set.

The `_meta` marker in `memoryResult()` **stays** — it is real defense-in-depth
against an intermediary that caches tool output heuristically, and memory
content must never be shared across users. It is just not a conformance claim.

The genuine obligation we are missing is on `tools/list`. Our tool list is
identical for every user and contains no user data, so once the SDK supports it
the correct values are `cacheScope: "public"` with a modest `ttlMs` — which is
also the thing that lets clients stop re-listing tools on every call.

## Unblock checklist

When the SDK ships 2026-07-28:

1. Bump `@modelcontextprotocol/sdk`; confirm `LATEST_PROTOCOL_VERSION` is `2026-07-28`.
2. Add `ttlMs` + `cacheScope: "public"` to the `tools/list` result.
3. Implement `server/discover`; keep the `initialize` path until clients migrate.
4. Accept and echo `MCP-Protocol-Version`; keep negotiating older versions.
5. Read protocol version / client identity / capabilities from per-request `_meta`.
6. Extend `test/conformance.test.ts` with a 2026-07-28 client handshake.
7. Re-read `src/result.ts` — the `_meta` hint stays, but re-check the comment.

## Already met, independent of the SDK

These are the enterprise-scanner requirements, and they are done:

- **OAuth 2.1 resource server** — RFC 9728 protected-resource metadata, RFC 8414
  AS metadata, RFC 7591 dynamic client registration, PKCE S256, RFC 8707
  resource/audience binding, RFC 9207 `iss`, single-use codes, Bearer on every
  request, refresh-token rotation with reuse detection.
- **Scoped authorization** — `brain.read` / `brain.write`; write tools refuse a
  read-only token with an explicit error rather than a silent success.
- **Rate limiting** — per-IP, tightest on the open DCR endpoint.
- **Fail-closed identity** — no identity provider ⇒ no token, ever.

## Data-handling facts (for any catalog or scanner submission)

State these accurately; they are checked, and getting them wrong is worse than
saying nothing:

- Memory is **encrypted at rest with server-held keys** (envelope encryption: a
  per-user DEK, KMS-wrapped, EU key location). It is **not** end-to-end and
  **not** zero-knowledge — the server can read user data. Never describe the
  cloud as E2E.
- The *plugin's* git/export sync **is** genuinely end-to-end (passphrase-based);
  that claim is fine and applies only to that path.
- Plaintext working copies on the connector host are reaped on idle and at
  session end.
