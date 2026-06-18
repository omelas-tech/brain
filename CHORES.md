# Chores & Follow-ups

Running list of non-urgent maintenance tasks and follow-ups. Check items off as
they're done; add new ones at the bottom of the relevant section.

## Claude connector (Brain in Claude apps)

The connector is **live** at `https://mcp.brainmemory.ai/mcp` (read + write — `brain_recall`,
`brain_status`, `brain_memorize`, `brain_pin`, `brain_unpin`). Deployed on the VPS beside
brain-cloud; code in `brain/connector/`, design in `brain-cloud/docs/connector-architecture.md`.
Follow-ups:

- [x] **Phase 2 — write tools** — `brain_memorize` / `brain_pin` / `brain_unpin` with sync-back. LIVE.
- [x] **`brain_forget` tool** — recoverable archive (destructiveHint) via `bin/forget.js`. LIVE.
- [x] **Brand-icon sync** — `brain-cloud/web` + `omelas` already on the new glyph.
- [x] **Update stale `STUB:` header comments** in `connector/src/oauth.ts`. Done.
- [x] **Sync-back freshness** — TTL re-pull implemented. A read/write tool call older than
      `CONNECTOR_REPULL_TTL_MS` (default 120s; 0 disables) re-pulls the brain from brain-cloud, but
      **only downloads when the cloud `checksum` actually changed** (cheap: one list call otherwise),
      and **never over an unsynced local write** (a failed sync-back marks the brain dirty and the
      re-pull is skipped until it syncs) — so a CLI `brain cloud push` shows up mid-session without a
      re-auth, with no risk to in-flight writes. `connector/src/store.ts`; covered by `test/freshness.test.ts`.
- [x] **Identity hygiene** — one-canonical-account rule documented + enforced. `ensureUserBrain`
      surfaces an `identity` signal (`no-cloud-brain` / `multiple-brains` / `ok`); multi-brain accounts
      get the deterministic **oldest** brain; `brain_status` always reports the hint and `brain_recall`
      reports it when empty; the sign-in page tells users to use the account their brain syncs to.
      Documented in `connector/README.md` + `brain-cloud/docs/connector-architecture.md`.
      **Account-linking** (one identity spanning/choosing among several brains) deliberately deferred.
- [ ] **Mobile login robustness** — if the Google popup ever fails inside an in-app webview, add a
      `signInWithRedirect` fallback in the connector sign-in page.
- [ ] **(Optional) prettier URL** — serve MCP at the subdomain root so `https://mcp.brainmemory.ai`
      works (drop the `/mcp` path); needs a resource/audience change + re-add.
- [ ] **Phase 3 — directory submission** — prep mostly done; remaining steps are manual/ops.
      Done: privacy page now covers Brain Cloud + connector (`website/src/app/privacy`); full Terms of
      Service page (`website/src/app/terms`) + consent-page links wired (were `#`); review-criteria
      self-assessment in `brain-cloud/docs/connector-architecture.md` §7; test-account runbook
      (`brain-cloud/docs/connector-test-account.md`); identity hygiene (above).
      Remaining: ⏳ fill the ToS governing-law jurisdiction placeholder · ⏳ create the reviewer test
      account + seed a demo brain (per runbook) · ⏳ MCPB packaging · ⏳ user-facing connector docs /
      launch post · ⏳ submit to the Anthropic connector directory.

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
