---
description: Health dashboard for the global brain memory system (~/.brain)
---

# /brain-status — Brain Overview Dashboard

Display an overview of the Brain Memory system's current state by reading
its JSON indexes directly (this is a read-only report — do not modify any
files).

## Steps

1. **Read the brain state.** Read `~/.brain/index.json` for the full memory
   inventory. If `~/.brain/` does not exist, say so — it is created by the
   brain-memory installer or on the first memorize. Also read, when present:
   - `~/.brain/associations.json` — association network stats
   - `~/.brain/review-queue.json` — review schedule
   - `~/.brain/_archived/index.json` — archive stats
   - `~/.brain/.sync/config.json` — sync configuration

2. **Compute statistics.** For each memory:

   ```
   days_elapsed = (now - last_accessed) / (1000 * 60 * 60 * 24)
   decayed_strength = strength * (decay_rate ^ days_elapsed)
   ```

   Aggregate: total count, per top-level category (professional / personal /
   social / family), average decayed strength, distribution by type and by
   cognitive type, confidence distribution, count below the 0.3
   consolidation threshold, review-queue due counts.

3. **Render a compact dashboard** — totals and averages up top, then
   categories (with counts and average strength), memory types, cognitive
   types, confidence distribution, strongest and most-recalled memories
   (top 5 each), fading memories (decayed strength < 0.3), review queue, and
   sync state (remote, encryption, last push/pull).

4. **Health check.** Close with one assessment and a next step:
   - Many memories below 0.3 → suggest a `brain sleep` maintenance cycle
   - One category dominates → note the imbalance
   - No new memories in 14+ days → suggest memorizing recent work
   - Over 30% of memories with confidence < 0.5 → suggest verifying them
   - 10+ memories past their review date → suggest `brain sleep`
   - Sync unconfigured or last push over 7 days ago → suggest syncing

If `~/.brain/index.json` is missing or the `brain` CLI is not installed,
point the user at `npm install -g brain-memory`.
