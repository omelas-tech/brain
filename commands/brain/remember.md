---
description: Recall relevant memories with spreading activation and context matching
argument-hint: "[query]"
---

# /brain:remember — Recall Relevant Memories

You are recalling memories from the Brain Memory system. This command uses the **deterministic recall engine** (`brain recall`) to score and rank memories, then presents the results.

**User query:** $ARGUMENTS

## Steps

### 1. Determine Context

Identify the current session context:

```yaml
recall_context:
  project: <current project name>
  topics: [<key topics from query and session>]
  task_type: <debugging|implementing|designing|reviewing|discussing|learning>
```

### 2. Run the Recall Engine

Execute the recall CLI to get deterministically scored results:

```bash
node <brain-memory-install-path>/bin/recall.js "$ARGUMENTS" \
  --project "<project>" \
  --task "<task_type>" \
  --topics "<topic1,topic2>" \
  --top 10
```

If the brain-memory package is installed globally, use:
```bash
brain recall "$ARGUMENTS" --project "<project>" --task "<task_type>" --top 10
```

The engine computes **TF-IDF relevance** (cosine similarity between query and memory content), then combines it with decayed strength, recency, spreading activation, context match, and salience using the v4 formula. All scoring is deterministic — same query always produces the same ranking.

### 3. Read Top Memories

Parse the JSON output. For the top results (score > 0.3), read the actual memory files from `~/.brain/<path>` to get full content.

### 4. Decide Response Strategy

Based on the scored results:

**Case A — Single strong match (top score > 0.7 and 2x higher than second):**
Return the full memory content directly.

**Case B — Multiple related memories (2-5 candidates with scores > 0.4):**
Read all candidate memory files and synthesize a **consolidated response** that:
- Weaves together insights from all relevant memories
- Notes which memories contributed (by ID and title)
- Highlights patterns or evolution across memories

**Case C — Many weak matches (>5 candidates, all scores < 0.4):**
List the top 5-7 memories with titles, paths, types, and scores.
Ask the user which ones they'd like to explore in detail.

**Case D — No matches:**
Search `~/.brain/_archived/` via the archive index. If archived matches found, present them and offer to restore. Otherwise suggest different keywords, or browsing the memory tree directly under `~/.brain/`.

### 5. Reinforce Retrieved Memories

After presenting results, run the reinforcement engine for all memories shown to the user:

```bash
node <brain-memory-install-path>/bin/reinforce.js <mem_id1> <mem_id2> ...
```

Or if globally installed:
```bash
brain reinforce <mem_id1> <mem_id2> ...
```

This deterministically applies:
- **Spaced reinforcement** — strength boost based on time since last access
- **Decay rate improvement** — memories become more forgetting-resistant
- **Hebbian co-retrieval** — strengthens association edges between all returned memories

### 6. Present Results

Format the output clearly. Include confidence indicators for low-confidence memories.

```
## Recalled Memory: <Title>

**Path:** ~/.brain/<path>
**Strength:** <decayed_strength> (original: <base_strength>)
**Score:** <score> (relevance: <relevance>, context: <context_match>)
**Type:** <type> (<cognitive_type>) | **Created:** <date> | **Recalled:** <access_count> times
**Confidence:** <confidence> <show warning if < 0.5>

<memory content>

---
*Memory reinforced — strength updated, decay improved*
```

For consolidated responses (Case B):

```
## Synthesized from <N> memories

<consolidated narrative>

### Contributing Memories
1. **<title>** (~/.brain/<path>) — score: <score>
2. **<title>** (~/.brain/<path>) — score: <score>
...

---
*<N> memories reinforced, association links strengthened*
```
