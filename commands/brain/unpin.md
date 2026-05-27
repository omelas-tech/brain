# /brain:unpin — Remove a Memory from the Always-Present Tier

You are unpinning a memory. It will no longer load automatically at session start and returns to normal recall + decay (an independent `stable` flag, if set, is left untouched).

**User input:** $ARGUMENTS

## Behavior

1. **Resolve the target:**
   - If `$ARGUMENTS` is a memory ID (`mem_...`), use it directly.
   - Otherwise inspect `~/.brain/pinned.json` (the list of current pins) or run `brain recall "$ARGUMENTS" --top 5`, and confirm which pin to remove.

2. **Unpin it:**
   ```bash
   brain unpin <id>
   ```

3. Confirm:
   ```
   📌 Unpinned <title> — no longer auto-loaded.
   ```
