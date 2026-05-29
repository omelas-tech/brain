---
description: Spaced-repetition review session for memories due for reinforcement
argument-hint: "[scope]"
---

# /brain:review — Spaced Repetition Review

You are conducting a spaced repetition review session. This command surfaces memories that are due for review based on optimal spacing intervals, measures recall quality, and schedules the next review. Regular review sessions dramatically improve long-term retention.

**Scope:** $ARGUMENTS

## Overview

This implements a simplified SM-2 (SuperMemo 2) spaced repetition algorithm. Memories are scheduled for review at increasing intervals based on how well they are recalled. Well-recalled memories are reviewed less frequently; poorly-recalled memories are reviewed more often.

## Steps

### 1. Load Review Queue

Read `~/.brain/review-queue.json`. If it doesn't exist or is empty, generate it:
- Scan all memories in `index.json`
- For memories with `access_count > 0`, calculate initial review schedule
- For memories never recalled, add with `next_review` = now (immediate first review)
- If $ARGUMENTS specifies a category path, limit to that subtree

### 2. Find Due Memories

Filter the review queue for items where `next_review <= now`.

If no memories are due:
```
## No Memories Due for Review

Next review due: <soonest date>
Total in queue: <count>

Run /brain:status for a full overview.
```

### 3. Present Review Session

For each due memory (process up to 10 per session):

1. **Present the memory's title and path** (but NOT the full content initially):
   ```
   ### Review 1 of <N>

   **Memory:** <title>
   **Path:** ~/.brain/<path>
   **Type:** <type> (<cognitive_type>) | **Last reviewed:** <date> | **Interval:** <days>d
   **Confidence:** <confidence>

   Can you recall what this memory is about? Try to remember before seeing the content.
   ```

2. **Reveal the full content** after the user responds (or on request):
   ```
   <full memory content>
   ```

3. **Ask for recall quality** (1-5 scale):
   - **5 — Perfect**: Recalled immediately and completely
   - **4 — Good**: Recalled with minor effort
   - **3 — Okay**: Recalled with significant effort
   - **2 — Poor**: Could barely recall, needed heavy hints
   - **1 — Failed**: Could not recall at all

### 4. Update Based on Recall Quality

For each reviewed memory, update using the SM-2 algorithm:

**Ease factor adjustment:**
```
new_ease = ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
ease_factor = max(1.3, new_ease)
```

**Interval calculation:**
```
if quality >= 3:  // Successful recall
  if review_count == 0: interval = 1
  elif review_count == 1: interval = 6
  else: interval = previous_interval * ease_factor
else:  // Failed recall
  interval = 1  // Reset to 1 day
  review_count = 0  // Reset review count
```

**Update memory:**
- `last_accessed` → current timestamp
- `access_count` → increment by 1
- `recall_history` → append current timestamp
- Apply spaced reinforcement to `strength` (same formula as /brain:remember)
- Improve `decay_rate` on successful recall (quality >= 3)

**Update review queue entry:**
```json
{
  "memory_id": "<id>",
  "next_review": "<now + interval days>",
  "interval_days": <interval>,
  "ease_factor": <ease_factor>,
  "review_count": <review_count + 1>
}
```

### 5. Session Summary

After reviewing all due memories:

```
## Review Session Complete

Reviewed: <N> memories
  Perfect (5): <count>
  Good (4):    <count>
  Okay (3):    <count>
  Poor (2):    <count>
  Failed (1):  <count>

Average recall quality: <avg>
Next review due: <soonest date>
Remaining in queue: <count>

Memories strengthened through review — keep it up!
```

## Rules

1. **Never skip the recall attempt** — always present the title first and let the user try to recall before revealing content
2. **Be encouraging** — spaced repetition is about building long-term retention, not testing
3. **Update everything** — update the memory file, index.json, review-queue.json, and associations.json (reinforce edges between co-reviewed memories)
4. **Respect scope** — if $ARGUMENTS specifies a category, only review memories in that subtree
5. **Session limit** — review at most 10 memories per session to avoid fatigue
6. **Failed recalls** — for quality 1-2, suggest the user re-read the memory and offer to update it if the information is outdated
