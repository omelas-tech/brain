import type { Metadata } from "next";
import {
  docPages as rawDocPages,
  categoryOrder,
  SITE_URL,
} from "./docs-data.mjs";

export { SITE_URL };

export interface DocPage {
  title: string;
  description: string;
  href: string;
  category: string;
  order: number;
}

export interface NavCategory {
  name: string;
  order: number;
  pages: DocPage[];
}

const docPages = rawDocPages as DocPage[];

/**
 * Build a Next.js Metadata object for a documentation page, including a
 * page-specific canonical URL and Open Graph fields. Called from each
 * `src/app/docs/**\/page.mdx` so every doc page declares its own canonical.
 *
 * Titles are passed through unchanged (the MDX files already carry the
 * "— Brain Memory" suffix), so no title template is applied at the root.
 */
export function docMeta(
  href: string,
  meta: {
    title: string;
    description: string;
    // Accepted for backwards-compat with existing MDX exports; not emitted.
    category?: string;
    order?: number;
  }
): Metadata {
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: href },
    openGraph: {
      title: meta.title,
      description: meta.description,
      url: href,
      type: "article",
      siteName: "Brain Memory",
      // Explicit because Next does not auto-inherit the root
      // app/opengraph-image when a nested route redefines `openGraph`.
      images: ["/opengraph-image"],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: ["/opengraph-image"],
    },
  };
}

export function getNavCategories(): NavCategory[] {
  const categoryMap = new Map<string, DocPage[]>();

  for (const page of docPages) {
    const existing = categoryMap.get(page.category) ?? [];
    existing.push(page);
    categoryMap.set(page.category, existing);
  }

  const categories: NavCategory[] = [];

  for (const [name, pages] of categoryMap) {
    categories.push({
      name,
      order: categoryOrder[name as keyof typeof categoryOrder] ?? 99,
      pages: pages.sort((a, b) => a.order - b.order),
    });
  }

  return categories.sort((a, b) => a.order - b.order);
}

export function getAllDocPages(): DocPage[] {
  return docPages;
}
