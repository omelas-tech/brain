---
name: brain-remember
description: Recall the user's persistent memories from their global brain (~/.brain) with the brain CLI's deterministic recall engine. Use when the user asks what you remember, references past decisions, preferences, people, projects, or prior sessions, or when context from previous work would clearly help the current task.
license: MIT
---

# Brain Memory — Recall

The user has a persistent, neuroscience-inspired memory system: a single
global `~/.brain/` directory shared across all their AI agents. Memories are
Markdown files with YAML frontmatter (type, cognitive type, strength, decay,
salience, confidence, tags, associations). Recalled memories get stronger;
ignored ones fade. Use the `brain` CLI for every operation — never compute
scores or edit memory metadata by hand.

Set `BRAIN_AGENT=copilot-cli` in the environment of every `brain` invocation
so recalls record their host agent.

## Steps

1. **Run the deterministic recall engine:**

   ```bash
   BRAIN_AGENT=copilot-cli brain recall "<query>" --project "<project>" --task "<task_type>" --top 10
   ```

   Use the current repository/directory name as `<project>` and one of
   `debugging|implementing|designing|reviewing|discussing|learning` as
   `<task_type>`. The engine returns a scored JSON array (`id`, `title`,
   `path`, `type`, `score`, `relevance`, `decayed_strength`, `context_match`,
   `confidence`, `tags`). Scoring combines TF-IDF relevance, decayed strength,
   spreading activation, context match, and salience — the same ranking on
   every agent.

2. **Read the memory bodies** for the top results (score > 0.3) from
   `~/.brain/<path>`.

3. **Decide how to respond:**
   - One dominant match (score > 0.7 and about 2x the runner-up) — present it
     fully.
   - Several related matches (scores > 0.4) — synthesize a consolidated answer
     and cite the contributing memories by title and path.
   - Only weak matches — list the top 5-7 titles/paths and ask which to
     explore.
   - No matches — check `~/.brain/_archived/`, then suggest other keywords.

4. **After presenting results, always reinforce** what you showed:

   ```bash
   BRAIN_AGENT=copilot-cli brain reinforce <id1> <id2> ...
   ```

   This applies spaced reinforcement (longer gap since last recall → bigger
   boost), improves decay resistance, and strengthens Hebbian links between
   co-recalled memories.

5. **Flag low-confidence memories** (`confidence < 0.5`) as unverified when
   presenting them.

If the `brain` command is not found, tell the user once:
install with `npm install -g brain-memory`.
