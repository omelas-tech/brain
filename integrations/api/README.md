# Brain for Messages API apps

Coding agents get brain through hooks. An app that calls the Claude Messages API directly has no
hooks, so without help the model only sees memory when it decides to call a tool.
`withBrainTurn()` removes that decision. Before each request it runs `brain recall` on the new user
message and appends the matches as a **turn-scoped system message**:

```js
import { brainTurnHeaders, withBrainTurn } from "./brain-turn.mjs";

const { messages } = withBrainTurn(history, userText, { session: conversationId });
await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: brainTurnHeaders(process.env.ANTHROPIC_API_KEY),
  body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 1024, messages }),
});
```

- **One turn only.** The block carries `clear_at: "next_user_message"` (beta
  `mid-conversation-system-clear-at-2026-08-21`). Once the next user message arrives, the block
  stops rendering and costs nothing, so recalled memory never piles up in the context.
- **Bounded.** `budgetTokens` (default 600) caps the block; the weakest matches are dropped first.
- **Safe by default.** Memories pending verification never appear, and the block tells the model
  that a remembered permission is not consent.
- **Attributed.** Each memory arrives with its receipt line. The `session` id reaches brain's
  citation ledger.
- **Fails soft.** If the `brain` CLI is missing or errors, the request goes out without memory.

Supported models: those that accept `clear_at`, e.g. Opus 5.5, Sonnet 5.5, Haiku 5.5 (not Sonnet 5).
See the [docs](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages).

Try it: `ANTHROPIC_API_KEY=… node integrations/api/example.mjs "what did we decide about X?"`
