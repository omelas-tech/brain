# brain-cloud plugin

The hosted Brain Memory MCP connector packaged as a plugin, for hosts that have no
local `~/.brain` (Claude.ai, ChatGPT desktop, mobile, or a Codex/Claude Code install
that prefers the cloud brain). It declares one remote MCP server —
`https://mcp.brainmemory.ai/mcp` — and nothing else; sign-in is the connector's own
OAuth 2.1 flow (Google), so importing this plugin never grants access by itself.

Tools: `brain_recall`, `brain_status`, `brain_memorize`, `brain_verify`, `brain_pin`,
`brain_unpin`, `brain_forget`, plus the Memory Inspector resource. Same memories as the
local `brain` plugin when synced (`/brain:sync`). Source and deploy notes for the
connector itself live in `../../connector/`.

Note for ChatGPT workspace admins: plugins that declare MCP servers are marked
*Desktop only* and work in the ChatGPT desktop app.
