import type { Metadata, Viewport } from "next";
import { Space_Grotesk, JetBrains_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "Brain Memory — Memory for AI Agents",
  description:
    "A hierarchical, file-system-based memory system for AI coding agents. Inspired by human neuroscience — memories decay, strengthen through recall, and connect via associative networks.",
  keywords: [
    "brain-memory",
    "AI agent memory",
    "Claude Code",
    "Gemini CLI",
    "OpenAI Codex",
    "neuroscience",
    "spaced repetition",
    "hierarchical memory",
    "context engineering",
  ],
  authors: [{ name: "Omelas" }],
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/icon.png",
  },
  openGraph: {
    title: "Brain Memory — Memory for AI Agents",
    description:
      "A hierarchical, file-system-based memory system for AI coding agents inspired by human neuroscience.",
    type: "website",
    url: "https://brainmemory.work",
    images: [{ url: "/icon.png", width: 1024, height: 1024 }],
  },
};

export const viewport: Viewport = {
  themeColor: "#07090A",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${jbmono.variable} ${instrumentSerif.variable}`}
    >
      <body className="min-h-dvh bg-[var(--bg)] text-[var(--text-primary)] antialiased">
        {children}
      </body>
    </html>
  );
}
