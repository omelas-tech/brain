import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/docs";

// Static export: this renders to out/robots.txt at build time.
export const dynamic = "force-static";

// AI / LLM crawlers we explicitly welcome so Brain Memory can be indexed by,
// and cited in, AI search engines and assistants (ChatGPT, Claude, Perplexity,
// Google AI Overviews, etc.). Listed explicitly to signal intent even though
// the wildcard rule already allows them.
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "CCBot",
  "cohere-ai",
  "Meta-ExternalAgent",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: "/" })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
