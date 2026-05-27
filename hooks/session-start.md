# Brain Memory — Session Start Hook

> **Note:** This file is a reference definition. The actual behavior is delivered through the prompt files (`prompts/claude.md`, `prompts/gemini.md`, `prompts/openai.md`) which are injected into each runtime's config file during installation. AI runtimes do not have native session-start hook events — the agent follows these instructions because they are embedded in the prompt it reads at session start.

This hook is triggered at the start of a coding session. Its purpose is to load relevant context from the brain memory system and capture session context for context-dependent recall.

## Behavior

At session start, if `.brain/index.json` exists, call the budget-bounded aggregator:

```bash
brain session-start --project "<current project>"
```

It returns one JSON payload — `memory_count`, `pinned`, `skills_index`, `context_recall`, `due_for_review`, `low_confidence_alerts`, `budget` — capped to the working-memory token budget in `config.json`. Then:

1. **Silently internalize** the payload — apply `pinned` facts as active constraints, note available `skills_index` skills, keep `context_recall` in mind
2. **Do NOT dump memories** — do not print contents at session start unless the user asks

### Context Capture

Capture the current session context for context-dependent recall:
- **Project name**: from the current working directory or project config
- **Topics**: inferred from recent files, open issues, or conversation
- **Task type**: will be determined as the session progresses

This context is used by `/brain:remember` to boost memories that were encoded in a similar context.

### Review Queue Check

Read `.brain/review-queue.json` if it exists. If there are memories due for review:

```
🧠 Brain active — <N> memories loaded (<M> in current project context)
📋 <X> memories due for review — run /brain:review
```

Otherwise:

```
🧠 Brain active — <N> memories loaded (<M> in current project context)
```

### Low-Confidence Alert

If any frequently-used memories (access_count >= 3) have confidence < 0.5, briefly note:

```
⚠️ <N> frequently-used memories have low confidence — consider verifying
```

**The goal is ambient awareness** — you should know about important past decisions, learnings, and preferences without explicitly reciting them. If a situation arises where a past memory is relevant, naturally reference it.

Keep the status output to 1-3 lines. The user can run `/brain:status` for details.

### Begin Ambient Session Tracking

After outputting the status, begin maintaining a running mental log of notable events (decisions, learnings, insights, experiences, goals) as they happen throughout the session. This is purely internal — no file writes needed. The ambient log feeds the Periodic Memory Checkpoint and Session End context save.
