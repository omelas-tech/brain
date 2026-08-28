# Server Card (draft, pre-release format)

`server-card.draft.json` is brain's MCP Server Card — static pre-connection metadata so
scanners, catalogs, and enterprise MCP gateways can identify the connector without a
handshake.

## Status of the format (checked 2026-08-25)

- SEP-2127 is an **in-review Extensions Track SEP** (PR open, label `in-review`); the
  wire format lives in
  [experimental-ext-server-card](https://github.com/modelcontextprotocol/experimental-ext-server-card)
  (`schema.json`, `docs/discovery.md`). Explicitly "prototyping and feedback only" —
  breaking changes would ship as a new `vN` schema family.
- **Discovery is NOT `/.well-known/mcp-server-card`** (early-draft location, since
  dropped). Current mechanics:
  - clients fetch the **AI Catalog** at `/.well-known/ai-catalog.json`; a catalog entry
    points at the card (`url`) or inlines it (`data`);
  - servers MAY also serve the card at `GET <streamable-http-url>/server-card`
    (for us: `https://mcp.brainmemory.ai/mcp/server-card`);
  - media type `application/mcp-server-card+json`; support `ETag`/`If-None-Match`.
- The card deliberately carries **no tool/resource listings** (servers are dynamic);
  it is identity + remotes only. It is disjoint from the Registry's `server.json`
  (compatible metadata, not a subset).

## Ship checklist (when the schema graduates or a scanner asks for it)

1. Serve `server-card.draft.json` at `/.well-known/ai-catalog.json` (as an inline
   entry) and at `/mcp/server-card`, with `Content-Type:
   application/mcp-server-card+json` and an `ETag`.
2. Bump `version` in the card together with the connector package version.
3. Re-validate against the current `schema.json` before deploying — the format is
   pre-release.

## Working-group participation (option play)

Memory has no representation in any MCP WG. Cheapest path in: Discord
(`discord.gg/6CSzBmMkjX`) channels `#server-card-wg` / `#agents-wg` /
`#triggers-events-wg`, plus the weekly open calls listed at
`meet.modelcontextprotocol.io` (Server Card WG weekly, Agents WG and Triggers & Events
WG both meet weekly on Thursdays). No application form; sustained participation is the
ladder. Roadmap items brain has a stake in: Server Card (discovery), progressive
discovery (small entry tool surface — ours should be `brain_recall` +
`brain_memorize`, defer the rest), agent identity (DPoP/WIF — prerequisite for a
shared/team tier), server-initiated webhooks/channels (push memory updates instead of
being polled).
