// Single source of truth for the documentation page registry.
//
// Consumed by:
//   - src/lib/docs.ts          (typed nav + docMeta helper for the app)
//   - src/app/sitemap.ts       (URL list)
//   - scripts/build-search-index.mjs
//   - scripts/build-llms.mjs   (llms.txt / llms-full.txt)
//
// Keep this list complete and in sync with the actual MDX files under
// src/app/docs/. The `dir` of each page is derived from its `href`.

export const SITE_URL = "https://brainmemory.ai";

/** @typedef {{ title: string, description: string, href: string, category: string, order: number }} DocPage */

/** @type {DocPage[]} */
export const docPages = [
  // Getting Started
  {
    title: "Overview",
    description:
      "Introduction to Brain Memory — a neuroscience-inspired memory system for AI coding agents.",
    href: "/docs",
    category: "Getting Started",
    order: 0,
  },
  {
    title: "Installation",
    description:
      "Install the Brain Memory plugin for Claude Code, Gemini CLI, or OpenAI Codex.",
    href: "/docs/getting-started/installation",
    category: "Getting Started",
    order: 1,
  },
  {
    title: "Quick Start",
    description: "Get up and running with Brain Memory in under 5 minutes.",
    href: "/docs/getting-started/quick-start",
    category: "Getting Started",
    order: 2,
  },
  {
    title: "Use Brain in Claude apps",
    description: "Recall your brain from Claude on the web, desktop, and your phone via the Brain connector (remote MCP).",
    href: "/docs/getting-started/claude-apps",
    category: "Getting Started",
    order: 3,
  },

  // Concepts
  {
    title: "Memory Types",
    description:
      "Learn about the 8 memory types: decision, insight, goal, experience, learning, relationship, preference, and observation.",
    href: "/docs/concepts/memory-types",
    category: "Concepts",
    order: 0,
  },
  {
    title: "Cognitive Types",
    description:
      "Understand episodic, semantic, and procedural memory — modeled after human cognition.",
    href: "/docs/concepts/cognitive-types",
    category: "Concepts",
    order: 1,
  },
  {
    title: "Strength & Decay",
    description:
      "How memories strengthen through recall and weaken over time via exponential decay.",
    href: "/docs/concepts/strength-decay",
    category: "Concepts",
    order: 2,
  },
  {
    title: "Associative Network",
    description:
      "Memories connect via weighted edges with spreading activation and Hebbian learning.",
    href: "/docs/concepts/associative-network",
    category: "Concepts",
    order: 3,
  },
  {
    title: "Context-Dependent Recall",
    description:
      "Memories encoded in a similar context to the current session are scored higher during recall.",
    href: "/docs/concepts/context-recall",
    category: "Concepts",
    order: 4,
  },
  {
    title: "Salience & Confidence",
    description:
      "Emotional significance and epistemic certainty scores that influence memory behavior.",
    href: "/docs/concepts/salience-confidence",
    category: "Concepts",
    order: 5,
  },
  {
    title: "Pinned Memory",
    description:
      "Pin critical conventions and preferences to the always-present tier — loaded every session, never decaying.",
    href: "/docs/concepts/pinned-memory",
    category: "Concepts",
    order: 6,
  },
  {
    title: "Procedural Skills",
    description:
      "Reusable how-to workflows served via progressive disclosure and learned from repeated experience.",
    href: "/docs/concepts/procedural-skills",
    category: "Concepts",
    order: 7,
  },

  // Commands — the everyday loop (remember/memorize) is ambient; the rest is a
  // small manual surface plus a background maintenance job.
  {
    title: "remember",
    description:
      "Recall relevant memories using spreading activation and context-dependent scoring.",
    href: "/docs/commands/remember",
    category: "Commands",
    order: 0,
  },
  {
    title: "memorize",
    description:
      "Store new memories from the current session context with automatic categorization.",
    href: "/docs/commands/memorize",
    category: "Commands",
    order: 1,
  },
  {
    title: "status",
    description:
      "Dashboard with brain health overview, memory counts, and strength distribution.",
    href: "/docs/commands/status",
    category: "Commands",
    order: 2,
  },
  {
    title: "pin",
    description:
      "Pin a memory to the always-present tier — loaded every session, never decaying. Toggles: also unpins.",
    href: "/docs/commands/pin",
    category: "Commands",
    order: 3,
  },
  {
    title: "forget",
    description:
      "Decay or archive memories. With --deep, performs forensic erasure — traces and removes every reference.",
    href: "/docs/commands/forget",
    category: "Commands",
    order: 4,
  },
  {
    title: "sync",
    description:
      "Sync via Brain Cloud, Git remote, or export/import (auto-initializes the brain on first run).",
    href: "/docs/commands/sync",
    category: "Commands",
    order: 5,
  },
  {
    title: "skill",
    description:
      "Manage procedural skills — reusable how-to workflows with progressive disclosure.",
    href: "/docs/commands/skill",
    category: "Commands",
    order: 6,
  },
  {
    title: "sleep",
    description:
      "Full maintenance cycle: replay, homeostasis, consolidation, review reinforcement, pruning, and REM dreaming. Usually runs in the background.",
    href: "/docs/commands/sleep",
    category: "Commands",
    order: 7,
  },

  // Advanced
  {
    title: "Scoring Formula",
    description:
      "The v4 recall scoring formula: relevance, decayed strength, recency, spreading bonus, context match, and salience.",
    href: "/docs/advanced/scoring-formula",
    category: "Advanced",
    order: 0,
  },
  {
    title: "Spaced Reinforcement",
    description:
      "How recall spacing affects strength boosts and decay rate improvements.",
    href: "/docs/advanced/spaced-reinforcement",
    category: "Advanced",
    order: 1,
  },
  {
    title: "Sleep Cycle",
    description:
      "Deep dive into the sleep maintenance cycle: replay, homeostasis, crystallization, and dreaming.",
    href: "/docs/advanced/sleep-cycle",
    category: "Advanced",
    order: 2,
  },
  {
    title: "Cross-Agent Sharing",
    description:
      "Share memories across Claude Code, Gemini CLI, and OpenAI Codex agents.",
    href: "/docs/advanced/cross-agent",
    category: "Advanced",
    order: 3,
  },
  {
    title: "Portable Sync",
    description:
      "Git-based sync and encrypted export/import for cross-device memory portability.",
    href: "/docs/advanced/portable-sync",
    category: "Advanced",
    order: 4,
  },
  {
    title: "Working Memory & Session Start",
    description:
      "How Brain feeds the context window at session start through a single budget-bounded aggregator that never overflows working memory.",
    href: "/docs/advanced/working-memory",
    category: "Advanced",
    order: 5,
  },

  // Reference
  {
    title: "File Structure",
    description:
      "Complete reference for the ~/.brain/ directory layout and file organization.",
    href: "/docs/reference/file-structure",
    category: "Reference",
    order: 0,
  },
  {
    title: "Memory File Format",
    description:
      "YAML frontmatter schema and Markdown body format for memory files.",
    href: "/docs/reference/memory-format",
    category: "Reference",
    order: 1,
  },
  {
    title: "Configuration",
    description:
      "Configuration options for decay rates, scoring weights, and sync settings.",
    href: "/docs/reference/configuration",
    category: "Reference",
    order: 2,
  },
  {
    title: "Changelog",
    description:
      "Release history and version notes for the Brain Memory plugin.",
    href: "/docs/reference/changelog",
    category: "Reference",
    order: 3,
  },

  // Benchmarks
  {
    title: "Overview",
    description:
      "Controlled benchmark suite proving Brain Memory improves retrieval, contradiction handling, and token efficiency for AI coding agents.",
    href: "/docs/benchmarks",
    category: "Benchmarks",
    order: 0,
  },
  {
    title: "Methodology",
    description:
      "How retrieval is scored, why the judge is cross-family, distractor haystacks, and references to the 2025-2026 SOTA the design follows.",
    href: "/docs/benchmarks/methodology",
    category: "Benchmarks",
    order: 1,
  },
  {
    title: "Scenarios",
    description:
      "The six benchmark scenarios — each describable in one sentence — with project fixtures, rubrics, and arm matrices.",
    href: "/docs/benchmarks/scenarios",
    category: "Benchmarks",
    order: 2,
  },
  {
    title: "Results",
    description:
      "Current measurements from the benchmark suite, with raw JSON downloads.",
    href: "/docs/benchmarks/results",
    category: "Benchmarks",
    order: 3,
  },
];

export const categoryOrder = {
  "Getting Started": 0,
  Concepts: 1,
  Commands: 2,
  Advanced: 3,
  Reference: 4,
  Benchmarks: 5,
};

/**
 * Derive the MDX directory (relative to src/app/docs/) for a page from its href.
 * "/docs" -> "" ; "/docs/commands/init" -> "commands/init".
 * @param {DocPage} page
 * @returns {string}
 */
export function dirForPage(page) {
  return page.href.replace(/^\/docs\/?/, "");
}
