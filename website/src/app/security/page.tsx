import Header from "../components/Header";
import Footer from "../components/Footer";

export const metadata = {
  title: "Security — Brain Memory",
  description:
    "Security policy for Brain Memory — how to report a vulnerability, and how the local-first plugin, Brain Cloud, and the Claude connector protect your data.",
  alternates: { canonical: "/security" },
};

export default function SecurityPage() {
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
            Security
          </h1>
        </div>
        <p className="font-mono text-xs uppercase tracking-wider text-[var(--text-tertiary)] mb-10">
          last updated · july 2026
        </p>

        <div className="space-y-8 text-[var(--text-secondary)] leading-relaxed text-[0.9375rem]">
          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">
              Reporting a vulnerability
            </h2>
            <p>
              If you discover a security vulnerability, please report it privately by email to{" "}
              <a
                href="mailto:onur@omelas.tech"
                className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
              >
                onur@omelas.tech
              </a>
              . Please do <strong className="text-[var(--text-primary)]">not</strong> open a public
              GitHub issue for security reports. You should receive a response within 48 hours.
              Include a description of the issue, steps to reproduce, and the potential impact.
            </p>
            <p className="mt-3">
              A machine-readable contact is published at{" "}
              <a
                href="/.well-known/security.txt"
                className="font-mono text-xs bg-[var(--surface-2)] border border-[var(--border)] px-1.5 py-0.5 rounded"
              >
                /.well-known/security.txt
              </a>
              , and the canonical policy lives in{" "}
              <a
                href="https://github.com/omelas-tech/brain/blob/main/SECURITY.md"
                className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
              >
                SECURITY.md
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">Local-first by default</h2>
            <p>
              By default, your memories are plain files in{" "}
              <code className="font-mono text-xs bg-[var(--surface-2)] border border-[var(--border)] px-1.5 py-0.5 rounded">~/.brain/</code>{" "}
              on your own disk and never leave it. The hosted{" "}
              <strong className="text-[var(--text-primary)]">Brain Cloud</strong> sync hub and the{" "}
              <strong className="text-[var(--text-primary)]">Claude connector</strong> are entirely
              opt-in. If you never enable a sync provider, nothing is ever sent to external servers,
              and the smallest attack surface is the one you get out of the box.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">
              Encryption for Git &amp; export sync
            </h2>
            <p>
              When you sync to a Git remote or an export file, memory files can be encrypted with{" "}
              <strong className="text-[var(--text-primary)]">AES-256-GCM</strong> using a
              passphrase you provide (key derived with PBKDF2-SHA512, 100K iterations). Brain Memory{" "}
              <strong className="text-[var(--text-primary)]">never stores credentials</strong> — Git
              sync relies on your existing SSH keys or Git credential helpers.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">
              How the hosted service protects your data
            </h2>
            <p>
              When you choose to use Brain Cloud or the connector, your data is protected in depth:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 mt-3">
              <li>
                <strong className="text-[var(--text-primary)]">Encrypted at rest.</strong> Brains in
                Brain Cloud are encrypted on disk with AES-256-GCM using a per-user key wrapped by
                Google Cloud KMS (EU-hosted); the key material never leaves KMS. A stolen disk,
                backup, or snapshot yields no readable memories.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">No plaintext on the connector.</strong>{" "}
                The connector holds each user&apos;s working copy in RAM only (a tmpfs) and purges it
                on an idle timeout, at session end, and on restart — it is never written to the
                connector&apos;s disk.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Encrypted in transit.</strong> All
                traffic to Brain Cloud and the connector is HTTPS/TLS.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Strict tenant isolation.</strong> Every
                request is authorized against the authenticated account; one account can never read or
                overwrite another&apos;s brain.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Revocable sessions.</strong> CLI
                sessions use rotating refresh tokens with automatic reuse detection — a replayed token
                revokes the whole session family. Log out one device or all devices at any time, and
                revoke the connector from your Claude account.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Verified-identity sign-in.</strong>{" "}
                Login is Google OAuth via Firebase; account-linking requires a verified email.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Least privilege.</strong> The connector
                runs as an unprivileged, sandboxed service (systemd hardening: no new privileges,
                read-only filesystem, private tmp).
              </li>
            </ul>
            <p className="mt-3">
              Because recall runs server-side, this is server-side encryption at rest, not
              end-to-end encryption — the service necessarily processes your memories in memory to
              score them. If you require that no server ever sees your memories in plaintext, keep
              your brain local-only (the default) or use Git/export sync with a passphrase.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">
              Supply-chain posture
            </h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <strong className="text-[var(--text-primary)]">No runtime dependencies.</strong> The{" "}
                <code className="font-mono text-xs bg-[var(--surface-2)] border border-[var(--border)] px-1.5 py-0.5 rounded">brain-memory</code>{" "}
                package is pure file I/O with no third-party runtime deps, minimizing the supply-chain
                attack surface.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">No telemetry.</strong> The package
                collects no usage data or analytics and operates entirely offline.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">No stored credentials.</strong> Brain
                Memory never persists auth tokens; sync uses your existing Git/SSH authentication.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">Supported versions</h2>
            <p>
              Brain Memory is in beta. Security fixes are shipped against the current{" "}
              <code className="font-mono text-xs bg-[var(--surface-2)] border border-[var(--border)] px-1.5 py-0.5 rounded">0.1.x</code>{" "}
              beta line. See the{" "}
              <a
                href="/docs/reference/changelog"
                className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
              >
                changelog
              </a>{" "}
              for what has shipped.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">Contact</h2>
            <p>
              <a
                href="mailto:onur@omelas.tech"
                className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
              >
                onur@omelas.tech
              </a>
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
