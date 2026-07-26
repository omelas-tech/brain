import type { Metadata } from "next";
import { blogPosts as rawBlogPosts, getAllBlogPosts } from "./blog-data.mjs";
import { SITE_URL } from "./docs-data.mjs";

export interface BlogPost {
  title: string;
  description: string;
  href: string;
  date: string;
  readingTime: string;
  tag: string;
}

const blogPosts = rawBlogPosts as BlogPost[];

export { getAllBlogPosts };
export type { BlogPost as BlogPostType };

export function getBlogPost(href: string): BlogPost | undefined {
  return blogPosts.find((p) => p.href === href);
}

/** Human-readable post date — "26 July 2026". */
export function formatPostDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Build a Next.js Metadata object for a blog post, mirroring `docMeta` — a
 * page-specific canonical plus Open Graph/Twitter fields. Called from each
 * `src/app/blog/**\/page.mdx`.
 */
export function blogMeta(
  href: string,
  meta: { title: string; description: string; publishedTime?: string }
): Metadata {
  const title = `${meta.title} — Brain Memory`;
  return {
    title,
    description: meta.description,
    alternates: { canonical: href },
    openGraph: {
      title,
      description: meta.description,
      url: href,
      type: "article",
      siteName: "Brain Memory",
      publishedTime: meta.publishedTime,
      // Explicit because Next does not auto-inherit the root
      // app/opengraph-image when a nested route redefines `openGraph`.
      images: ["/opengraph-image"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: meta.description,
      images: ["/opengraph-image"],
    },
  };
}

export { SITE_URL };
