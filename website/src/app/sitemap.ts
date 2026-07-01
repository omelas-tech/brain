import type { MetadataRoute } from "next";
import { getAllDocPages, SITE_URL } from "@/lib/docs";

// Static export: this renders to out/sitemap.xml at build time.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  // Top-level routes that are not part of the docs registry.
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/`,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/privacy/`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms/`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/security/`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  const docRoutes: MetadataRoute.Sitemap = getAllDocPages().map((page) => ({
    url: `${SITE_URL}${page.href}/`,
    lastModified,
    changeFrequency: "weekly",
    priority: page.href === "/docs" ? 0.9 : 0.7,
  }));

  return [...staticRoutes, ...docRoutes];
}
