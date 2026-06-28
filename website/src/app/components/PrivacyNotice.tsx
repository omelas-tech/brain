"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Transparency notice — NOT a cookie-consent CMP. Brain Memory sets zero
// tracking cookies and runs no third-party analytics, so there is nothing to
// "consent" to; this just surfaces what little browser storage the optional
// Brain Cloud app uses, with a link to the full Privacy Policy. If a tracking
// cookie is ever introduced, replace this with a real consent manager.

const STORAGE_KEY = "brain:privacy-notice:dismissed";

export default function PrivacyNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) !== "1") setVisible(true);
    } catch {
      /* private browsing — just don't show */
    }
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* no-op */
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="privacy notice"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-md z-50 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-lg p-4"
    >
      <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
        privacy
      </p>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-3">
        Brain Memory sets no tracking cookies and runs no third-party analytics.
        Your memories are local-first by default. The optional Brain Cloud app
        uses only the browser storage it needs to work — your sign-in session and
        theme.{" "}
        <Link
          href="/privacy"
          className="underline underline-offset-2 text-[var(--text-primary)] hover:text-[var(--accent)]"
        >
          Details
        </Link>
        .
      </p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={dismiss}
          className="font-mono text-xs font-medium bg-[var(--text-primary)] text-[var(--bg)] hover:bg-[var(--accent)] px-3 py-1.5 rounded-md transition-colors"
        >
          got it
        </button>
      </div>
    </div>
  );
}
