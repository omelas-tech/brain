---
description: Dashboard with brain health overview
---

# /brain:status — Brain Overview Dashboard

You are displaying a comprehensive overview of the Brain Memory system's current state.

## Steps

### 1. Read Brain State

Read `~/.brain/index.json` to get the full memory inventory. If `~/.brain/` doesn't exist, inform the user — it is created automatically by the installer, or on the first `/brain:memorize` or `/brain:sync`.

Also read (if they exist):
- `~/.brain/associations.json` — for association network stats
- `~/.brain/review-queue.json` — for review schedule info
- `~/.brain/_archived/index.json` — for archive stats
- `~/.brain/.sync/config.json` — for git sync configuration

### 2. Compute Statistics

For each memory in the index, compute:

```
days_elapsed = (now - last_accessed) / (1000 * 60 * 60 * 24)
decayed_strength = strength * (decay_rate ^ days_elapsed)
```

Calculate aggregate stats:
- Total memory count
- Memories per top-level category
- Average effective (decayed) strength
- Memories by type distribution
- Memories by cognitive type (episodic / semantic / procedural)
- Total tags (unique count)
- Confidence distribution
- Salience distribution

### 3. Display Dashboard

```
╔══════════════════════════════════════════╗
║          🧠 BRAIN STATUS                ║
╠══════════════════════════════════════════╣
║ Total Memories:     <count>             ║
║ Archived:           <count>             ║
║ Last Updated:       <date>              ║
║ Average Strength:   <avg> / 1.00        ║
║ Average Confidence: <avg> / 1.00        ║
║ Brain Age:          <days since init>   ║
║ Brain Version:      <version>           ║
╚══════════════════════════════════════════╝

## Categories
  professional:  ████████████░░░  <N> memories (avg ⚡<strength>)
  personal:      ██████░░░░░░░░░  <N> memories (avg ⚡<strength>)
  social:        ███░░░░░░░░░░░░  <N> memories (avg ⚡<strength>)
  family:        ████░░░░░░░░░░░  <N> memories (avg ⚡<strength>)

## Memory Types
  decision:     <N>  |  learning:    <N>
  experience:   <N>  |  insight:     <N>
  observation:  <N>  |  goal:        <N>
  preference:   <N>  |  relationship:<N>

## Cognitive Types
  episodic:     <N>  (event-specific, faster decay)
  semantic:     <N>  (abstracted knowledge, stable)
  procedural:   <N>  (skills/workflows, very stable)

## Confidence Distribution
  High (0.8-1.0):    <count> memories — verified/reliable
  Medium (0.5-0.7):  <count> memories — plausible
  Low (< 0.5):       <count> memories — uncertain ⚠️

## Associative Network
  Total links:       <count> edges
  Avg link weight:   <avg>
  Strongest links:
    1. <mem_a title> ↔ <mem_b title> (weight: <w>)
    2. <mem_a title> ↔ <mem_b title> (weight: <w>)

## Strongest Memories (Top 5)
  1. ⚡0.92 — <title> (<path>)
  2. ⚡0.88 — <title> (<path>)
  ...

## Most Recalled (Top 5)
  1. 🔄 <count>x — <title> (<path>)
  2. 🔄 <count>x — <title> (<path>)
  ...

## High-Salience Memories (protected from auto-pruning)
  🛡️ <title> (salience: <s>, strength: <str>)
  🛡️ <title> (salience: <s>, strength: <str>)

## Fading Memories (decayed strength < 0.3)
  ⚠ <count> memories below consolidation threshold
  Run /brain:sleep to consolidate and preserve them

## Review Queue
  📋 Due now: <count> memories
  📋 Due this week: <count> memories
  📋 Total in queue: <count> memories
  Due memories are reinforced automatically during /brain:sleep

## Recent Memories (Last 7 days)
  + <title> (<path>) — <date>
  + <title> (<path>) — <date>
  ...

## Sync
  Remote:       <remote URL or "not configured">
  Encryption:   <enabled/disabled>
  Last Push:    <timestamp or "never">
  Last Pull:    <timestamp or "never">
  Ahead:        <count> commits
  Behind:       <count> commits
```

### 4. Health Check

Analyze the brain's health and provide recommendations:

- **"Healthy"** — Good distribution across categories, strong average strength
- **"Needs consolidation"** — Many memories below threshold, suggest `/brain:sleep`
- **"Imbalanced"** — One category dominates, suggest diversifying
- **"Stale"** — No new memories in 14+ days, suggest `/brain:memorize`
- **"Overloaded"** — More than 200 active memories, suggest pruning with `/brain:forget --prune`
- **"Needs propagation"** — Recent memories exist alongside older related memories that haven't been updated. Suggest `/brain:sleep`
- **"Needs sleep"** — Multiple flat clusters detected, OR many memories in moderate/weak tiers, OR no `_expertise.md` profiles exist despite having 10+ memories. Suggest `/brain:sleep`
- **"Low confidence"** — More than 30% of memories have confidence < 0.5. Suggest reviewing and validating uncertain memories.
- **"Review overdue"** — More than 10 memories are past their review date. Suggest `/brain:sleep` (its replay pass reinforces them)
- **"Sync available"** — Git sync is not configured. Suggest `/brain:sync setup` for cross-device access.
- **"Sync stale"** — Last push was more than 7 days ago. Suggest `/brain:sync push`.
