import type { Metadata, Viewport } from "next";
import { Space_Grotesk, JetBrains_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import JsonLd from "./components/JsonLd";
import { SITE_URL } from "@/lib/docs";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const jbmono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jbmono",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

const TITLE = "Brain Memory — Memory for AI Agents";
const DESCRIPTION =
  "A hierarchical, file-system-based memory system for AI coding agents. Inspired by human neuroscience — memories decay, strengthen through recall, and connect via associative networks.";
const OG_DESCRIPTION =
  "A hierarchical, file-system-based memory system for AI coding agents inspired by human neuroscience.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Brain Memory",
  category: "technology",
  publisher: "Omelas",
  authors: [{ name: "Omelas", url: "https://omelas.tech" }],
  creator: "Omelas",
  keywords: [
    "brain-memory",
    "AI agent memory",
    "memory for AI agents",
    "Claude Code",
    "OpenAI Codex",
    "OpenCode",
    "Google Antigravity",
    "MCP connector",
    "neuroscience",
    "spaced repetition",
    "hierarchical memory",
    "context engineering",
    "agent memory system",
  ],
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/icon.png",
  },
  openGraph: {
    title: TITLE,
    description: OG_DESCRIPTION,
    type: "website",
    url: SITE_URL,
    siteName: "Brain Memory",
    locale: "en_US",
    // og:image is generated automatically from app/opengraph-image.tsx.
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: OG_DESCRIPTION,
    // twitter:image is generated automatically from app/opengraph-image.tsx.
  },
};

// Site-wide structured data: who publishes this, what the site is, and what
// the software is. Linked via @id so search engines treat them as one graph.
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://omelas.tech/#organization",
      name: "Omelas",
      url: "https://omelas.tech",
      logo: `${SITE_URL}/icon.png`,
      sameAs: ["https://github.com/omelas-tech"],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "Brain Memory",
      description: OG_DESCRIPTION,
      publisher: { "@id": "https://omelas.tech/#organization" },
      inLanguage: "en",
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#software`,
      name: "Brain Memory",
      description:
        "A hierarchical, file-system-based memory system for AI coding agents — neuroscience-inspired recall, decay, and consolidation that works across Claude Code, Codex CLI, OpenCode, and Antigravity, plus the Claude and ChatGPT apps via a hosted MCP connector.",
      url: SITE_URL,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "macOS, Linux, Windows",
      softwareHelp: `${SITE_URL}/docs`,
      downloadUrl: "https://www.npmjs.com/package/brain-memory",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      author: { "@id": "https://omelas.tech/#organization" },
      publisher: { "@id": "https://omelas.tech/#organization" },
    },
  ],
};

export const viewport: Viewport = {
  themeColor: "#FBFCFD",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${spaceGrotesk.variable} ${jbmono.variable} ${instrumentSerif.variable}`}
    >
      <body className="min-h-dvh bg-[var(--bg)] text-[var(--text-primary)] antialiased">
        <JsonLd data={structuredData} />
        {children}
      </body>
    </html>
  );
}
