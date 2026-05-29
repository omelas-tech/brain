import Header from "../components/Header";
import Footer from "../components/Footer";

export const metadata = {
  title: "Privacy Policy — Brain Memory",
  description: "Privacy policy for the Brain Memory website.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh">
      <Header />

      <main className="max-w-3xl mx-auto px-5 sm:px-6 pt-28 pb-[var(--space-section)]">
        <div className="flex items-baseline gap-3 mb-2">
          <span className="font-mono text-xs text-[var(--text-tertiary)]">00</span>
          <h1
            className="font-semibold tracking-tight text-[var(--text-primary)]"
            style={{ fontSize: "var(--fs-h2)" }}
          >
            Privacy
          </h1>
        </div>
        <p className="font-mono text-xs uppercase tracking-wider text-[var(--text-tertiary)] mb-10">
          last updated · march 2026
        </p>

        <div className="space-y-8 text-[var(--text-secondary)] leading-relaxed text-[0.9375rem]">
          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">No tracking</h2>
            <p>
              This website does not use cookies, analytics, or tracking of any kind.
              No personal data is collected.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">Local-first data</h2>
            <p>
              All memory data is stored locally in{" "}
              <code className="font-mono text-xs bg-[var(--surface-2)] border border-[var(--border)] px-1.5 py-0.5 rounded">~/.brain/</code>{" "}
              on your machine. Nothing is sent to external servers. The optional{" "}
              <code className="font-mono text-xs bg-[var(--surface-2)] border border-[var(--border)] px-1.5 py-0.5 rounded">/brain:sync</code>{" "}
              feature pushes data to a Git remote of your choosing.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">No telemetry</h2>
            <p>
              The{" "}
              <code className="font-mono text-xs bg-[var(--surface-2)] border border-[var(--border)] px-1.5 py-0.5 rounded">brain-memory</code>{" "}
              npm package collects no telemetry, usage data, or analytics. It operates entirely
              offline using local file I/O.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">Contact</h2>
            <p>
              <a
                href="mailto:support@omelas.tech"
                className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
              >
                support@omelas.tech
              </a>
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
