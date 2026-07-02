---
description: Recall relevant memories from the global brain (~/.brain) with deterministic scoring
---

# /brain-remember — Recall Relevant Memories

Treat any text the user typed after the command as the recall query. If no
query was given, infer one from the current conversation.

The user has a persistent, neuroscience-inspired memory system: a single
global `~/.brain/` directory shared across all their AI agents. Use the
`brain` CLI for every operation — never compute scores or edit memory
metadata by hand.

## Steps

1. **Run the deterministic recall engine:**

   ```bash
   brain recall "<query>" --project "<project>" --task "<task_type>" --top 10
   ```

   Use the current repository/directory name as `<project>` and one of
   `debugging|implementing|designing|reviewing|discussing|learning` as
   `<task_type>`. The engine returns a scored JSON array (`id`, `title`,
   `path`, `type`, `score`, `relevance`, `decayed_strength`,
   `context_match`, `confidence`, `tags`) combining TF-IDF relevance,
   decayed strength, spreading activation, context match, and salience.

2. **Read the memory bodies** for the top results (score > 0.3) from
   `~/.brain/<path>`.

3. **Decide how to respond:**
   - One dominant match (score > 0.7 and about 2x the runner-up) — present
     it fully.
   - Several related matches (scores > 0.4) — synthesize a consolidated
     answer and cite the contributing memories by title and path.
   - Only weak matches — list the top 5-7 titles/paths and ask which to
     explore.
   - No matches — check `~/.brain/_archived/`, then suggest other keywords.

4. **After presenting results, always reinforce** what you showed:

   ```bash
   brain reinforce <id1> <id2> ...
   ```

   This applies spaced reinforcement, improves decay resistance, and
   strengthens Hebbian links between co-recalled memories.

5. **Flag low-confidence memories** (`confidence < 0.5`) as unverified.

Notes: the Brain Memory Kilo plugin sets `BRAIN_AGENT=kilo` on shell
commands automatically; if the plugin is not installed, prefix invocations
with `BRAIN_AGENT=kilo`. If the `brain` command is not found, tell the user
once: install with `npm install -g brain-memory`.
