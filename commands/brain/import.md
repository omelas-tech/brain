---
description: Cold-start your brain from transcripts your agents already wrote
argument-hint: "[--project P] [--since 30d] [--limit N]"
---

# /brain:import — Cold-Start From Past Sessions

A new brain is empty. But your agents have been keeping transcripts for months — decisions, preferences, corrections, conventions. This command reads those transcripts and turns them into real memories.

**User input:** $ARGUMENTS

**Flags** (passed straight through to the CLI):
- `--source <id>` — Which history store to read (default `claude-code`; `--sources` lists what's detected)
- `--project <name>` — Only sessions from one project
- `--since <30d|6m|2026-01-01>` — Only sessions since then
- `--limit <N>` — Max sessions to consider (default 40)
- `--all` — Re-offer sessions already imported

## Your role

The CLI harvests. **You distill.** It hands you a digest of past sessions — titles, prompts, projects, files touched, dates. It does not decide what matters. That is the entire job here, and it is a judgement call the CLI deliberately does not make.

## Steps

### 1. Harvest

```bash
brain import $ARGUMENTS
```

Returns `{ source, scanned, budget, sessions[] }`. Each session has `session_id`, `title`, `project`, `git_branch`, `started`/`ended`, `turns`, `files_touched`, and a sample of `prompts`.

Read `scanned` honestly when you report — the fields mean different things:
- `skipped` — sessions that held nothing readable (too few real prompts)
- `filtered` — sessions excluded by the user's own `--project`/`--since` scoping, **not** discarded as junk
- `already_imported` — sessions a previous run already covered
- `remaining` — candidates that did not fit this pass; the number to quote when suggesting a re-run

If `scanned.files` is 0, tell the user no history was found and stop.

### 2. Check what the brain already knows

**Do not skip this on a brain that is already populated.** Import is most often run cold, but it is also run against a brain with hundreds of memories, and there the dominant failure is duplication — re-writing facts that are already stored, which inflates the brain and splits recall across near-identical entries.

Before distilling, recall against the themes you can see in the digest:

```bash
brain recall "<theme from the digest>" --project <project> --top 4
```

If a theme already scores well against an existing memory, drop it. Only write what is genuinely absent, or what materially *updates* something already stored — and if it's an update, say so in the content rather than filing a near-duplicate.

### 3. Read for durable facts, not events

You are looking at what someone *did*, and trying to recover what is still *true*. Those are different things.

**Worth remembering** — things that outlive the session:
- Stated preferences and conventions ("always use X", "I hate Y", "we commit straight to main")
- Architecture and tooling decisions, with the rationale if it's visible
- Recurring corrections — if the user pushed back on the same thing three times, that is a preference
- The shape of each project: what it is, its stack, where it deploys
- Constraints, deadlines, ongoing goals

**Not worth remembering** — things that were only true that afternoon:
- "fix the failing test", "what does this function do", "run the build"
- Anything already recorded in the repo, git history, or a CLAUDE.md
- One-off debugging that ended when the bug was fixed
- Anything superseded by later work in the digest

A good import from 40 sessions is roughly **5–20 memories**, not 40. One memory per session means you transcribed instead of distilled.

### 4. Prefer synthesis across sessions

The digest's real value is the pattern across sessions, which no single session contains. Six sessions in the same repo tell you what that project *is* — that is one strong `semantic` memory, worth more than six thin episodic ones.

Merge aggressively. Write the memory the user would want to find in six months.

### 5. Classify and write

Use the classification rules in `/brain:memorize` — same types, same cognitive types, same hierarchy under `professional/` etc.

Two rules specific to import:

**`origin` is `agent-inferred`.** You are inferring durable facts from a transcript, not being told them. Do not use `user` — the CLI's provenance gate will reject any attempt to pin or entrench from this path, which is the intended behavior. If a fact deserves entrenchment, the user can `/brain:pin` it deliberately afterwards.

**Confidence should reflect the evidence.** A convention stated once in passing is not a convention you are sure about. Something the user repeated across four sessions is. Set `confidence` accordingly rather than defaulting everything to 0.7.

Set `encoding_context.project` to the digest's `project` field, and `source` to `"import:<source>:<session_id>"` so the memory traces back to the transcript it came from.

Then write them:

```bash
brain memorize <<'EOF'
{ "memories": [ ... ] }
EOF
```

### 6. Mark what you used

```bash
brain import --mark <session_id> <session_id> ...
```

Mark **every session you read**, including the ones you decided held nothing worth keeping — otherwise the next run offers them again and you re-litigate the same judgement. This cursor is what makes import incremental.

Use the **full** `session_id` from the digest, never a shortened form you printed for display. The CLI rejects ids that match no real session and exits non-zero; check the `unknown` array if it does.

### 7. Report

```
◉ Imported <N> memories from <M> sessions across <P> projects

  <type>  <title>
  ...

<scanned.remaining> sessions remain — re-run to continue.
```

Quote `scanned.remaining` for the re-run line, and mention `scanned.filtered` only if the user passed a scoping flag.

## Notes

- **Safe to re-run.** The cursor means a second run offers only new sessions. `--all` overrides it.
- **Start scoped if the history is large.** `--project <name>` or `--since 30d` gives a better first pass than trying to swallow a year at once.
- **Nothing is written without you.** `brain import` only ever reads and prints; every memory goes through `brain memorize` and its provenance gate.
