---
description: Manage procedural skills (list, show, add, use, remove, export)
argument-hint: "[subcommand]"
---

# /brain:skills — Manage Procedural Skills

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

### Verifying a skill (`brain skill verify <name>`)

A skill is a claim about how a repo works, and repos move. `brain skill verify <name>` checks the skill's declared preconditions against the current directory and answers whether the claim still holds — **without running the agent**:

```bash
brain skill verify pg-migration
# → { "status": "passed", "passed": 2, "total": 2 }
```

Skills declare preconditions as a `verify` array when they are added:

```json
{ "name": "pg-migration", "description": "...", "body": "...",
  "verify": [
    { "file_exists": "migrations/" },
    { "file_contains": { "path": "package.json", "text": "\"migrate\"" } },
    { "command_available": "psql" }
  ] }
```

Available checks: `file_exists`, `file_absent`, `file_contains`, `command_available`, `env_set`.

**Checks are declarative and read-only — nothing is ever executed.** Skills are crystallized automatically, they sync between machines, and they can be imported from other people; a `verify` field holding arbitrary shell would be a memory file that runs code, which is the OWASP ASI06 scenario with the hard part removed. There is deliberately no escape hatch. Paths that escape the working directory fail the check.

Outcomes:
- `passed` — preconditions hold. Strength is **not** raised: applicability is not the same as a good outcome, and a cheap automatic check should not let a skill climb the index.
- `failed` — demotes exactly like a failed use (`-0.10`), because a skill describing a layout that no longer exists will confidently misdirect the next matching session.
- `unverifiable` — no `verify` block. Most skills are prose; this is normal and changes nothing.
