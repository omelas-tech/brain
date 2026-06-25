"use client";

import { useState, ReactNode } from "react";

interface CodeBlockProps {
  title?: string;
  children: ReactNode;
}

export default function CodeBlock({ title, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const codeElement = document.querySelector(
      "[data-code-block-active] code"
    );
    if (codeElement) {
      navigator.clipboard.writeText(codeElement.textContent ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="group relative my-4" data-code-block-active="">
      {title && (
        <div className="flex items-center justify-between rounded-t-md border border-b-0 border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
            {title}
          </span>
        </div>
      )}

      <button
        onClick={handleCopy}
        aria-label="Copy code to clipboard"
        className={`absolute right-2 ${title ? "top-10" : "top-2"} inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider rounded border px-2 py-1 transition-all ${
          copied
            ? "border-[var(--live-fg)] text-[var(--live-fg)] opacity-100"
            : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-secondary)] opacity-0 hover:text-[var(--text-primary)] hover:border-[var(--text-primary)] group-hover:opacity-100"
        }`}
      >
        {copied ? (
          <>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
            copied
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
            copy
          </>
        )}
      </button>

      <div
        className={`overflow-x-auto [&>pre]:!my-0 ${title ? "[&>pre]:!rounded-t-none" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}
