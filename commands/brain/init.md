---
description: Initialize the brain memory structure
---

# /brain:init — Initialize Brain Memory Structure

You are initializing the Brain Memory system. This creates a `~/.brain/` directory that serves as a hierarchical, file-system-based memory store inspired by human cognition.

## Steps

### 1. Check for Existing Brain

Check if `~/.brain/` directory already exists in the user's home directory.

- If it exists, inform the user and ask if they want to reset or keep it.
- If not, proceed with creation.

### 2. Create Directory Structure

Create the following structure:

```
~/.brain/
├── index.json
├── associations.json
├── contexts.json
├── review-queue.json
├── professional/
│   └── _meta.json
├── personal/
│   └── _meta.json
├── social/
│   └── _meta.json
├── family/
│   └── _meta.json
├── _consolidated/
│   └── _meta.json
└── _archived/
    └── index.json
```

### 3. Create index.json

```json
{
  "version": 2,
  "created": "<current ISO timestamp>",
  "last_updated": "<current ISO timestamp>",
  "memory_count": 0,
  "memories": {},
  "config": {
    "max_depth": 6,
    "consolidation_threshold": 0.3,
    "decay_check_interval_days": 7,
    "strength_boost_on_recall": 0.05,
    "auto_consolidate": true,
    "propagation_window_days": 7,
    "association_config": {
      "co_retrieval_boost": 0.10,
      "link_decay_rate": 0.998,
      "link_prune_threshold": 0.05,
      "spreading_activation_depth": 2,
      "spreading_activation_decay": 0.5
    }
  }
}
```

### 4. Create associations.json

The associative network stores weighted connections between memories — implementing spreading activation (like neurons activating linked memories) and Hebbian learning (memories that fire together wire together).

```json
{
  "version": 1,
  "edges": {}
}
```

### 5. Create contexts.json

Stores session-level context snapshots used for context-dependent recall — memories encoded in a similar context to the current one are scored higher.

```json
{
  "version": 1,
  "sessions": []
}
```

### 6. Create review-queue.json

Implements spaced repetition scheduling — surfaces memories for review at optimal intervals to maximize long-term retention.

```json
{
  "version": 1,
  "items": []
}
```

### 7. Create _archived/index.json

A searchable index of archived memories so they can be found and restored if needed.

```json
{
  "version": 1,
  "archived_count": 0,
  "memories": {}
}
```

### 8. Create _meta.json for Each Top Category

For each top-level category (professional, personal, social, family, _consolidated), create a `_meta.json`:

```json
{
  "category": "<category_name>",
  "description": "<description from defaults>",
  "created": "<current ISO timestamp>",
  "memory_count": 0,
  "subcategories": []
}
```

### 9. Ask User for Customization (Optional)

Ask the user:
- "Would you like to add any custom top-level categories beyond the defaults (professional, personal, social, family)?"
- "Do you have specific subcategories you'd like pre-created? (e.g., a company name under professional/companies/)"

If the user provides custom categories or subcategories, create them with appropriate `_meta.json` files.

### 10. Add .brain to .gitignore (Optional)

Ask the user if they want `~/.brain/` added to `.gitignore` (some users may want to track their memory in git, others may not).

### 11. Confirm

Print a summary of what was created, including the full tree structure. Inform the user of available commands:

- `/brain:memorize` — Store a new memory
- `/brain:remember` — Recall relevant memories
- `/brain:explore` — Browse the brain structure
- `/brain:consolidate` — Merge related memories
- `/brain:forget` — Decay or remove memories
- `/brain:sunshine` — Deep forensic erasure: trace and remove all references to a memory
- `/brain:sleep` — Overnight reorganization: restructure, consolidate, prune, and detect expertise areas
- `/brain:status` — View brain overview
- `/brain:review` — Spaced repetition review of memories due for reinforcement

