# /brain:memorize — Store a New Memory

You are storing memories in the Brain Memory system. Your job is to decide **what** to remember and **how to classify** it. The `brain memorize` CLI handles all file operations.

**User input:** $ARGUMENTS

**Flags:**
- `--sync` — Auto-push to cloud/git after storing
- `--confirm` — Ask for confirmation before writing (off by default)

## Behavior

**Default: store immediately, show results after.** The user said "memorize" — they want it stored. Do NOT ask "Store these memories?" unless `--confirm` is passed, or $ARGUMENTS is empty AND you're genuinely uncertain which session content to extract.

## Steps

### 1. Determine Content

If $ARGUMENTS has specific content, use it. If empty, extract the most significant learnings, decisions, insights, or experiences from the current session.

### 2. Classify Each Memory

For each memory, determine:

**Type** (sets base strength/decay — the CLI computes final values):
- `decision` (0.85/0.995) — Choices made and rationale
- `insight` (0.90/0.997) — Deep realizations, patterns
- `goal` (0.80/0.993) — Objectives and aspirations
- `experience` (0.75/0.985) — Notable events or processes
- `learning` (0.70/0.990) — New knowledge acquired
- `relationship` (0.70/0.997) — Connections between entities
- `preference` (0.60/0.998) — User preferences and style
- `observation` (0.40/0.950) — Casual facts or notices

**Cognitive type:** `episodic` (event-specific), `semantic` (abstracted knowledge), `procedural` (skills/workflows)

**Path:** Where in `~/.brain/` hierarchy: `professional/`, `personal/`, `social/`, `family/` with kebab-case subdirectories as deep as semantically justified. File name = short slug + `.md`.

**Salience** (0.0-1.0), **confidence** (0.0-1.0), **tags**, **related** memory IDs.

**strength_adjustment** (optional, -0.15 to +0.15): Tweak base strength based on significance.

**Pinned & stable** (optional, CoALA Phase 1):
- `pinned: true` — always inject this memory at session start regardless of recall score (and decay-exempt). Optionally `pin_scope: "project:<name>"` (default `"global"`) and `pin_priority: <N>`.
- `stable: true` — exempt from decay (never fades) without forcing it to always load — for timeless facts recalled on demand.
- **Propose, don't assume:** when a memory is a durable convention/preference/standing decision (type ∈ {preference, decision, insight, relationship}, high confidence, low time-sensitivity), *suggest* pinning it — but only set `pinned` if the user agrees (or pin later with `/brain:pin`).

### 3. Call brain memorize

Pipe the classified memories as JSON to the CLI in a **single bash call**:

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
      "strength_adjustment": 0.05,
      "related": [],
      "source": "Session context description",
      "encoding_context": {
        "project": "current-project",
        "topics": ["topic1", "topic2"],
        "task_type": "implementing"
      },
      "content": "# What I Learned\n\nThe main insight was...\n\n## Context\n\nThis came up while...\n\n## Key Details\n\n- Detail one\n- Detail two\n\n## Connections\n\nRelates to previous work on..."
    }
  ]
}
EOF
```

Add `--sync` flag if the user requested it or passed `--sync` to the command:
```bash
brain memorize --sync <<'EOF'
...
EOF
```

The CLI handles: ID generation, strength/decay computation, directory creation, file writing, index.json updates, association edges (explicit + tag overlaps), search index updates, and optional sync push.

### 4. Report Results

The CLI outputs JSON with what was stored. Present the results to the user:
- Memory title, ID, and path
- Type, strength, tags
- Edges created
- Sync result (if applicable)

### 5. Resolve contradictions (Tier B §10.2)

If a stored memory's result includes `potential_conflicts`, it shares heavy tag overlap with a **pinned or stable** memory — and pinned/stable facts never decay out of contention, so a stale one is dangerous. **Do not silently keep both.** Inspect the conflicting memory (`brain recall` or read its file) and, if the new memory genuinely contradicts it, propose a resolution to the user:
- **Supersede** — unpin/forget the old fact, keep the new one (record the supersession).
- **Keep both, scoped** — e.g. pin each to its own project.
- **Reject the new one** — the old fact stands.

Never auto-resolve; surface the conflict and let the user decide.
