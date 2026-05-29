---
description: Decay or archive memories
argument-hint: "[target]"
---

# /brain:forget — Decay or Remove Memories

You are managing memory decay in the Brain Memory system. This command accelerates forgetting for specific memories or prunes memories that have naturally decayed below usefulness.

**Target:** $ARGUMENTS

## Steps

### 1. Determine Mode

Based on $ARGUMENTS:

**Mode A — Targeted forget** (e.g., "/brain:forget kubernetes deployment issue"):
Find specific memories matching the query and offer to accelerate their decay or remove them.

**Mode B — Threshold prune** (e.g., "/brain:forget --prune" or "/brain:forget --prune 0.2"):
Find all memories whose effective (decayed) strength is below the given threshold (default: 0.2) and offer to archive them.

**Mode C — Category prune** (e.g., "/brain:forget professional/companies/old-corp"):
Apply decay/removal to an entire category subtree.

### 2. Find Affected Memories

Read `index.json` and compute effective (decayed) strength for each candidate:

```
days_elapsed = (now - last_accessed) / (1000 * 60 * 60 * 24)
decayed_strength = strength * (decay_rate ^ days_elapsed)
```

For Mode A: Match query against titles, tags, and paths.
For Mode B: Filter by decayed strength < threshold.
For Mode C: Filter by path prefix.

**Salience protection**: Flag any memories with `salience >= 0.7` — these require explicit `/brain:forget` with direct confirmation (never included in bulk prune operations).

### 3. Present Candidates

Show the user what would be affected:

```
## Memories to Forget

| # | Title | Path | Strength | Decayed | Salience | Age |
|---|-------|------|----------|---------|----------|-----|
| 1 | K8s Config Issue | professional/companies/acme/k8s-config.md | 0.40 | 0.12 | 0.3 | 94d |
| 2 | Old Deploy Notes | professional/companies/acme/deploy-v1.md | 0.35 | 0.08 | 0.2 | 120d |

⚡ Salience-protected (requires explicit confirmation):
| 3 | Critical Auth Fix | professional/security/auth-fix.md | 0.30 | 0.05 | 0.9 | 200d |

**Action options:**
- **Archive**: Move to `_archived/` (recoverable, searchable via /brain:remember)
- **Accelerate decay**: Set decay_rate to 0.90 (fast fade)
- **Delete permanently**: Remove files entirely (not recoverable)
```

### 4. Get User Confirmation

The user must explicitly choose an action. Default to **archive** (safest).

**IMPORTANT:** Never delete memories without explicit user confirmation.

### 5. Execute

**Archive:**
- Move memory files to `~/.brain/_archived/<original-path>/`
- Add entry to `~/.brain/_archived/index.json` with all original metadata:
  ```json
  {
    "<memory_id>": {
      "path": "<original path>",
      "archived_path": "<path in _archived/>",
      "title": "<title>",
      "type": "<type>",
      "cognitive_type": "<cognitive_type>",
      "strength": <strength at archival>,
      "salience": <salience>,
      "confidence": <confidence>,
      "tags": ["<tags>"],
      "archived_date": "<ISO timestamp>",
      "archived_reason": "<user-specified or auto>"
    }
  }
  ```
- Remove entries from `index.json` `memories`
- Remove from `review-queue.json` if present
- Remove association edges involving this memory from `associations.json`
- Decrement `memory_count` in index and relevant `_meta.json` files
- Update `last_updated`

**Accelerate decay:**
- Set `decay_rate` to 0.90 in the memory file's frontmatter
- Update `index.json` entry
- Memory will naturally fade in subsequent sleep cycles

**Delete permanently:**
- Remove memory files
- Remove entries from `index.json`
- Remove from `review-queue.json` if present
- Remove association edges from `associations.json`
- Update `_meta.json` files
- Clean up empty directories

### 6. Suggest Consolidation

If any remaining memories in the affected area are also weak (decayed strength < 0.4), suggest running `/brain:consolidate` on that category to preserve the knowledge in a more durable form before it fades.

### 7. Confirm

Print summary:
- Number of memories affected
- Action taken (archived/accelerated/deleted)
- Current brain stats (total memories, average strength)
- Archive searchability note: "Archived memories are searchable via /brain:remember if needed in the future"
