---
description: Decay, archive, or forensically erase memories
argument-hint: "[target] [--deep]"
---

# /brain:forget — Decay, Remove, or Forensically Erase Memories

You are managing memory removal in the Brain Memory system. This command accelerates
forgetting for specific memories, prunes naturally-decayed memories, or — with `--deep` —
performs **forensic erasure** that traces and removes every reference to a memory across the
entire `~/.brain/` tree.

**Target:** $ARGUMENTS

## Modes

| Invocation | Mode |
|------------|------|
| `/brain:forget <query>` | **A — Targeted forget**: decay or remove memories matching a query |
| `/brain:forget --prune [threshold]` | **B — Threshold prune**: archive memories below a decayed-strength threshold (default 0.2) |
| `/brain:forget <category/path>` | **C — Category prune**: decay/remove an entire subtree |
| `/brain:forget --deep <target>` | **D — Forensic erasure**: trace + remove every reference to a memory (see "Deep mode" below) |

---

## Modes A–C — Decay & Archive

### 1. Determine Mode

Based on $ARGUMENTS, select Mode A, B, or C. If `--deep` is present, jump to **Deep mode**.

### 2. Find Affected Memories

Read `index.json` and compute effective (decayed) strength for each candidate:

```
days_elapsed = (now - last_accessed) / (1000 * 60 * 60 * 24)
decayed_strength = strength * (decay_rate ^ days_elapsed)
```

For Mode A: Match query against titles, tags, and paths.
For Mode B: Filter by decayed strength < threshold.
For Mode C: Filter by path prefix.

**Salience protection**: Flag any memories with `salience >= 0.7` — these require explicit
confirmation and are never included in bulk prune operations.

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
- **Forensic erase**: Use `/brain:forget --deep` to also scrub all cross-references (for secrets)
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

If any remaining memories in the affected area are also weak (decayed strength < 0.4), suggest
running `/brain:sleep` — its consolidation pass preserves the knowledge in a more durable
combined form before it fades.

### 7. Confirm

Print summary:
- Number of memories affected
- Action taken (archived/accelerated/deleted)
- Current brain stats (total memories, average strength)
- Archive searchability note: "Archived memories are searchable via /brain:remember if needed in the future"

---

## Deep mode — `/brain:forget --deep` (Forensic Erasure)

Like the procedure in *Eternal Sunshine of the Spotless Mind*, deep mode doesn't just delete a
memory — it traces every ripple that memory left across the entire `~/.brain/` tree and
surgically removes or repairs each one. When complete, it's as if the memory never existed.

Use this for erasing accidentally stored credentials, removing a deprecated anti-pattern that
leaked into other memories, or cleaning up after a fully reversed technical decision.

### Deep-mode flags

| Flag | Behavior |
|------|----------|
| `--deep` | Enter forensic erasure: remove target + clean all references; follow derivative chains, asking about each |
| `--dry-run` | Show blast radius only — no changes are made |
| `--cascade` | Auto-remove derivative memories without asking |
| `--sensitive` | Overwrite file content with null bytes before deletion (for credentials, secrets) |
| `--no-trace` | Skip writing to `_erased.json` audit log |
| `--reason "<text>"` | Reason recorded in the audit log entry |

### 1. Parse Target and Flags

Extract the **target identifier** (memory ID like `mem_20260215_a3f2c1`, title substring, or
file path) and any flags. If no target is provided, ask the user what memory to erase.

### 2. Locate Target Memory

1. Read `~/.brain/index.json` and search `memories` by exact ID, title substring
   (case-insensitive), or path substring.
2. If not found in active memories, check `~/.brain/_archived/index.json`.
3. If still not found, check `~/.brain/_erased.json` — if found there, report the previous
   erasure date + reason and stop ("No further action needed").
4. If not found anywhere, report and stop.
5. If multiple matches, present them and ask the user to pick one.

Once located, read the full memory file to capture its ID, title, path, tags, `related` array,
`consolidated_from` array, and content.

### 3. Trace All References (Blast Radius Scan)

Scan the entire `~/.brain/` tree for every trace of the target. Track 8 reference types:

**3a. `related` arrays** — parse the YAML frontmatter of every `.md` memory file; record any
whose `related` array contains the target ID (with the current array contents).

**3b. Content body mentions** — search the Markdown body of all memory files for the target ID
and the target title (exact). Record each file path and matching line.

**3c. `consolidated_from` arrays** — among memories with `type: consolidated`, record any whose
`consolidated_from` contains the target ID, plus how many other sources remain.

**3d. Association edges** (`associations.json`) — find outgoing `edges[target_id][*]` and
incoming `edges[*][target_id]`; record each with neighbor, weight, origin.

**3e. Context sessions** (`contexts.json`) — record any session with the target ID in
`memories_created` or `memories_recalled`.

**3f. Review queue** (`review-queue.json`) — check for an item with `memory_id == target`.

**3g. Archive index** (`_archived/index.json`) — check if the target ID exists as a key.

**3h. Crystallization comments** — search all files for `<!-- Crystallized into <target_id> -->`.

### 4. Identify Derivative Memories

Derivatives exist *because of* the target and may not make sense without it:

**4a. Sole crystallization derivatives** — semantic memories whose sole source is the target
(their `related` contains the target, a crystallization comment links them, and they have no
other source memories).

**4b. Sole consolidation derivatives** — a consolidated memory whose `consolidated_from`
contains the target and the target is its **only** remaining source (0 sources after removal).

**4c. Chain following** — recursively check each derivative for its own derivatives. Maintain a
`visited` set to prevent infinite loops on circular references.

### 5. Visualize Blast Radius

Present the complete blast radius:

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

### CONSOLIDATED REPAIRS — <N> needed
  <path.md> — consolidated_from shrinks from <before> to <after> sources
  ⚠️ <path.md> — will have only 1 source remaining (flagged for review)

### SUMMARY
  Files to modify: <count>   References to clean: <count>
  Derivatives found: <count>   Risk level: <low|medium|high>
```

**Risk level:** Low (<=3 refs, no derivatives) · Medium (4–10 refs, or derivatives present) ·
High (>10 refs, or target salience >= 0.7).

If `--dry-run` is set, stop here. Print "Dry run complete — no changes made." and exit.

### 6. Confirm with User

**Standard:** `Proceed with erasure? This will modify <N> files and remove <M> references. [yes / no / select specific items]`

**High-salience (salience >= 0.7):** require the user to type the memory ID to confirm.

**Derivative handling** (without `--cascade`): for each derivative, ask individually whether to
delete it too, keep it (remove only the reference to target), or skip. With `--cascade`, all
derivatives are automatically included.

### 7. Execute Erasure

Execute in this exact order (dependencies matter):

**7a. Handle derivatives first** (if approved): recursively apply 7b–7g, processing deepest
derivatives first (reverse topological order) to avoid dangling references.

**7b. Repair consolidated memories**: for each consolidated memory listing the target in
`consolidated_from`, remove the target from `consolidated_from` and `related`. If 1 source
remains, add `<!-- WARNING: only 1 source remains after erasure of <target_id>. Review. -->`.
Update the `index.json` entry.

**7c. Clean all direct references:**
1. **`related` arrays** — remove the target ID; leave empty arrays as `related: []`.
2. **Content body mentions** — remove reference-only lines; in mixed lines remove just the
   target reference; drop a `## Connections` header if it becomes empty.
3. **Association edges** — use `removeEdgesForMemory()` from `index-manager.js`; write the file.
4. **Context sessions** — remove the target ID from `memories_created`/`memories_recalled`;
   never delete the session entry itself.
5. **Review queue** — use `removeFromReviewQueue()` from `index-manager.js`.
6. **Archive index** — remove the entry and decrement `archived_count` if present.
7. **Crystallization comments** — remove the comment line from each file.

**7d. Remove from `index.json`** using `removeMemory()` from `index-manager.js`.

**7e. Update `_meta.json` files** — decrement `memory_count` for each directory in the path.

**7f. Delete target file** — with `--sensitive`, overwrite with null bytes (same byte length)
before deleting; otherwise delete directly. Clean up empty parent dirs (never top-level ones).

**7g. Remove archived copy** if one exists (overwrite first under `--sensitive`).

### 8. Write Audit Log

Unless `--no-trace` is set, append to `~/.brain/_erased.json`:

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

**IMPORTANT**: The audit log intentionally omits the title, content, tags, and path — it proves
an erasure happened without preserving what was erased.

### 9. Post-Erasure Integrity Check

Scan for: dangling references (grep all files for the erased ID), orphaned associations, index
consistency (`memory_count` matches actual entries), and empty directories. If issues are found,
report them and note they can be fixed by running `/brain:sleep`.

### 10. Confirm

```
## Erasure Complete: "<title>"

  Memory deleted: <id>
  References cleaned: <count> across <file_count> files
  Derivatives removed: <count>
  Consolidated memories repaired: <count>
  Audit log: <written to _erased.json | skipped (--no-trace)>

  Brain stats: <total_memories> memories, average strength <avg>
```

### Deep-mode rules

1. **Always confirm before executing.** High-salience memories require typing the ID.
2. **Order matters.** Follow Step 7 exactly — derivatives, repairs, references, index, deletion.
3. **Audit by default.** Always write `_erased.json` unless `--no-trace`; the log carries no
   identifying information.
4. **No collateral damage.** Only remove references to the specific target.
5. **Preserve other memories' integrity** when editing their frontmatter or content.
6. **Sensitive data** — with `--sensitive`, overwrite before deletion to prevent recovery.
7. **Integrity check is mandatory.**
8. **Recursive safety** — maintain a `visited` set with `--cascade`.
9. **Never delete top-level category directories** even if empty.
10. **Context sessions are preserved** — remove IDs from arrays, never the session itself.
