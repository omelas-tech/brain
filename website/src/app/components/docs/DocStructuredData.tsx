"use client";

import { usePathname } from "next/navigation";
import { getAllDocPages, SITE_URL } from "@/lib/docs";

/**
 * Emits per-page JSON-LD for documentation routes: a TechArticle describing the
 * page plus a BreadcrumbList (Home › Docs › Page). Rendered once in the docs
 * layout, it derives the current page from the pathname so every doc page is
 * covered automatically.
 */
export default function DocStructuredData() {
  const pathname = usePathname();
  // trailingSlash is enabled, so normalize "/docs/x/" -> "/docs/x".
  const href = pathname.replace(/\/$/, "") || "/docs";

  const page = getAllDocPages().find((p) => p.href === href);
  if (!page) return null;

  const url = `${SITE_URL}${page.href}`;
  // Strip the "— Brain Memory" / "- Brain Memory" suffix for a clean headline.
  const headline = page.title.replace(/\s*[—-]\s*Brain Memory\s*$/, "");

  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle",
        "@id": `${url}#article`,
        headline,
        name: headline,
        description: page.description,
        url,
        articleSection: page.category,
        inLanguage: "en",
        isPartOf: { "@id": `${SITE_URL}/#website` },
        author: { "@id": "https://omelas.tech/#organization" },
        publisher: { "@id": "https://omelas.tech/#organization" },
        about: { "@id": `${SITE_URL}/#software` },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: `${SITE_URL}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Documentation",
            item: `${SITE_URL}/docs`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: headline,
            item: url,
          },
        ],
      },
    ],
  };

  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
