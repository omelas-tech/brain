// Single source of truth for the blog post registry.
//
// Consumed by:
//   - src/lib/blog.ts     (typed post list + blogMeta helper for the app)
//   - src/app/blog/page.tsx
//   - src/app/sitemap.ts
//
// Keep this list in sync with the MDX files under src/app/blog/. The directory
// of each post is derived from its `href`. Newest first.

/** @typedef {{ title: string, description: string, href: string, date: string, readingTime: string, tag: string }} BlogPost */

/** @type {BlogPost[]} */
export const blogPosts = [
  {
    title: "When a memory stops being true",
    description:
      "Decay handles memories that fade. It doesn't handle memories that were true and then, on a specific day, weren't. Brain now models truth-based invalidation: supersede the old fact, keep it answerable, let the new one win.",
    href: "/blog/when-a-memory-stops-being-true",
    date: "2026-08-08",
    readingTime: "5 min",
    tag: "Concepts",
  },
  {
    title: "One skill, every agent: Brain as a portable SKILL.md",
    description:
      "Brain already installed natively into a handful of coding agents. Now it ships as a single portable Agent Skill folder that runs unmodified across ~40 clients — the ones we support, and the ones we've never heard of.",
    href: "/blog/one-skill-every-agent",
    date: "2026-08-08",
    readingTime: "5 min",
    tag: "Distribution",
  },
  {
    title: "Closing the loop on memory poisoning: quarantine, audit, and rollback",
    description:
      "The write-path gate stopped planted memories from entrenching. Now brain flags untrusted writes for review, detects the patterns an attack leaves behind, and can roll the whole brain back — all five OWASP ASI06 layers, shipped.",
    href: "/blog/quarantine-and-audit",
    date: "2026-08-07",
    readingTime: "7 min",
    tag: "Security",
  },
  {
    title: "Introducing Brain Memory: a memory system that forgets on purpose",
    description:
      "AI agents start every session at zero. The usual fixes treat memory as storage plus search. Brain models it the way remembering actually works — decay, reinforcement, association — in plain files you can read.",
    href: "/blog/introducing-brain-memory",
    date: "2026-07-26",
    readingTime: "9 min",
    tag: "Introduction",
  },
  {
    title: "Provenance, not filtering: hardening brain against memory poisoning",
    description:
      "A single email can plant a false memory in an AI agent and keep it there. Here is the attack, where brain was exposed, and the write-path gate we shipped in response.",
    href: "/blog/provenance-memory-poisoning",
    date: "2026-07-26",
    readingTime: "8 min",
    tag: "Security",
  },
];

/** Posts, newest first. */
export function getAllBlogPosts() {
  return [...blogPosts].sort((a, b) => b.date.localeCompare(a.date));
}
