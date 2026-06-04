---
description: Full maintenance cycle: replay, homeostasis, consolidation, pruning, dreaming
argument-hint: "[scope]"
---

# /brain:sleep — Overnight Memory Reorganization

You are performing a **sleep cycle** on the Brain Memory system. Just like the human brain during sleep — where the hippocampus replays recent experiences and the neocortex reorganizes them into long-term structured knowledge — this command restructures, consolidates, prunes, and deepens the `~/.brain/` hierarchy.

**Scope:** $ARGUMENTS

## Overview

Sleep performs nine phases, mimicking real neuroscience:

1. **Replay** — Scan recent activity and compute decay across all memories
2. **Synaptic Homeostasis** — Proportionally scale down all strengths to prevent inflation (Tononi & Cirelli SHY)
3. **Knowledge Propagation** — Evaluate recent memories against the hierarchy and update related memories
4. **Semantic Crystallization** — Extract generalizable knowledge from frequently-recalled episodic memories
   - **4b. Procedural Crystallization** — Distill repeated procedures into reusable skills (CoALA Phase 3)
5. **Reorganize** — Detect flat clusters and restructure into deeper sub-categories
6. **Consolidate** — Merge weak related memories into stronger combined knowledge
7. **Prune** — Archive memories that have decayed beyond recovery, including context-shift obsolescence (Tier B §10.1)
8. **REM Dreaming** — Discover creative cross-domain associations via analogical reasoning
9. **Expertise Detection** — Identify dense knowledge areas and generate expertise profiles

## Phase 1: Replay (Hippocampal Scan)

During sleep, the hippocampus replays the day's events. Here, we scan and assess the full brain state.

### Steps

1. Read `~/.brain/index.json` to load all memories
2. If $ARGUMENTS specifies a category path, limit scope to that subtree. Otherwise, process the entire brain.
3. For **every** memory, compute the current decayed strength:

```
days_elapsed = (now - last_accessed) / (1000 * 60 * 60 * 24)
decayed_strength = strength * (decay_rate ^ days_elapsed)
```

   **Decay-exempt memories (CoALA Phase 1):** if a memory is `pinned` or `stable`, its `decayed_strength` equals its raw `strength` (it never fades). Treat such memories as **Strong** regardless of elapsed time.

4. Categorize each memory into tiers:
   - **Strong** (decayed_strength >= 0.6) — healthy, no action needed
   - **Moderate** (0.3 <= decayed_strength < 0.6) — consolidation candidates
   - **Weak** (0.1 <= decayed_strength < 0.3) — urgent: consolidate or lose
   - **Fading** (decayed_strength < 0.1) — prune candidates

5. Collect statistics:
   - Memories per tier
   - Memories per directory (for cluster detection)
   - Tag frequency analysis (for sub-category extraction)
   - Mean effective strength across all memories (for Synaptic Homeostasis)

Present a brief replay summary before continuing:

```
## Phase 1: Replay Complete

Scanned <N> memories across <M> categories

  Strong (>=0.6):   <count> memories — healthy
  Moderate (0.3-0.6): <count> memories — consolidation candidates
  Weak (0.1-0.3):   <count> memories — urgent attention needed
  Fading (<0.1):    <count> memories — pruning candidates

  Mean effective strength: <value>

Proceeding to synaptic homeostasis...
```

---

## Phase 2: Synaptic Homeostasis (Global Downscaling)

Based on Tononi & Cirelli's **Synaptic Homeostasis Hypothesis (SHY)** — during sleep the brain proportionally scales down ALL synaptic strengths, then selectively re-boosts important ones. This prevents "strength inflation" where frequent recall pushes everything toward 1.0, making the scoring system less discriminating.

### Steps

1. Compute `mean_effective_strength` from Phase 1 across all memories

2. If `mean_effective_strength > 0.5`, apply downscaling:

```
scaling_factor = max(0.85, 0.5 / mean_effective_strength)
```

3. For every memory: `strength = strength * scaling_factor` — **except** `pinned` or `stable` memories, which are exempt from homeostatic downscaling (their strength is never altered).

4. Selectively re-boost important memories:
   - **High salience** (salience >= 0.7): +0.05
   - **Recently accessed** (within 7 days): +0.03
   - **Frequently recalled** (access_count >= 5): +0.02

5. Also downscale association weights in `associations.json`:
   - Apply `weight = weight * scaling_factor` to all edges
   - Prune edges that fall below the `link_prune_threshold` (default 0.05)

6. Update all memory files (frontmatter) and `index.json` entries

If `mean_effective_strength <= 0.5`, skip this phase:

```
## Phase 2: Synaptic Homeostasis — Skipped

Mean effective strength (0.42) is within healthy range. No downscaling needed.
```

Otherwise present:

```
## Phase 2: Synaptic Homeostasis Complete

Mean strength before: <before>
Scaling factor applied: <factor>
Mean strength after: <after>

Re-boosted:
  High salience: <count> memories (+0.05 each)
  Recently accessed: <count> memories (+0.03 each)
  Frequently recalled: <count> memories (+0.02 each)

Association links downscaled: <count>, pruned: <count>
```

---

## Phase 3: Knowledge Propagation (Reconsolidation)

In neuroscience, **memory reconsolidation** is the process where recalling an existing memory makes it temporarily malleable — allowing the brain to update it with new information before re-stabilizing it. During sleep, recently acquired knowledge is replayed against the existing memory network, triggering updates to related older memories. This is how a single new insight can reshape your understanding of an entire topic.

This phase takes each **recent memory** and walks the brain hierarchy — checking both upper-level (parent) and lower-level (child) categories, plus sibling and tag-related memories — to determine if existing knowledge should be updated in light of what was recently learned.

### Steps

#### 3.1 Identify Recent Memories

From the Phase 1 scan, identify **recent memories** — those meeting any of these criteria:
- Created within the last `propagation_window_days` (default: 7 days, configurable in `index.json` config)
- `last_accessed` within the propagation window AND `access_count` increased (recently recalled and reinforced)
- Memories flagged with `source` matching recent session identifiers

These are the "trigger memories" — the new knowledge that may require updates to existing memories.

If no recent memories are found, skip this phase with a brief note:

```
## Phase 3: Knowledge Propagation — Skipped

No recent memories found within the propagation window (7 days).
Nothing to propagate.
```

#### 3.2 Find Related Memories for Each Trigger

For each recent (trigger) memory, find related memories through **five traversal strategies**:

**A. Hierarchical — Upper levels (ancestors)**
Walk UP from the trigger memory's directory to the top-level category:
- Read all memory files in each parent directory
- These represent broader context that may need updating with the new specific knowledge

**B. Hierarchical — Lower levels (descendants)**
Walk DOWN into any child directories from the trigger memory's directory:
- Read all memory files in subdirectories (up to 2 levels deep to avoid excessive scanning)
- These represent more specific knowledge that the new broader insight may affect

**C. Sibling memories**
Read all memory files at the SAME directory level as the trigger memory:
- These are directly related knowledge in the same category
- Most likely to need updating since they cover the same topic area

**D. Tag-related memories**
From `index.json`, find memories anywhere in the brain that share **2 or more tags** with the trigger memory:
- These capture cross-domain connections that the hierarchy alone might miss

**E. Association-linked memories** (NEW)
From `associations.json`, find all neighbors of the trigger memory with edge weight >= 0.15:
- These capture learned associations from previous co-retrievals and manual links
- Includes memories that might not share tags or hierarchy but have been used together

Also include any memories explicitly listed in the trigger memory's `related` field.

**Deduplication**: A memory found through multiple strategies is only evaluated once, but mark it as having stronger relation (found via multiple paths).

#### 3.3 Evaluate Each Related Memory

For each related memory found, read it fully and evaluate it against the trigger memory. Classify the relationship as one or more of:

**Enrichment** — The new knowledge adds detail, nuance, or a new perspective to the existing memory:
- *Action*: Propose appending new information to the existing memory's Key Details or Connections section

**Contradiction** — The new knowledge conflicts with or supersedes existing knowledge:
- *Action*: Flag for user review — propose updating the existing memory with the corrected information and noting what changed and why
- Also reduce the contradicted memory's `confidence` by -0.20 (floored at 0.1)

**Validation** — The new knowledge confirms or strengthens existing knowledge:
- *Action*: Boost the existing memory's `strength` by +0.05 (capped at 1.0), update `last_accessed`
- Also boost the validated memory's `confidence` by +0.10 (capped at 1.0)

**Obsolescence** — The new knowledge makes the existing memory outdated or irrelevant:
- *Action*: Propose marking the existing memory for accelerated decay (`decay_rate` → 0.90) or archival

**Cross-reference** — The memories should reference each other but don't yet:
- *Action*: Add bidirectional cross-references (update `related` arrays in both memories)
- Also create/strengthen association edges in `associations.json` with origin `propagation`

#### 3.4 Present Propagation Plan

Group all proposed updates by action type and present to the user (same format as before).

#### 3.5 Get User Approval

The user can approve all, select specific updates, modify, or skip.

#### 3.6 Execute Approved Updates

Execute as before, plus:
- For contradictions: also reduce `confidence` by -0.20
- For validations: also boost `confidence` by +0.10
- For cross-references: also create/strengthen edges in `associations.json`

---

## Phase 4: Semantic Crystallization (Episodic → Semantic)

In the brain, specific episodic memories (tied to events) gradually transform into abstracted semantic knowledge (general principles) through repeated recall. The event details fade, but the lesson persists.

### Steps

1. Find episodic memories (cognitive_type: episodic) with:
   - `access_count >= 3` (recalled multiple times — the pattern has been reinforced)
   - `decayed_strength >= 0.4` (still meaningfully strong)

2. For each candidate, evaluate: **Is there a generalizable lesson or principle that can be extracted from this specific event?**

3. If yes, create a new **semantic** memory:
   - `cognitive_type: semantic`
   - `type`: usually `insight` or `learning`
   - Content: the generalized principle/pattern, not the specific event
   - `related`: link to the source episodic memory
   - `strength`: inherit from source, but with semantic default decay (slower)
   - `salience`: inherit from source
   - `confidence`: source confidence - 0.10 (abstraction introduces some uncertainty)

4. For the source episodic memory:
   - Accelerate its decay: multiply `decay_rate` by 0.990 (the event details fade faster)
   - Add reference to the new semantic memory in `related`
   - Add note: `<!-- Crystallized into <semantic_id> on <date> -->`

5. Create/strengthen association edge between the episodic source and semantic output with origin `propagation`

**Example:**
- Episodic: "OAuth token expired mid-session on Tuesday causing 30min outage"
- → Semantic: "Always refresh tokens proactively before API calls, not reactively after failures"

Present crystallization proposals for user approval:

```
## Phase 4: Semantic Crystallization

Found <N> episodic memories ready for crystallization:

🔬 **oauth-token-incident.md** (episodic, recalled 4x, strength 0.65)
   → Proposed semantic memory: "Proactive Token Refresh Strategy"
   Generalized principle: Always refresh tokens proactively before API calls
   Source event details will begin fading (decay accelerated)

Approve crystallizations? [all / select / skip]
```

---

## Phase 4b: Procedural Crystallization (Episodic → Procedural) — CoALA Phase 3

Beyond abstracting *principles* (Phase 4), the brain also turns repeated *procedures* into skills. When the same kind of task has been solved the same way several times, distill it into a reusable `SKILL.md` — Brain's genuine value-add over CoALA, which only describes hand-authored skills.

### Steps

1. Cluster `procedural`/`experience` memories by tag overlap + association edges (the same clustering used elsewhere). Look for a recurring *task-solving procedure* represented across **≥ N similar memories** (default N = 3).

2. For each qualifying cluster, evaluate: **is there a repeatable, step-by-step procedure here that would help on a future task?**

3. If yes, draft a skill (do not write silently — propose it):
   - `name`: a short kebab-case slug
   - `description`: one matchable line (~100 tokens) — the L0 advertisement
   - `triggers`: phrases that should surface it
   - body: the step-by-step instructions, drawn from the source memories
   - Create it with `brain skill add` once approved.

4. Link the new skill to its source memories (note the skill name in their `related`/notes).

**Example:**
- 3× episodic: "set up Cloudflare Worker + D1 for project X / Y / Z" solved the same way
- → Skill `deploy-cloudflare-worker-d1`: the distilled step list.

Present proposals for user approval (never auto-create):

```
## Phase 4b: Procedural Crystallization

Found <N> recurring procedures ready to become skills:

🛠️  Pattern seen 3× across {projX, projY, projZ}
   → Proposed skill: "deploy-cloudflare-worker-d1"
   Triggers: "deploy worker", "set up D1"

Approve skill creation? [all / select / skip]
```

These crystallized skills are *hypotheses*: their strength/demotion feedback (`brain skill use [--failed]`) validates or retires them over time.

---

## Phase 5: Reorganize (Neocortical Restructuring)

During sleep, the brain transfers memories from the hippocampus to the neocortex, organizing them into structured long-term storage. This phase detects **flat clusters** — directories with many memories that should be organized into deeper sub-categories.

### Steps

1. **Scan for flat clusters**: For each directory in the brain, count the number of memory files (not counting `_meta.json`).

2. **Identify restructuring candidates** — directories where:
   - There are **3 or more** memory files at the same level, AND
   - The memories can be meaningfully grouped by **tag overlap**, **title similarity**, or **semantic themes**

3. **Extract sub-categories**: For each candidate directory, analyze the memory files within it:
   - Read each memory's tags, title, and content summary
   - Identify natural groupings (2+ memories that share a common theme)
   - Propose sub-category directory names using kebab-case

   **Sub-category extraction rules:**
   - A group needs at least **2 memories** to justify a sub-category
   - The sub-category name should be a **clear, descriptive noun** (e.g., `authentication`, `state-management`, `deployment`)
   - Memories that don't fit any group stay at the current level (don't force-categorize)
   - Never exceed `max_depth` from config

4. **Present the reorganization plan** to the user

5. **Get user approval**

6. **Execute approved reorganizations**:
   - Create new sub-category directories with `_meta.json`
   - Move memory files to their new locations
   - Update `index.json` with new paths for all moved memories
   - Update `_meta.json` in affected directories (memory counts, subcategories)
   - **Preserve all memory content and metadata** — only the path changes

---

## Phase 6: Consolidate (Memory Integration)

During deep sleep, the brain merges related experiences into generalized knowledge. Weak memories that share themes are combined into stronger, more durable memories.

### Steps

1. From the Phase 1 scan, take all **Moderate** and **Weak** tier memories (decayed_strength < 0.6) that were NOT already updated in Phase 3 (Knowledge Propagation) or Phase 4 (Semantic Crystallization)

2. Group consolidation candidates by:
   - **Path proximity** — memories in the same or nearby directories (highest priority after reorganization)
   - **Tag overlap** — memories sharing 2+ tags
   - **Type similarity** — same memory type
   - **Temporal proximity** — created within similar time periods

3. For each viable group (2+ memories):
   - Read all source memories fully
   - Synthesize a consolidated memory that preserves all key details and insights
   - Calculate: `new_strength = max(source_strengths) + 0.15` (capped at 1.0)
   - Use the slowest decay rate from the sources
   - Merge all tags (union)
   - **Salience anchoring**: The highest-salience memory in the group becomes the "anchor" — its key details and framing take priority in the synthesis. The consolidated memory inherits the maximum salience from the group.
   - Inherit the maximum confidence from the group

4. Present consolidation plan to user for approval

5. For approved consolidations:
   - Write consolidated memory files using the standard format with `type: consolidated`
   - Archive source memories to `~/.brain/_archived/` and add them to `_archived/index.json`
   - Transfer association edges from source memories to the consolidated memory in `associations.json`
   - Update `index.json` and `_meta.json` files

---

## Phase 7: Prune (Synaptic Pruning)

During sleep, the brain prunes weak synaptic connections to maintain efficiency. Here, we archive memories that have faded beyond usefulness.

### Obsolescence / context-shift detection (Tier B §10.1)

Decay handles *slow fade*; this catches *abrupt relevance loss*. A memory cluster can become obsolete overnight (the user changed jobs, abandoned a project, switched stacks) while still carrying high strength — so decay alone never retires it.

- Read `~/.brain/contexts.json`. Identify any `encoding_context.project` (or role/domain) that appears in older memories but has been **absent from the last N sessions** (default N = 10).
- Flag the affected cluster (by project + association edges) as **candidate-obsolete** — these become *additional* archive candidates below.
- **Never** flag `pinned` memories (an explicit, active user choice). `stable` memories *can* be flagged — stability exempts from decay, not from obsolescence (a timeless fact about a former employer is still obsolete).
- This is reversible: candidates are *archived* (recoverable from `_archived/`), never erased, and only after user confirmation.

### Steps

1. Take all **Fading** tier memories (decayed_strength < 0.1) that were NOT already consolidated in Phase 6 — plus any **candidate-obsolete** clusters from the detection step above

2. **Salience protection**: Memories with `salience >= 0.7` are NEVER auto-pruned, regardless of strength. Skip them with a note:
   ```
   ⚡ Skipping <title> — high salience (0.8) protects from auto-pruning
   ```

   **Pinned/stable protection (CoALA Phase 1):** `pinned` or `stable` memories are also NEVER pruned or archived — they are decay-exempt, so they never reach the Fading tier in the first place. Skip them too.

3. Present the prune list (excluding salience- and pin/stable-protected memories)

4. Get user approval (default: archive all)

5. Execute:
   - Move to `~/.brain/_archived/`, preserving directory structure
   - Add to `_archived/index.json` with original metadata
   - Remove from `index.json` and update `_meta.json` files
   - Remove association edges involving pruned memories from `associations.json`

---

## Phase 8: REM Dreaming (Creative Association Discovery)

During REM sleep, the brain creates novel connections between seemingly unrelated memories — this is why we often have creative breakthroughs after sleeping on a problem. This phase implements that creative association mechanism.

### Steps

1. Select 5-10 random memories from **different top-level categories** that have decayed_strength >= 0.3

2. For each pair of memories from different categories, evaluate potential cross-domain connections using **analogical reasoning**:
   - Are there structural similarities? (both involve X pattern)
   - Are there shared underlying principles? (both deal with expiration/renewal)
   - Could techniques from one domain apply to the other?
   - Are there complementary perspectives?

3. Score each potential connection:
   ```
   dream_score = 0.5 * novelty + 0.3 * utility + 0.2 * surprise
   ```
   - **novelty**: How unexpected is this connection? (0-1)
   - **utility**: How useful could this insight be? (0-1)
   - **surprise**: How non-obvious is this? (0-1)

4. For connections scoring >= 0.5:
   - Create association edges in `associations.json` with origin `creative` and initial weight 0.15
   - Present as "dream insights"

5. Present discoveries:

```
## Phase 8: REM Dreaming — Creative Insights

💭 **Dream Insight 1** (score: 0.72)
   "Token refresh patterns" ↔ "Subscription renewal flows"
   Both involve: expiration handling, silent renewal, fallback strategies
   Potential application: Apply token refresh retry logic to subscription renewals

💭 **Dream Insight 2** (score: 0.58)
   "Database migration strategies" ↔ "Moving to a new apartment"
   Both involve: careful planning, rollback capability, staged execution
   Potential application: Use the migration checklist pattern for personal life transitions

<N> creative associations discovered and linked
```

---

## Phase 9: Expertise Detection (Knowledge Crystallization)

This is the most powerful phase. When the brain repeatedly processes information in a domain, it forms **expertise** — fast, intuitive access to deep knowledge. Here, we detect when a sub-tree has become dense enough to represent genuine expertise.

### Steps

1. **Scan for expertise candidates**: For each directory (including newly reorganized ones), evaluate:
   - **Memory density**: 3+ memories in the subtree
   - **Average strength**: Mean decayed strength of memories in the subtree
   - **Recall frequency**: Sum of `access_count` across memories in the subtree
   - **Time span**: Duration between the oldest and newest memory
   - **Topic coherence**: How tightly related the memories are (based on tag overlap)

2. **Calculate expertise score** for each candidate directory:

```
density_score    = min(1.0, memory_count / 5)
strength_score   = average_decayed_strength
recall_score     = min(1.0, total_access_count / 10)
span_score       = min(1.0, time_span_days / 30)
coherence_score  = shared_tags / total_unique_tags

expertise_score  = (0.25 * density_score) + (0.25 * strength_score) + (0.20 * recall_score) + (0.15 * span_score) + (0.15 * coherence_score)
```

3. **Classify expertise level** based on the score:
   - **Awareness** (0.2 - 0.4) — Surface-level familiarity. You know it exists.
   - **Working Knowledge** (0.4 - 0.6) — Can work with this competently with some reference.
   - **Deep Knowledge** (0.6 - 0.8) — Strong command. Can reason about trade-offs and edge cases.
   - **Expert** (0.8 - 1.0) — Mastery. Dense, frequently-recalled, long-standing knowledge.

4. **Generate or update expertise profiles**: For each directory scoring >= 0.2, create or update an `_expertise.md` file.

5. **Knowledge gap detection**: By analyzing what sub-topics exist vs. what commonly appears alongside them (using tag relationships across the whole brain), identify areas where expertise could be deepened. List these as "Knowledge Gaps" in the expertise profile.

6. **Generate review queue**: After expertise detection, populate `review-queue.json` using simplified SM-2 scheduling. For each memory with `access_count > 0`:
   ```
   interval = base_interval * (2.5 ^ (successful_reviews - 1))
   next_review = last_accessed + interval
   ```
   Where `base_interval = 1 day` and `successful_reviews = min(access_count, 10)`.

   Add or update entries in `review-queue.json`:
   ```json
   {
     "memory_id": "<id>",
     "next_review": "<ISO timestamp>",
     "interval_days": <interval>,
     "ease_factor": 2.5,
     "review_count": <count>
   }
   ```

7. Present expertise findings.

---

## Sleep Report

After all phases complete, present a comprehensive sleep report:

```
╔═══════════════════════════════════════════════════════════════╗
║                    🌙 SLEEP CYCLE COMPLETE                   ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  Phase 1 — Replay:            <N> memories scanned            ║
║  Phase 2 — Homeostasis:       Scaling factor: <X>             ║
║  Phase 3 — Propagated:        <N> updates from <M> recent     ║
║  Phase 4 — Crystallized:      <N> episodic → semantic         ║
║  Phase 5 — Reorganized:       <N> memories, <M> new dirs      ║
║  Phase 6 — Consolidated:      <N> memories merged into <M>    ║
║  Phase 7 — Pruned:            <N> faded memories archived     ║
║  Phase 8 — REM Dreams:        <N> creative insights           ║
║  Phase 9 — Expertise:         <N> domains profiled            ║
║                                                               ║
║  Brain Health:                                                ║
║    Before sleep: <count> memories, avg strength <X>           ║
║    After sleep:  <count> memories, avg strength <Y>           ║
║    Expertise areas: <count> domains mapped                    ║
║    Review queue: <count> memories scheduled                   ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝

### Expertise Summary
<expertise level list from Phase 9>

### Dream Insights
<creative associations from Phase 8>

### Memories Due for Review
<count> memories due within the next 7 days — reinforced during this and future sleep cycles

### Recommendations
- <actionable suggestions based on what sleep revealed>
```

---

## Important Rules

1. **Always ask for approval** before executing reorganization, consolidation, crystallization, or pruning. Present the plan first.
2. **Never delete permanently** — pruned memories go to `_archived/` (recoverable).
3. **Preserve all content** — reorganization only changes paths, never memory content.
4. **Update all references** — when moving files, update `index.json`, all `_meta.json` files, `associations.json`, and `related` fields in other memories that reference moved memories.
5. **Respect max_depth** — never create directories beyond the configured `max_depth`.
6. **Scope control** — if $ARGUMENTS specifies a path (e.g., "professional/skills"), only sleep-process that subtree.
7. **Idempotent expertise** — if `_expertise.md` already exists, update it rather than creating a duplicate.
8. **Skip empty phases** — if there's nothing to do in a phase (e.g., no flat clusters to reorganize), briefly note it and move on.
9. **Salience protection** — never auto-prune memories with salience >= 0.7.
