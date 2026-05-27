# /brain:skill — Manage Procedural Skills

You are managing **procedural memory** — reusable "how to do things" stored as `~/.brain/_skills/<name>/SKILL.md`. Skills use **progressive disclosure** so they never bloat the context window:

- **L0 (session start):** only each skill's name + description is advertised (≈100 tokens each).
- **L1 (on a matching task):** read the full `SKILL.md` for step-by-step instructions.
- **L2 (at execution):** load any referenced `resources/` (templates, scripts) only when a step needs them.

**User input:** $ARGUMENTS

## Actions

**List** advertised skills:
```bash
brain skill list
```

**Show** a skill's full instructions (do this when a task matches a skill's description/triggers):
```bash
brain skill show <name>
```

**Add** a skill — pipe JSON on stdin:
```bash
brain skill add <<'EOF'
{
  "name": "structured-code-review",
  "description": "One-paragraph advertised summary used for matching (~100 tokens).",
  "triggers": ["code review", "review PR", "audit changes"],
  "body": "## Steps\n1. ...\n2. ..."
}
EOF
```

**Use** — record an outcome after running a skill. Success strengthens it; `--failed` weakens it (a skill that fails too often demotes itself out of the advertised L0 index):
```bash
brain skill use <name>            # succeeded
brain skill use <name> --failed   # produced a bad outcome
```

**Remove** a skill:
```bash
brain skill remove <name>
```

**Export** a skill into the host agent's native format so it becomes directly executable (writes `.claude/skills/<name>/SKILL.md` or `.gemini/...` in the current project):
```bash
brain skill export <name> [--target claude|gemini]
```

## Guidance

- Advertise skills with a **crisp, matchable description** — that single line is all the agent sees at L0, so it must convey when to reach for the skill.
- Reach for `show` only when a task genuinely matches; don't pre-load skills speculatively.
- Always record the outcome with `use` (success or `--failed`) so the strength/demotion feedback loop stays accurate.
