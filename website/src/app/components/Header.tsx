"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Glyph from "./Glyph";

export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`nav${scrolled ? " scrolled" : ""}`} id="nav">
      <div className="nav-inner">
        <Link className="brand" href="#top" aria-label="Brain Memory home">
          <Glyph className="glyph" style={{ color: "var(--accent)" }} />
          <span className="word">
            brain&nbsp;<b>memory</b>
          </span>
        </Link>

        <div className="nav-links">
          <a href="#inside" className="hidden md:inline-flex">Docs</a>
          <a href="#benchmarks" className="hidden md:inline-flex">Benchmarks</a>
          <a href="https://github.com/onurkarali/brain" target="_blank" rel="noopener noreferrer" className="hidden md:inline-flex">GitHub</a>
          <a href="https://www.npmjs.com/package/brain-memory" target="_blank" rel="noopener noreferrer" className="hidden md:inline-flex">npm</a>
          <a href="https://app.brainmemory.work/login" className="hidden md:inline-flex">Login</a>
          <a className="nav-cta" href="#quickstart">Get started</a>

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
            <a href="#inside" className="py-2 text-[var(--fg-2)] hover:text-[var(--fg)]" onClick={() => setIsMenuOpen(false)}>Docs</a>
            <a href="#benchmarks" className="py-2 text-[var(--fg-2)] hover:text-[var(--fg)]" onClick={() => setIsMenuOpen(false)}>Benchmarks</a>
            <a href="https://github.com/onurkarali/brain" target="_blank" rel="noopener noreferrer" className="py-2 text-[var(--fg-2)] hover:text-[var(--fg)]" onClick={() => setIsMenuOpen(false)}>GitHub</a>
            <a href="https://www.npmjs.com/package/brain-memory" target="_blank" rel="noopener noreferrer" className="py-2 text-[var(--fg-2)] hover:text-[var(--fg)]" onClick={() => setIsMenuOpen(false)}>npm</a>
            <a href="https://app.brainmemory.work/login" className="py-2 text-[var(--fg-2)] hover:text-[var(--fg)]" onClick={() => setIsMenuOpen(false)}>Login</a>
          </div>
        </div>
      )}
    </nav>
  );
}
