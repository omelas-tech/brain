import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const docsDir = join(root, "src", "app", "docs");
const outPath = join(root, "public", "search-index.json");

/**
 * All documentation pages for the Brain Memory website.
 * Each entry maps to an MDX file under src/app/docs/.
 */
const pages = [
  // Getting Started
  {
    title: "Overview",
    description:
      "Introduction to Brain Memory — a neuroscience-inspired memory system for AI coding agents.",
    href: "/docs",
    category: "Getting Started",
    dir: "",
  },
  {
    title: "Installation",
    description:
      "Install the Brain Memory plugin for Claude Code, Gemini CLI, or OpenAI Codex.",
    href: "/docs/getting-started/installation",
    category: "Getting Started",
    dir: "getting-started/installation",
  },
  {
    title: "Quick Start",
    description:
      "Get up and running with Brain Memory in under 5 minutes.",
    href: "/docs/getting-started/quick-start",
    category: "Getting Started",
    dir: "getting-started/quick-start",
  },

  // Concepts
  {
    title: "Memory Types",
    description:
      "Learn about the 8 memory types: decision, insight, goal, experience, learning, relationship, preference, and observation.",
    href: "/docs/concepts/memory-types",
    category: "Concepts",
    dir: "concepts/memory-types",
  },
  {
    title: "Cognitive Types",
    description:
      "Understand episodic, semantic, and procedural memory — modeled after human cognition.",
    href: "/docs/concepts/cognitive-types",
    category: "Concepts",
    dir: "concepts/cognitive-types",
  },
  {
    title: "Strength & Decay",
    description:
      "How memories strengthen through recall and weaken over time via exponential decay.",
    href: "/docs/concepts/strength-decay",
    category: "Concepts",
    dir: "concepts/strength-decay",
  },
  {
    title: "Associative Network",
    description:
      "Memories connect via weighted edges with spreading activation and Hebbian learning.",
    href: "/docs/concepts/associative-network",
    category: "Concepts",
    dir: "concepts/associative-network",
  },
  {
    title: "Context-Dependent Recall",
    description:
      "Memories encoded in a similar context to the current session are scored higher during recall.",
    href: "/docs/concepts/context-recall",
    category: "Concepts",
    dir: "concepts/context-recall",
  },
  {
    title: "Salience & Confidence",
    description:
      "Emotional significance and epistemic certainty scores that influence memory behavior.",
    href: "/docs/concepts/salience-confidence",
    category: "Concepts",
    dir: "concepts/salience-confidence",
  },
  {
    title: "Pinned Memory",
    description:
      "Pin critical conventions and preferences to the always-present tier — loaded every session, never decaying.",
    href: "/docs/concepts/pinned-memory",
    category: "Concepts",
    dir: "concepts/pinned-memory",
  },
  {
    title: "Procedural Skills",
    description:
      "Reusable how-to workflows served via progressive disclosure and learned from repeated experience.",
    href: "/docs/concepts/procedural-skills",
    category: "Concepts",
    dir: "concepts/procedural-skills",
  },

  // Commands
  {
    title: "init",
    description:
      "Initialize the ~/.brain/ directory structure and default configuration.",
    href: "/docs/commands/init",
    category: "Commands",
    dir: "commands/init",
  },
  {
    title: "memorize",
    description:
      "Store new memories from the current session context with automatic categorization.",
    href: "/docs/commands/memorize",
    category: "Commands",
    dir: "commands/memorize",
  },
  {
    title: "remember",
    description:
      "Recall relevant memories using spreading activation and context-dependent scoring.",
    href: "/docs/commands/remember",
    category: "Commands",
    dir: "commands/remember",
  },
  {
    title: "pin",
    description:
      "Pin a memory to the always-present tier — loaded every session, never decaying.",
    href: "/docs/commands/pin",
    category: "Commands",
    dir: "commands/pin",
  },
  {
    title: "unpin",
    description:
      "Remove a memory from the always-present tier, returning it to normal recall and decay.",
    href: "/docs/commands/unpin",
    category: "Commands",
    dir: "commands/unpin",
  },
  {
    title: "review",
    description:
      "Spaced repetition review session for memories due for reinforcement.",
    href: "/docs/commands/review",
    category: "Commands",
    dir: "commands/review",
  },
  {
    title: "explore",
    description:
      "Browse the brain hierarchy and discover memories by category.",
    href: "/docs/commands/explore",
    category: "Commands",
    dir: "commands/explore",
  },
  {
    title: "consolidate",
    description:
      "Merge related weak memories into stronger combined memories.",
    href: "/docs/commands/consolidate",
    category: "Commands",
    dir: "commands/consolidate",
  },
  {
    title: "forget",
    description:
      "Decay or archive memories that are no longer relevant.",
    href: "/docs/commands/forget",
    category: "Commands",
    dir: "commands/forget",
  },
  {
    title: "sunshine",
    description:
      "Deep forensic erasure — trace and remove all references to a memory.",
    href: "/docs/commands/sunshine",
    category: "Commands",
    dir: "commands/sunshine",
  },
  {
    title: "sleep",
    description:
      "Full maintenance cycle: replay, synaptic homeostasis, consolidation, pruning, and REM dreaming.",
    href: "/docs/commands/sleep",
    category: "Commands",
    dir: "commands/sleep",
  },
  {
    title: "status",
    description:
      "Dashboard with brain health overview, memory counts, and strength distribution.",
    href: "/docs/commands/status",
    category: "Commands",
    dir: "commands/status",
  },
  {
    title: "skill",
    description:
      "Manage procedural skills — reusable how-to workflows with progressive disclosure.",
    href: "/docs/commands/skill",
    category: "Commands",
    dir: "commands/skill",
  },
  {
    title: "sync",
    description:
      "Sync memories via Git remote or export/import for cross-device portability.",
    href: "/docs/commands/sync",
    category: "Commands",
    dir: "commands/sync",
  },

  // Advanced
  {
    title: "Scoring Formula",
    description:
      "The v4 recall scoring formula: relevance, decayed strength, recency, spreading bonus, context match, and salience.",
    href: "/docs/advanced/scoring-formula",
    category: "Advanced",
    dir: "advanced/scoring-formula",
  },
  {
    title: "Spaced Reinforcement",
    description:
      "How recall spacing affects strength boosts and decay rate improvements.",
    href: "/docs/advanced/spaced-reinforcement",
    category: "Advanced",
    dir: "advanced/spaced-reinforcement",
  },
  {
    title: "Sleep Cycle",
    description:
      "Deep dive into the sleep maintenance cycle: replay, homeostasis, crystallization, and dreaming.",
    href: "/docs/advanced/sleep-cycle",
    category: "Advanced",
    dir: "advanced/sleep-cycle",
  },
  {
    title: "Cross-Agent Sharing",
    description:
      "Share memories across Claude Code, Gemini CLI, and OpenAI Codex agents.",
    href: "/docs/advanced/cross-agent",
    category: "Advanced",
    dir: "advanced/cross-agent",
  },
  {
    title: "Portable Sync",
    description:
      "Git-based sync and encrypted export/import for cross-device memory portability.",
    href: "/docs/advanced/portable-sync",
    category: "Advanced",
    dir: "advanced/portable-sync",
  },
  {
    title: "Working Memory & Session Start",
    description:
      "How Brain feeds the context window at session start through a single budget-bounded aggregator that never overflows working memory.",
    href: "/docs/advanced/working-memory",
    category: "Advanced",
    dir: "advanced/working-memory",
  },

  // Reference
  {
    title: "File Structure",
    description:
      "Complete reference for the ~/.brain/ directory layout and file organization.",
    href: "/docs/reference/file-structure",
    category: "Reference",
    dir: "reference/file-structure",
  },
  {
    title: "Memory File Format",
    description:
      "YAML frontmatter schema and Markdown body format for memory files.",
    href: "/docs/reference/memory-format",
    category: "Reference",
    dir: "reference/memory-format",
  },
  {
    title: "Configuration",
    description:
      "Configuration options for decay rates, scoring weights, and sync settings.",
    href: "/docs/reference/configuration",
    category: "Reference",
    dir: "reference/configuration",
  },
  {
    title: "Changelog",
    description:
      "Release history and version notes for the Brain Memory plugin.",
    href: "/docs/reference/changelog",
    category: "Reference",
    dir: "reference/changelog",
  },
];

/**
 * Extract text content from an MDX file, stripping frontmatter,
 * JSX/import statements, and markdown syntax.
 */
function extractContent(filePath) {
  if (!existsSync(filePath)) {
    return "";
  }

  let content = readFileSync(filePath, "utf-8");

  // Remove frontmatter
  content = content.replace(/^---[\s\S]*?---\n?/, "");

  // Remove import statements
  content = content.replace(/^import\s+.*$/gm, "");

  // Remove export statements (metadata, etc.)
  content = content.replace(/^export\s+.*$/gm, "");

  // Remove JSX tags but keep text content
  content = content.replace(/<[^>]+>/g, " ");

  // Remove markdown heading markers
  content = content.replace(/^#{1,6}\s+/gm, "");

  // Remove code fences
  content = content.replace(/```[\s\S]*?```/g, "");

  // Remove inline code backticks
  content = content.replace(/`([^`]+)`/g, "$1");

  // Remove markdown links, keep text
  content = content.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Remove bold/italic markers
  content = content.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1");

  // Collapse whitespace
  content = content.replace(/\s+/g, " ").trim();

  // Truncate to reasonable length for search
  return content.slice(0, 2000);
}

function buildIndex() {
  const index = pages.map((page) => {
    // Determine the MDX file path
    let mdxPath;
    if (page.dir === "") {
      // Root docs page
      mdxPath = join(docsDir, "page.mdx");
    } else {
      mdxPath = join(docsDir, page.dir, "page.mdx");
    }

    const content = extractContent(mdxPath);

    return {
      title: page.title,
      description: page.description,
      href: page.href,
      category: page.category,
      content,
    };
  });

  writeFileSync(outPath, JSON.stringify(index, null, 2), "utf-8");
  console.log(
    `Search index built: ${index.length} pages → public/search-index.json`
  );
}

buildIndex();
