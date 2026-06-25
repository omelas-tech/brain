import type { MetadataRoute } from "next";

// Static export: this renders to out/manifest.webmanifest at build time.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Brain Memory — Memory for AI Agents",
    short_name: "Brain Memory",
    description:
      "A hierarchical, file-system-based memory system for AI coding agents, inspired by human neuroscience.",
    start_url: "/",
    display: "standalone",
    background_color: "#FBFCFD",
    theme_color: "#FBFCFD",
    icons: [
      { src: "/favicon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { src: "/favicon-16.png", type: "image/png", sizes: "16x16" },
      {
        src: "/icon.png",
        type: "image/png",
        sizes: "1024x1024",
        purpose: "any",
      },
    ],
  };
}
