# Chores & Follow-ups

Running list of non-urgent maintenance tasks and follow-ups. Check items off as
they're done; add new ones at the bottom of the relevant section.

## Claude connector (Brain in Claude apps)

The connector is **live** at `https://mcp.brainmemory.ai/mcp` (read + write — `brain_recall`,
`brain_status`, `brain_memorize`, `brain_pin`, `brain_unpin`). Deployed on the VPS beside
brain-cloud; code in `brain/connector/`, design in `brain-cloud/docs/connector-architecture.md`.
Follow-ups:

- [x] **Phase 2 — write tools** — `brain_memorize` / `brain_pin` / `brain_unpin` with sync-back. LIVE.
- [ ] **`brain_forget` tool** — expose delete/archive (destructiveHint) from the apps.
- [ ] **Sync-back hardening / auto-refresh** — writes sync via the ~1 h Firebase token; a write after
      expiry persists locally but the login re-pull could overwrite it. Add push-before-pull (or a
      dirty flag) + a TTL re-pull so local `brain cloud push`es also appear without re-auth.
- [ ] **Update stale `STUB:` header comments** in `connector/src/oauth.ts` — Firebase login and
      the per-user store are both wired now; the top comment still describes them as stubs.
- [ ] **Identity hygiene** — document/enforce the one-canonical-account rule (the connector serves
      the brain of whichever Google account signs in). Consider account-linking later.
- [ ] **Mobile login robustness** — if the Google popup ever fails inside an in-app webview, add a
      `signInWithRedirect` fallback in the connector sign-in page.
- [ ] **(Optional) prettier URL** — serve MCP at the subdomain root so `https://mcp.brainmemory.ai`
      works (drop the `/mcp` path); needs a resource/audience change + re-add.
- [ ] **Phase 3 — directory submission** — privacy page, public test account, review-criteria pass,
      then submit to the Anthropic connector directory.

## SEO & discovery submissions

Follow-ups after the SEO / LLM-search optimization of `brainmemory.ai`
(sitemap, robots, JSON-LD, llms.txt, OG image — all live as of 2026-06-01).

### Search engines (technical)
- [ ] **Google Search Console** — submit `https://brainmemory.ai/sitemap.xml`; Request Indexing for `/`, `/docs`, `/docs/getting-started/installation`.
- [ ] **Bing Webmaster Tools** — import from GSC, submit the same sitemap. (Feeds Bing, DuckDuckGo, Yahoo, Ecosia.) Add the Bing verification `<meta>` tag to `website/src/app/layout.tsx` (`metadata.verification`) or verify via Cloudflare DNS.
- [ ] **IndexNow** — enable Cloudflare's native IndexNow integration for the zone (dashboard, one toggle). Instant re-crawl pings to Bing + Yandex.
- [ ] (Optional) **Yandex Webmaster** — only if RU/global coverage matters.

### AI / LLM visibility
- [ ] No submission form exists for ChatGPT/Claude/Perplexity. `llms.txt` + open AI-crawler `robots.txt` are already live (passive). The active lever is high-authority backlinks (see Communities below).
- [ ] After any docs change, confirm `llms.txt` / `llms-full.txt` regenerate (they build via `scripts/build-llms.mjs`).

### Developer directories & communities (highest ROI)
- [ ] **Product Hunt** — launch listing.
- [ ] **Hacker News** — "Show HN: Brain Memory — neuroscience-inspired memory for AI coding agents."
- [ ] **GitHub repo topics** — add `claude-code`, `ai-agents`, `mcp`, `memory`, `llm`, `context-engineering`.
- [ ] **Awesome-lists PRs** — `awesome-claude-code`, `awesome-ai-agents`, `awesome-mcp`, `awesome-llm-tools`.
- [ ] **Claude Code plugin / agent-tool / MCP directories** — list the plugin.
- [ ] **Reddit** — r/ClaudeAI, r/LocalLLaMA, r/ChatGPTCoding (respect each sub's self-promo rules).
- [ ] **dev.to / Hashnode / Medium** — cross-post an architecture/launch article with `canonical` → brainmemory.ai.

### Package registry
- [ ] Ensure the npm `package.json` `homepage` field points to `https://brainmemory.ai` (authoritative backlink).

### Validation (after submitting)
- [ ] Google Rich Results Test on `/` (FAQ) and a docs page (TechArticle + Breadcrumb) — zero errors.
- [ ] Preview the share card (opengraph.xyz or a draft post on X/Slack/LinkedIn).

### Out of scope for the initial SEO pass (revisit later)
- [ ] `aggregateRating` / review schema — only once genuine ratings exist (never fabricate).
- [ ] Per-doc hand-tuned OG images (the one branded default is sufficient for now).
