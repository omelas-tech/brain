# Brain Memory — Session End Hook

> **Note:** This file is a reference definition. The actual behavior is delivered through the prompt files (`prompts/claude.md`, `prompts/gemini.md`, `prompts/openai.md`) which are injected into each runtime's config file during installation. AI runtimes do not have native session-end hook events — the agent follows these instructions because they are embedded in the prompt it reads at session start.

This hook is triggered at the end of a coding session. Its purpose is to prompt the agent to consider storing important memories and to save session context.

## Behavior

When a session is ending (user signals they are done, says bye/thanks, or the conversation appears to be wrapping up), perform these steps **in order**:

### Step 1: Save Session Context (ALWAYS — do this first)

**Immediately** append a session summary to `.brain/contexts.json`. Do this for ALL sessions, even trivial ones — context tracking is cheap and provides valuable recall signals for future sessions.

```json
{
  "session_id": "<timestamp-based-id>",
  "started": "<session start ISO timestamp>",
  "ended": "<session end ISO timestamp>",
  "project": "<current project name>",
  "topics": ["<key topics discussed>"],
  "task_type": "<primary task type: debugging|implementing|designing|reviewing|discussing|learning>",
  "memories_created": ["<IDs of memories stored this session>"],
  "memories_recalled": ["<IDs of memories retrieved this session>"],
  "notable_unsaved": ["<brief descriptions of notable items NOT yet memorized>"]
}
```

Keep only the last 100 session entries in `contexts.json` to prevent unbounded growth. The `notable_unsaved` field preserves what happened even if the user didn't memorize — future sessions can reference it.

**Do not wait for explicit session-end signals** — if the conversation appears to be wrapping up, save context proactively.

### Step 2: Suggest Memorization (if warranted)

Review the ambient tracking log (maintained throughout the session) for notable:

1. **Decisions** — Architecture choices, technology selections, trade-off resolutions
2. **Learnings** — New patterns, debugging insights, API discoveries
3. **Insights** — Realizations about the codebase, project, or process
4. **Experiences** — Significant events like incidents, deployments, milestones
5. **Goals** — New objectives discussed or planned

If the session contained meaningful content in any of these categories, suggest to the user:

```
💡 This session contained notable <type(s)>. Would you like to store them as brain memories?
   Run /brain:memorize to capture them before this context is lost.
```

**Rules:**
- Do NOT auto-memorize without user consent
- Do NOT prompt for trivial sessions (quick fixes, typo corrections, simple questions)
- Only suggest when there is genuinely valuable context worth preserving
- Keep the suggestion brief and non-intrusive
