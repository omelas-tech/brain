---
description: Merge related weak memories into stronger combined memories
argument-hint: "[scope]"
---

# /brain:consolidate — Merge Related Memories

You are consolidating memories in the Brain Memory system. Consolidation combines multiple related or weakening memories into a single stronger, more coherent memory — mimicking how human brains merge similar experiences into generalized knowledge.

**Target scope:** $ARGUMENTS

## Steps

### 1. Determine Scope

- If $ARGUMENTS specifies a category path, consolidate within that subtree
- If $ARGUMENTS is empty, scan the entire `~/.brain/` for consolidation candidates
- If $ARGUMENTS is "auto", perform automatic consolidation based on thresholds

### 2. Find Consolidation Candidates

Read `index.json` and identify candidate groups using these criteria:

**Automatic candidates (any of):**
- Memories with effective (decayed) strength below `consolidation_threshold` (default: 0.3)
- Clusters of 3+ memories in the same directory with overlapping tags
- Memories with the same type in the same category that are older than 30 days

**Compute decayed strength for each:**
```
days_elapsed = (now - last_accessed) / (1000 * 60 * 60 * 24)
decayed_strength = strength * (decay_rate ^ days_elapsed)
```

### 3. Group Related Memories

Group candidates by:
1. **Path proximity** — memories in the same or nearby directories
2. **Tag overlap** — memories sharing 2+ tags
3. **Type similarity** — same memory type
4. **Temporal proximity** — created within similar time periods

Present the proposed groups to the user:

```
## Consolidation Candidates

### Group 1: Kubernetes Deployments (professional/companies/acme/projects/)
- deployment-v1.md (strength: 0.22, type: experience)
- deployment-v2.md (strength: 0.18, type: experience)
- k8s-config-issue.md (strength: 0.15, type: learning)
→ Proposed: Merge into "kubernetes-deployment-lessons.md" (strength: 0.75)

### Group 2: TypeScript Learnings (personal/education/)
- ts-generics.md (strength: 0.28, type: learning)
- ts-utility-types.md (strength: 0.25, type: learning)
→ Proposed: Merge into "typescript-advanced-types.md" (strength: 0.65)
```

### 4. Get User Approval

Ask the user which groups to consolidate. They can:
- Approve all proposed groups
- Select specific groups
- Modify groupings
- Cancel

### 5. Perform Consolidation

For each approved group:

1. **Read all source memories** in the group
2. **Synthesize** a new consolidated memory that:
   - Preserves all key details and insights from the sources
   - Identifies patterns and evolution across the memories
   - Creates a coherent narrative or structured summary
   - Is more concise than the sum of its parts
3. **Calculate new strength**: `max(source_strengths) + 0.15` (capped at 1.0)
4. **Set new decay rate**: Use the slowest decay rate from the sources
5. **Merge tags**: Union of all source memory tags
6. **Set related**: Include all source memory IDs in the `related` field
7. **Salience anchoring**: The highest-salience memory in the group is the "anchor" — its framing and key details take priority in the synthesis. Inherit max salience.
8. **Confidence**: Inherit the maximum confidence from the group
9. **Cognitive type**: Set to `semantic` (consolidation abstracts knowledge)

### 6. Write Consolidated Memory

Create the new memory file in the appropriate location (same directory as the majority of sources, or in `_consolidated/` if sources span categories).

Use the standard memory format with an additional section:

```markdown
---
id: mem_<date>_<hex>
type: consolidated
cognitive_type: semantic
created: <now>
last_accessed: <now>
access_count: 0
recall_history: []
strength: <calculated>
decay_rate: <calculated>
salience: <max from sources>
confidence: <max from sources>
tags: [<merged tags>]
related: [<all source IDs>]
consolidated_from: [<source IDs>]
source: consolidation
encoding_context:
  project: <project if shared, otherwise omit>
  topics: [<merged key topics>]
  task_type: <most common from sources>
---

# <Descriptive Title>

<Synthesized summary>

## Key Patterns

<Patterns identified across the source memories>

## Timeline

<Chronological evolution if applicable>

## Source Memories

<List of original memories that were merged, with their dates and original titles>
```

### 7. Archive Source Memories

Move the original source memory files to a `~/.brain/_archived/` directory (create if needed), preserving their paths as subdirectories. This keeps them recoverable and searchable via `/brain:remember`.

Update `index.json`:
- Remove archived memory entries from `memories`
- Add the new consolidated memory
- Update `memory_count`
- Update `last_updated`

Update `_archived/index.json`:
- Add entries for each archived memory with original metadata and `archived_reason: "consolidation"`

Update `associations.json`:
- Transfer association edges from source memories to the new consolidated memory
- Remove edges pointing to archived source memories

Update `review-queue.json`:
- Remove entries for archived source memories
- Add entry for the new consolidated memory if applicable

### 8. Confirm

Print a summary:
- How many memories were consolidated into how many
- New consolidated memory titles, paths, and strengths
- Space saved (number of files reduced)
