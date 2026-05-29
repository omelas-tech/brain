---
description: Browse the brain memory hierarchy
argument-hint: "[category]"
---

# /brain:explore — Browse the Brain Structure

You are exploring the Brain Memory system's hierarchical structure. This gives the user a visual overview of their memory landscape.

**Target path:** $ARGUMENTS

## Steps

### 1. Determine Scope

- If $ARGUMENTS is empty, show the full top-level overview
- If $ARGUMENTS specifies a category or path (e.g., "professional" or "professional/companies"), explore that subtree

### 2. Read Structure

Read the directory structure of `~/.brain/` (or the specified subtree). For each directory, read its `_meta.json` to get metadata.

### 3. Display Tree View

Present the brain structure as a visual tree with statistics:

```
🧠 Brain Memory Overview
Last updated: <timestamp>
Total memories: <count>

~/.brain/
├── professional/ (12 memories)
│   ├── companies/ (8 memories)
│   │   ├── acme-corp/ (5 memories)
│   │   │   ├── projects/ (3 memories)
│   │   │   │   ├── alpha-launch.md ⚡ 0.82
│   │   │   │   ├── beta-planning.md ⚡ 0.65
│   │   │   │   └── tech-debt-review.md ⚡ 0.41
│   │   │   ├── team-dynamics.md ⚡ 0.70
│   │   │   └── joining-decision.md ⚡ 0.88
│   │   └── prev-startup/ (3 memories)
│   ├── skills/ (3 memories)
│   └── career/ (1 memory)
├── personal/ (6 memories)
│   ├── education/ (3 memories)
│   ├── health/ (2 memories)
│   └── goals/ (1 memory)
├── social/ (2 memories)
│   └── communities/ (2 memories)
├── family/ (3 memories)
│   └── events/ (3 memories)
└── _consolidated/ (1 memory)
```

The ⚡ indicator shows the current effective (decayed) strength of each memory.

### 4. Category Summary

For the explored scope, provide:
- **Strongest memory**: Title and path of the highest-strength memory
- **Most accessed**: Title and path of the most frequently recalled memory
- **Needs attention**: Memories with decayed strength below the consolidation threshold (0.3)
- **Recent additions**: Memories created in the last 7 days

### 5. Offer Navigation

Suggest next actions:
- "Use `/brain:explore <subcategory>` to drill deeper"
- "Use `/brain:remember <query>` to search for specific memories"
- "Use `/brain:consolidate <category>` to merge weak memories in a category"
- "Use `/brain:sleep` to reorganize, consolidate, and detect expertise areas"

### 6. Show Expertise (if available)

If any directories in the explored scope contain `_expertise.md` files, display a brief expertise summary:

```
## Expertise Areas
  🟢 Expert — professional/skills/flutter/authentication/ (0.85)
  🔵 Deep Knowledge — professional/skills/react/ (0.68)
  🟡 Working Knowledge — personal/education/psychology/ (0.45)
  ⚪ Awareness — social/communities/open-source/ (0.28)
```
