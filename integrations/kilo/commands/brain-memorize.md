---
description: Store durable memories (decisions, insights, learnings, preferences) in the global brain
---

# /brain-memorize — Store Memories

Treat any text the user typed after the command as the content or topic to
memorize. If none was given, extract the most significant decisions,
learnings, insights, or experiences from the current session.

**Default: store immediately, report after.** The user invoked memorize —
do not ask for confirmation. Decide **what** to remember and **how to
classify** it; the `brain memorize` CLI handles all file operations (IDs,
strength/decay computation, directories, index updates, association edges).

## Classify each memory

- **type** (sets base strength/decay): `decision` 0.85 · `insight` 0.90 ·
  `goal` 0.80 · `experience` 0.75 · `learning` 0.70 · `relationship` 0.70 ·
  `preference` 0.60 · `observation` 0.40
- **cognitive_type**: `episodic` (event-specific), `semantic` (abstracted
  knowledge), `procedural` (skills/workflows)
- **path**: life-domain hierarchy under `~/.brain` — `professional/`,
  `personal/`, `social/`, `family/` with kebab-case subdirectories, e.g.
  `professional/projects/foo/api-decision.md`
- **salience** and **confidence** (0.0–1.0), **tags**, optional **related**
  memory IDs and **strength_adjustment** (-0.15 to +0.15)

## Store

Pipe the classified memories to the CLI as JSON on stdin in **one call**
(append `--sync` only when the user asked to push to Brain Cloud/git):

```bash
brain memorize <<'EOF'
{
  "memories": [
    {
      "title": "Short descriptive title",
      "type": "learning",
      "cognitive_type": "semantic",
      "path": "professional/projects/foo/what-i-learned.md",
      "tags": ["foo", "patterns"],
      "salience": 0.6,
      "confidence": 0.9,
      "source": "Session context description",
      "encoding_context": {
        "project": "current-project",
        "topics": ["topic1", "topic2"],
        "task_type": "implementing"
      },
      "content": "# What I Learned\n\nThe main insight was...\n\n## Context\n\nThis came up while...\n"
    }
  ]
}
EOF
```

Then report what was stored: title, ID, path, type, strength, tags, edges
created, and the sync result if `--sync` was used.

## Rules

- **Pinning:** only propose `"pinned": true` (always-injected, decay-exempt)
  for durable conventions/preferences — and only set it with the user's
  agreement.
- **Contradictions:** if the CLI reports `potential_conflicts` with a
  pinned/stable memory, surface the contradiction and let the user decide —
  supersede, keep both scoped, or reject the new one. Never silently keep
  both.
- **Never store secrets, credentials, or trivia.**
- The Brain Memory Kilo plugin sets `BRAIN_AGENT=kilo` automatically; without
  it, prefix invocations with `BRAIN_AGENT=kilo`. If the `brain` command is
  not found, tell the user once: install with `npm install -g brain-memory`.
