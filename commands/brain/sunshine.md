---
description: Deep forensic erasure — trace and remove all references to a memory
argument-hint: "[target]"
---

# /brain:sunshine — Deep Forensic Memory Erasure

You are performing **deep forensic erasure** on a memory in the Brain Memory system. Like the procedure in *Eternal Sunshine of the Spotless Mind*, this command doesn't just delete a memory — it traces every ripple that memory left across the entire `~/.brain/` tree and surgically removes or repairs each one. When complete, it's as if the memory never existed.

Use this for erasing accidentally stored credentials, removing knowledge of a deprecated anti-pattern that leaked into other memories, or cleaning up after a fully reversed technical decision.

**Target:** $ARGUMENTS

## Flags

| Flag | Behavior |
|------|----------|
| *(default)* | Remove target + clean all direct references. Ask about derivatives individually |
| `--deep` | Also handle derivative memories and repair consolidated memories that lose sources |
| `--dry-run` | Show blast radius only — no changes are made |
| `--cascade` | With `--deep`, auto-remove derivative memories without asking |
| `--sensitive` | Overwrite file content with null bytes before deletion (for credentials, secrets) |
| `--no-trace` | Skip writing to `_erased.json` audit log |
| `--reason "<text>"` | Reason recorded in audit log entry |

## Steps

### 1. Parse Target and Flags

Extract:
- **Target identifier**: memory ID (e.g., `mem_20260215_a3f2c1`), title substring, or file path
- **Flags**: `--deep`, `--dry-run`, `--cascade`, `--sensitive`, `--no-trace`, `--reason`

If no target is provided, ask the user what memory they want to erase.

### 2. Locate Target Memory

Search for the target memory:

1. Read `~/.brain/index.json` and search `memories` by:
   - Exact ID match
   - Title substring match (case-insensitive)
   - Path substring match
2. If not found in active memories, check `~/.brain/_archived/index.json`
3. If still not found, check `~/.brain/_erased.json` — if found there, report:
   ```
   Memory was previously erased on <date>.
   Reason: <reason or "unspecified">
   No further action needed.
   ```
4. If not found anywhere, report and stop.
5. If multiple matches, present them and ask the user to pick one.

Once located, read the full memory file to capture its ID, title, path, tags, `related` array, `consolidated_from` array, and content.

### 3. Trace All References (Blast Radius Scan)

Scan the entire `~/.brain/` tree for every trace of the target memory. Track 8 reference types:

**3a. `related` arrays in other memories' frontmatter:**
Parse the YAML frontmatter of every `.md` memory file in `~/.brain/`. For each file whose `related` array contains the target ID, record:
- File path
- Current `related` array contents

**3b. Content body mentions:**
Search the Markdown body (below frontmatter) of all memory files for:
- The target memory ID (e.g., `mem_20260215_a3f2c1`)
- The target memory title (exact match)
Record each file path and the matching line.

**3c. `consolidated_from` arrays:**
Among all memory files with `type: consolidated`, check if their `consolidated_from` array contains the target ID. Record:
- File path
- Full `consolidated_from` array
- Number of other sources remaining

**3d. Association edges (`associations.json`):**
Read `~/.brain/associations.json`. Find all edges involving the target ID:
- Outgoing: `edges[target_id][*]`
- Incoming: `edges[*][target_id]`
Record each edge with its neighbor, weight, and origin.

**3e. Context sessions (`contexts.json`):**
Read `~/.brain/contexts.json`. Search all sessions for the target ID in:
- `memories_created` arrays
- `memories_recalled` arrays
Record each session timestamp and which array contained the reference.

**3f. Review queue (`review-queue.json`):**
Read `~/.brain/review-queue.json`. Check if any item has `memory_id` equal to the target ID.

**3g. Archive index (`_archived/index.json`):**
Read `~/.brain/_archived/index.json`. Check if the target ID exists as a key in `memories`.

**3h. Crystallization comments:**
Search all memory files for HTML comments matching the pattern:
```
<!-- Crystallized into <target_id> -->
```
This catches episodic memories that were crystallized into the target.

### 4. Identify Derivative Memories

Derivatives are memories that exist *because of* the target and may not make sense without it:

**4a. Sole crystallization derivatives:**
If the target is an episodic memory, search for semantic memories whose sole source is the target — identified by:
- Their `related` array contains the target ID
- A crystallization comment `<!-- Crystallized into <derivative_id> -->` exists in the target
- The derivative's creation was triggered by the target (check if the derivative has no other source memories in its `related` array besides the target)

**4b. Sole consolidation derivatives:**
If a consolidated memory's `consolidated_from` array contains the target ID and the target is its **only** remaining source (after removing the target, 0 sources remain), it's a sole derivative.

**4c. Chain following (with `--deep`):**
If `--deep` is set, recursively check each derivative for its own derivatives. Maintain a `visited` set to prevent infinite loops on circular references.

### 5. Visualize Blast Radius

Present the complete blast radius to the user:

```
## Blast Radius: "<title>" (<id>)

### TARGET (will be deleted)
  <id> | <path> | <type> | strength: <strength> | salience: <salience>

### DIRECT REFERENCES (will be cleaned) — <N> found
  [REL]  <path.md> — related: [..., <target_id>, ...]
  [BODY] <path.md> — "<matching line snippet>"
  [CONS] <path.md> — consolidated_from: [..., <target_id>, ...] (<M> sources remain)
  [EDGE] <target_id> <-> <other_id> (weight: <w>, origin: <origin>)
  [CTX]  Session <timestamp> — in <memories_created|memories_recalled>
  [REV]  Review queue entry (next_review: <date>)
  [ARCH] Archive index entry
  [CRYS] <path.md> — <!-- Crystallized into <target_id> -->

### DERIVATIVES (may cascade) — <N> found
  <derivative_id> | <path> — sole <crystallization|consolidation> derivative of target
  <explanation of why this is a derivative>

### CONSOLIDATED REPAIRS — <N> needed
  <path.md> — consolidated_from shrinks from <before> to <after> sources
  ⚠️ <path.md> — will have only 1 source remaining (flagged for review)

### SUMMARY
  Files to modify: <count>
  References to clean: <count>
  Derivatives found: <count>
  Risk level: <low|medium|high>
```

**Risk level:**
- **Low**: <=3 references, no derivatives
- **Medium**: 4-10 references, or derivatives present
- **High**: >10 references, or target has salience >= 0.7

If `--dry-run` is set, stop here. Print "Dry run complete — no changes made." and exit.

### 6. Confirm with User

**Standard confirmation:**
```
Proceed with erasure? This will modify <N> files and remove <M> references.
[yes / no / select specific items]
```

**High-salience confirmation** (salience >= 0.7):
```
⚠️ HIGH-SALIENCE MEMORY (salience: <value>)
This memory was marked as significant. To confirm erasure, type the memory ID:
> <user must type the ID>
```

**Derivative handling** (without `--cascade`):
For each derivative found, ask individually:
```
Derivative: "<derivative_title>" (<derivative_id>)
This memory was <crystallized from|solely consolidated from> the target.
  [delete] Remove this derivative too
  [keep]   Keep it (remove only the reference to target)
  [skip]   Skip — decide later
```

With `--cascade`, all derivatives are automatically included in the erasure.

### 7. Execute Erasure

Execute in this exact order (dependencies matter):

**7a. Handle derivatives first** (if `--deep` and user approved):
For each derivative marked for deletion, recursively apply steps 7b-7g. Process deepest derivatives first (reverse topological order) to avoid dangling references.

**7b. Repair consolidated memories** (if `--deep`):
For each consolidated memory that lists the target in `consolidated_from`:
- Remove the target ID from the `consolidated_from` array
- Remove the target ID from the `related` array
- If 0 sources remain: this was caught as a derivative in Step 4
- If 1 source remains: add a warning comment to the file:
  ```
  <!-- WARNING: This consolidated memory now has only 1 source after erasure of <target_id>. Consider reviewing. -->
  ```
- Update the corresponding `index.json` entry

**7c. Clean all direct references:**

1. **`related` arrays**: For each memory file containing the target ID in its `related` array, parse the frontmatter, remove the target ID from the array, and write the file back. Leave empty arrays as `related: []`.

2. **Content body mentions**: For each memory file with body mentions of the target ID or title:
   - Remove lines that are solely a reference to the target (e.g., `Related to the X decision (mem_20260215_a3f2c1)`)
   - In mixed-content lines, remove just the target reference (ID or parenthetical mention)
   - If a `## Connections` section becomes empty, remove the section header too

3. **Association edges**: Remove all edges involving the target from `associations.json`. Use the `removeEdgesForMemory()` utility from `index-manager.js`. Write the updated file.

4. **Context sessions**: In `contexts.json`, for each session containing the target ID:
   - Remove the target ID from `memories_created` and `memories_recalled` arrays
   - Do NOT delete the session itself (other memories may reference it)

5. **Review queue**: Remove the target's entry from `review-queue.json`. Use the `removeFromReviewQueue()` utility from `index-manager.js`. Write the updated file.

6. **Archive index**: If the target exists in `_archived/index.json`, remove its entry and decrement `archived_count`. Write the updated file.

7. **Crystallization comments**: For each memory file containing `<!-- Crystallized into <target_id> -->`, remove the comment line.

**7d. Remove from `index.json`:**
Remove the target memory from `index.json` using `removeMemory()` from `index-manager.js`. Write the updated file.

**7e. Update `_meta.json` files:**
For each directory in the target's path, read the `_meta.json` and decrement `memory_count`. Write the updated file.

**7f. Delete target file:**
- If `--sensitive`: first overwrite the file content with null bytes (same byte length as original), then delete
- Otherwise: delete the file directly
- Clean up empty parent directories (but never delete top-level category directories)

**7g. Remove archived copy:**
If an archived copy exists at `~/.brain/_archived/<original-path>`, delete it.
- If `--sensitive`: overwrite with null bytes before deletion
- Clean up empty directories in `_archived/`

### 8. Write Audit Log

Unless `--no-trace` is set, write or append to `~/.brain/_erased.json`:

```json
{
  "version": 1,
  "erasures": [
    {
      "erased_id": "<memory_id>",
      "erased_date": "<ISO timestamp>",
      "reason": "<user-provided reason or 'unspecified'>",
      "references_cleaned": <count>,
      "derivatives_removed": <count>,
      "consolidated_repaired": <count>,
      "flags_used": ["<flags that were active>"]
    }
  ]
}
```

If the file already exists, read it, append the new entry to the `erasures` array, and write back.

**IMPORTANT**: The audit log intentionally omits the memory title, content, tags, path, or any identifying information. It proves an erasure happened for audit purposes without preserving what was erased.

### 9. Post-Erasure Integrity Check

After erasure, perform a quick integrity scan:

1. **Dangling references**: Grep all memory files for the erased ID. If any remain, report them as warnings.
2. **Orphaned associations**: Check `associations.json` for any edges pointing to the erased ID.
3. **Index consistency**: Verify `memory_count` in `index.json` matches the actual number of entries in `memories`.
4. **Empty directories**: Report any empty directories that may need cleanup.

If any issues are found:
```
⚠️ Post-erasure integrity issues:
  - <description of issue>

These can be fixed by running /brain:sleep.
```

### 10. Confirm

Print a summary:

```
## Erasure Complete: "<title>"

  Memory deleted: <id>
  References cleaned: <count> across <file_count> files
  Derivatives removed: <count>
  Consolidated memories repaired: <count>
  Audit log: <written to _erased.json | skipped (--no-trace)>

  Brain stats: <total_memories> memories, average strength <avg>

  The memory has been fully erased. All traces have been removed
  from the associative network, context logs, review queue, and
  cross-references in other memories.
```

## Edge Cases

1. **Memory already archived**: Still perform the full blast radius scan. The target may have references in active memories, associations, contexts, and the review queue even though it's in the archive. Clean all references, then remove the archived copy.

2. **Memory not found**: Check `_erased.json` first. If found there, report the previous erasure date and reason. If not found anywhere, report clearly and suggest checking the ID/title spelling.

3. **Circular references**: When following derivative chains with `--deep`, maintain a `visited` set. If a memory has already been visited, skip it and note the cycle.

4. **High-salience memories (salience >= 0.7)**: Require double confirmation — the user must type the memory ID to proceed. This prevents accidental erasure of important memories.

5. **Consolidated memory loses ALL sources**: This is caught as a sole consolidation derivative in Step 4. With `--deep`, it's removed. Without `--deep`, warn prominently:
   ```
   ⚠️ CRITICAL: "<consolidated_title>" will have ZERO sources after erasure.
   This consolidated memory only existed because of the target.
   Recommend: use --deep to handle this, or manually review.
   ```

6. **Consolidated memory left with 1 source**: Add a warning comment to the file and flag in the output. The memory is still valid but may benefit from review.

7. **Empty `related` arrays after cleanup**: Leave as `related: []`. Do not remove the field entirely — it maintains schema consistency.

8. **Memory referenced by memories outside `~/.brain/`**: This command only operates within `~/.brain/`. If external files (e.g., `CLAUDE.md`, project docs) reference the memory, note this limitation in the summary.

9. **Multiple memories matching a title substring**: Present all matches with their IDs, paths, and strengths. Ask the user to select the specific memory to erase.

10. **Target is itself a consolidated memory**: Its `consolidated_from` sources (if archived) are NOT affected — they remain in the archive. Only forward references are cleaned.

## Important Rules

1. **Always confirm before executing**. Never erase without explicit user approval. High-salience memories require typing the ID.
2. **Order matters**. Follow the execution order in Step 7 exactly — derivatives first, then repairs, then references, then index, then file deletion.
3. **Audit by default**. Always write to `_erased.json` unless `--no-trace` is explicitly set. The audit log contains no identifying information about the erased memory.
4. **No collateral damage**. Only remove references to the specific target. Never modify content unrelated to the target memory.
5. **Preserve other memories' integrity**. When editing other memories' frontmatter or content, preserve all other fields and content exactly.
6. **Sensitive data handling**. With `--sensitive`, overwrite file content before deletion to prevent filesystem-level recovery.
7. **Integrity check is mandatory**. Always run the post-erasure integrity check, even if no issues are expected.
8. **Recursive safety**. When processing derivatives with `--deep --cascade`, always maintain a `visited` set to prevent infinite loops.
9. **Never delete top-level category directories**. Even if they become empty after erasure, preserve `professional/`, `personal/`, `social/`, `family/`, `_consolidated/`, and `_archived/`.
10. **Context sessions are preserved**. Remove memory IDs from session arrays, but never delete the session entry itself.
