---
description: Pin or unpin a memory in the always-present tier
argument-hint: "[id|query] [--off]"
---

# /brain:pin — Pin or Unpin a Memory (Always-Present Tier)

You are managing the **always-present semantic tier**. Pinned memories are injected at every
session start regardless of recall score, and are decay-exempt — they never fade. This command
is a **toggle**: it pins by default, and unpins when asked.

**User input:** $ARGUMENTS

## Determine direction

- **Unpin** if the input contains `--off`, `unpin`, `remove`, or names a memory that is already
  pinned (present in `~/.brain/pinned.json`).
- **Pin** otherwise.

When ambiguous (e.g. a bare query that matches a pinned memory), state which direction you're
taking and confirm before acting.

---

## Pin

1. **Resolve the target memory:**
   - If `$ARGUMENTS` is a memory ID (`mem_...`), use it directly.
   - Otherwise run `brain recall "$ARGUMENTS" --top 5`, show the top matches, and confirm which
     one to pin.

2. **Choose a scope** (default `global`):
   - `global` — loads in every project.
   - `project:<name>` — loads only while working in that project. Use for project-specific
     conventions.

3. **Pin it:**
   ```bash
   brain pin <id> [--scope global|project:<name>] [--priority N]
   ```
   `--priority` (default 0) breaks ties when the pin budget
   (`~/.brain/config.json` → `pin_budget_tokens`) is tight; higher wins.

4. Confirm:
   ```
   📌 Pinned <title> (<scope>) — will load every session.
   ```

### When to pin

Durable conventions, preferences, and standing decisions the agent must **always** honor — e.g.
"always use tabs", "deploy via Cloudflare", "never touch the legacy billing module". Good
candidates are `preference`, `decision`, `insight`, and `relationship` memories with high
confidence and low time-sensitivity.

**Do not pin** episodic or time-sensitive content (a one-off incident, a temporary workaround).
Those belong in normal recall, where decay can retire them.

---

## Unpin

The memory will no longer load automatically at session start and returns to normal recall +
decay (an independent `stable` flag, if set, is left untouched).

1. **Resolve the target:**
   - If `$ARGUMENTS` is a memory ID (`mem_...`), use it directly.
   - Otherwise inspect `~/.brain/pinned.json` (the list of current pins) or run
     `brain recall "$ARGUMENTS" --top 5`, and confirm which pin to remove.

2. **Unpin it:**
   ```bash
   brain unpin <id>
   ```

3. Confirm:
   ```
   📌 Unpinned <title> — no longer auto-loaded.
   ```
