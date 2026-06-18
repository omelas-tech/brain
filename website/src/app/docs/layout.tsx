import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import DocsNav from "@/app/components/docs/DocsNav";
import DocsMobileNav from "@/app/components/docs/DocsMobileNav";
import SearchDialog from "@/app/components/docs/SearchDialog";
import TableOfContents from "@/app/components/docs/TableOfContents";
import DocStructuredData from "@/app/components/docs/DocStructuredData";

export const metadata: Metadata = {
  title: "Documentation — Brain Memory",
  description:
    "Learn how to use Brain Memory — a neuroscience-inspired memory system for AI coding agents.",
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <DocStructuredData />
      {/* Header — aligned with the global site nav (same links + active highlight),
          plus the docs-specific search. "Docs" is the active item across all /docs pages. */}
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[90rem] items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Brain Memory home">
            <Image
              src="/icon.svg"
              alt="Brain Memory"
              width={22}
              height={22}
              className="rounded-[5px]"
            />
            <span className="font-mono text-sm font-semibold tracking-tight text-[var(--text-primary)]">
              brain memory
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <SearchDialog />
            <div className="nav-links">
              <a href="/#inside" className="hidden md:inline-flex">How it works</a>
              <a href="/#benchmarks" className="hidden md:inline-flex">Benchmarks</a>
              <Link href="/docs" className="hidden md:inline-flex active">Docs</Link>
              <a href="https://github.com/omelas-tech/brain" target="_blank" rel="noopener noreferrer" className="hidden md:inline-flex">GitHub</a>
              <a href="https://www.npmjs.com/package/brain-memory" target="_blank" rel="noopener noreferrer" className="hidden md:inline-flex">npm</a>
              <a href="https://app.brainmemory.ai/login" className="hidden md:inline-flex">Login</a>
              <a className="nav-cta" href="/#quickstart">Get started</a>
            </div>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="mx-auto flex max-w-[90rem] px-4 sm:px-6">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:block w-60 shrink-0">
          <div className="sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto py-8 pr-6">
            <DocsNav />
          </div>
        </aside>

        {/* Main Content */}
        <main className="min-w-0 flex-1 px-2 py-10 lg:px-10">
          <DocsMobileNav />
          <article className="prose-doc max-w-3xl">
            {children}
          </article>
        </main>

        {/* Table of Contents */}
        <TableOfContents />
      </div>
    </div>
  );
}
