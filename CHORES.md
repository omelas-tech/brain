# Chores & Follow-ups

Running list of non-urgent maintenance tasks and follow-ups. Check items off as
they're done; add new ones at the bottom of the relevant section.

## SEO & discovery submissions

Follow-ups after the SEO / LLM-search optimization of `brainmemory.work`
(sitemap, robots, JSON-LD, llms.txt, OG image — all live as of 2026-06-01).

### Search engines (technical)
- [ ] **Google Search Console** — submit `https://brainmemory.work/sitemap.xml`; Request Indexing for `/`, `/docs`, `/docs/getting-started/installation`.
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
- [ ] **dev.to / Hashnode / Medium** — cross-post an architecture/launch article with `canonical` → brainmemory.work.

### Package registry
- [ ] Ensure the npm `package.json` `homepage` field points to `https://brainmemory.work` (authoritative backlink).

### Validation (after submitting)
- [ ] Google Rich Results Test on `/` (FAQ) and a docs page (TechArticle + Breadcrumb) — zero errors.
- [ ] Preview the share card (opengraph.xyz or a draft post on X/Slack/LinkedIn).

### Out of scope for the initial SEO pass (revisit later)
- [ ] `aggregateRating` / review schema — only once genuine ratings exist (never fabricate).
- [ ] Per-doc hand-tuned OG images (the one branded default is sufficient for now).
