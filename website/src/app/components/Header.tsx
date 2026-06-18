"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Glyph from "./Glyph";

// Homepage in-page sections the nav scroll-spies / jumps to.
const SECTIONS = ["inside", "benchmarks"];

export default function Header() {
  const pathname = usePathname();
  const onHome = pathname === "/";
  const [scrolled, setScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll-spy: highlight the in-page nav link for the section under the viewport
  // center. Only on the homepage (that's where the sections live).
  useEffect(() => {
    if (!onHome) {
      setActiveSection(null);
      return;
    }
    const els = SECTIONS
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.5, 1] },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [onHome]);

  // In-page links: pure anchor on the homepage (smooth scroll), root-prefixed
  // elsewhere so they route home first.
  const sectionHref = (id: string) => (onHome ? `#${id}` : `/#${id}`);
  const sectionActive = (id: string) => onHome && activeSection === id;
  const docsActive = pathname.startsWith("/docs");

  return (
    <nav className={`nav${scrolled ? " scrolled" : ""}`} id="nav">
      <div className="nav-inner">
        <Link className="brand" href={onHome ? "#top" : "/"} aria-label="Brain Memory home">
          <Glyph className="glyph" style={{ color: "var(--accent)" }} />
          <span className="word">
            brain&nbsp;<b>memory</b>
          </span>
        </Link>

        <div className="nav-links">
          <a href={sectionHref("inside")} className={`hidden md:inline-flex${sectionActive("inside") ? " active" : ""}`}>How it works</a>
          <a href={sectionHref("benchmarks")} className={`hidden md:inline-flex${sectionActive("benchmarks") ? " active" : ""}`}>Benchmarks</a>
          <Link href="/docs" className={`hidden md:inline-flex${docsActive ? " active" : ""}`}>Docs</Link>
          <a href="https://github.com/omelas-tech/brain" target="_blank" rel="noopener noreferrer" className="hidden md:inline-flex">GitHub</a>
          <a href="https://www.npmjs.com/package/brain-memory" target="_blank" rel="noopener noreferrer" className="hidden md:inline-flex">npm</a>
          <a href="https://app.brainmemory.ai/login" className="hidden md:inline-flex">Login</a>
          <a className="nav-cta" href={onHome ? "#quickstart" : "/#quickstart"}>Get started</a>

          {/* Mobile hamburger */}
          <button
            className="md:hidden flex flex-col gap-[5px] p-2 -mr-2 ml-1"
            onClick={() => setIsMenuOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            <span className={`block w-5 h-px bg-[var(--fg-2)] transition-all ${isMenuOpen ? "rotate-45 translate-y-[6px]" : ""}`} />
            <span className={`block w-5 h-px bg-[var(--fg-2)] transition-all ${isMenuOpen ? "opacity-0" : ""}`} />
            <span className={`block w-5 h-px bg-[var(--fg-2)] transition-all ${isMenuOpen ? "-rotate-45 -translate-y-[6px]" : ""}`} />
          </button>
        </div>
      </div>

      {isMenuOpen && (
        <div className="md:hidden border-t border-[var(--border)] bg-[var(--nav-bg)] backdrop-blur-xl">
          <div className="flex flex-col px-6 py-3 gap-1 font-mono text-sm">
            <a href={sectionHref("inside")} className={`py-2 hover:text-[var(--fg)] ${sectionActive("inside") ? "text-[var(--accent)]" : "text-[var(--fg-2)]"}`} onClick={() => setIsMenuOpen(false)}>How it works</a>
            <a href={sectionHref("benchmarks")} className={`py-2 hover:text-[var(--fg)] ${sectionActive("benchmarks") ? "text-[var(--accent)]" : "text-[var(--fg-2)]"}`} onClick={() => setIsMenuOpen(false)}>Benchmarks</a>
            <Link href="/docs" className={`py-2 hover:text-[var(--fg)] ${docsActive ? "text-[var(--accent)]" : "text-[var(--fg-2)]"}`} onClick={() => setIsMenuOpen(false)}>Docs</Link>
            <a href="https://github.com/omelas-tech/brain" target="_blank" rel="noopener noreferrer" className="py-2 text-[var(--fg-2)] hover:text-[var(--fg)]" onClick={() => setIsMenuOpen(false)}>GitHub</a>
            <a href="https://www.npmjs.com/package/brain-memory" target="_blank" rel="noopener noreferrer" className="py-2 text-[var(--fg-2)] hover:text-[var(--fg)]" onClick={() => setIsMenuOpen(false)}>npm</a>
            <a href="https://app.brainmemory.ai/login" className="py-2 text-[var(--fg-2)] hover:text-[var(--fg)]" onClick={() => setIsMenuOpen(false)}>Login</a>
          </div>
        </div>
      )}
    </nav>
  );
}
