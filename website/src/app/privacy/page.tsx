import Header from "../components/Header";
import Footer from "../components/Footer";

export const metadata = {
  title: "Privacy Policy — Brain Memory",
  description:
    "Privacy policy for Brain Memory — the local-first plugin, the optional Brain Cloud sync hub, and the Claude connector.",
  alternates: { canonical: "/privacy" },
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
          last updated · june 2026
        </p>

        <div className="space-y-8 text-[var(--text-secondary)] leading-relaxed text-[0.9375rem]">
          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">No tracking</h2>
            <p>
              This marketing site uses no tracking cookies, no analytics, and no
              third-party trackers, and collects no personal data. See{" "}
              <strong className="text-[var(--text-primary)]">Cookies &amp; browser storage</strong>{" "}
              below for the small amount of functional storage the optional Brain Cloud app uses.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">Local-first by default</h2>
            <p>
              By default, all memory data is stored locally in{" "}
              <code className="font-mono text-xs bg-[var(--surface-2)] border border-[var(--border)] px-1.5 py-0.5 rounded">~/.brain/</code>{" "}
              on your machine and never leaves it. Syncing is always opt-in: the{" "}
              <code className="font-mono text-xs bg-[var(--surface-2)] border border-[var(--border)] px-1.5 py-0.5 rounded">/brain:sync</code>{" "}
              feature can push your memories to a Git remote of your choosing, to a single
              encrypted export file, or to the optional hosted Brain Cloud (below). If you never
              enable a sync provider, nothing is ever sent to external servers.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">
              Brain Cloud &amp; the Claude connector
            </h2>
            <p>
              <a
                href="https://app.brainmemory.ai"
                className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
              >
                Brain Cloud
              </a>{" "}
              (the optional hosted sync hub) and the{" "}
              <strong className="text-[var(--text-primary)]">Claude connector</strong> (a remote
              MCP server that lets Claude apps recall and write your memories) are entirely
              optional. When you choose to use them:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 mt-3">
              <li>
                <strong className="text-[var(--text-primary)]">What we store:</strong> only the
                brain you sync (your Markdown memory files and their index) and the minimum
                account identity needed to sign you in — your Google account, via Firebase
                authentication. We do <strong>not</strong> collect your Claude conversations,
                chat history, prompts, or other files. The{" "}
                <code className="font-mono text-xs bg-[var(--surface-2)] border border-[var(--border)] px-1.5 py-0.5 rounded">brain_memorize</code>{" "}
                tool stores only the specific content you ask to remember — never the whole
                conversation.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Encrypted at rest.</strong> Brains
                in Brain Cloud are encrypted on disk with AES-256-GCM using a per-user key that is
                wrapped by Google Cloud KMS (the key is hosted in the EU). The connector keeps your
                working copy on an in-memory (RAM-backed) store and purges it after a period of
                inactivity, so it is not retained on the connector&apos;s disk.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Encrypted in transit.</strong> All
                traffic to Brain Cloud and the connector is HTTPS/TLS.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Strict isolation.</strong> Every
                request is authorized against the signed-in account; one account can never read
                or write another&apos;s brain.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Revocable access.</strong> Sessions
                use rotating tokens with reuse detection; you can log out one device or all
                devices, and revoke the connector&apos;s access from your Claude account, at any
                time.
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
              Where your data lives &amp; who processes it
            </h2>
            <p>
              Brain Cloud is hosted in the European Union, and your synced brains are stored and
              backed up within the EU. We rely on a small set of sub-processors, solely to operate
              the Service:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 mt-3">
              <li>
                <strong className="text-[var(--text-primary)]">Contabo</strong> (Germany, EU) —
                server hosting for Brain Cloud and the connector.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Cloudflare</strong> — TLS/CDN and
                encrypted off-site backups (Cloudflare R2, EU-jurisdiction bucket). Backups contain
                only ciphertext.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Google Cloud KMS</strong> (EU) —
                manages the keys that encrypt your brains at rest; key material never leaves KMS.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Google Firebase Authentication</strong>{" "}
                — sign-in (your Google account identity only).
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Stripe</strong> — payment processing
                for paid subscriptions. We never see or store your full card details.
              </li>
            </ul>
            <p className="mt-3">
              Firebase and Stripe are global providers that may process limited data (your account
              identity; billing details) outside the EU. Where that happens, those transfers rely on
              the providers&apos; standard safeguards, such as the EU Standard Contractual Clauses and
              applicable adequacy decisions. We use no third-party advertising or analytics processors.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">
              Cookies &amp; browser storage
            </h2>
            <p>
              The marketing site (brainmemory.ai) sets{" "}
              <strong className="text-[var(--text-primary)]">no cookies</strong> and runs no
              analytics; the only thing it stores in your browser is a small local flag remembering
              that you dismissed the privacy notice.
            </p>
            <p className="mt-3">
              The Brain Cloud dashboard uses only{" "}
              <strong className="text-[var(--text-primary)]">strictly necessary</strong> browser
              storage to work — your sign-in session (via Firebase) and your theme preference. None of
              it is used for tracking, advertising, or cross-site profiling, so no cookie-consent
              banner is required. We run no third-party analytics or tracking cookies anywhere.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">
              Retention, export &amp; deletion
            </h2>
            <p>
              Your memories are yours. You can export your entire brain to a single (optionally
              encrypted) file at any time with{" "}
              <code className="font-mono text-xs bg-[var(--surface-2)] border border-[var(--border)] px-1.5 py-0.5 rounded">/brain:sync export</code>
              , archive or forensically erase individual memories with{" "}
              <code className="font-mono text-xs bg-[var(--surface-2)] border border-[var(--border)] px-1.5 py-0.5 rounded">/brain:forget</code>
              , and delete a synced brain or your whole account from the Brain Cloud dashboard —
              which removes the stored brain from our systems. Deleting locally never requires the
              cloud, and deleting from the cloud never touches your local copy.
            </p>
            <p className="mt-3">
              We keep your synced brain for as long as your account is active. When you delete a brain
              or your account, it is removed from our live systems right away and purged from our
              encrypted backups within 30 days (our backup-retention window). We may retain limited
              billing and account records longer where the law requires it (for example, tax and
              accounting obligations).
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
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">
              Who&apos;s responsible &amp; your rights (GDPR)
            </h2>
            <p>
              <strong className="text-[var(--text-primary)]">Omelas</strong> (
              <a
                href="https://omelas.tech"
                className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
              >
                omelas.tech
              </a>
              ), a sole proprietorship (eenmanszaak) established in the Netherlands
              (KvK&nbsp;98455303, VAT&nbsp;NL005331814B35), is the{" "}
              <strong className="text-[var(--text-primary)]">data controller</strong> for the personal
              data processed by Brain Cloud and the connector. We process that data to provide the
              Service you asked for (to perform our contract with you), and on the basis of your
              consent where that applies. We do not sell your data and do not use it to train models.
            </p>
            {/* TODO before launch (GDPR Art. 13 / NL e-Commerce art. 3:15d BW):
                add the controller's postal/establishment address — a real address must be easily
                and permanently accessible. */}
            <p className="mt-3">
              If you are in the EU/EEA, the GDPR gives you the right to:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 mt-2">
              <li>access the personal data we hold about you and receive a copy;</li>
              <li>have inaccurate data corrected;</li>
              <li>have your data erased (the &ldquo;right to be forgotten&rdquo;);</li>
              <li>restrict or object to certain processing;</li>
              <li>
                receive your data in a portable format — the{" "}
                <code className="font-mono text-xs bg-[var(--surface-2)] border border-[var(--border)] px-1.5 py-0.5 rounded">/brain:sync export</code>{" "}
                command does exactly this on demand; and
              </li>
              <li>withdraw consent at any time, without affecting processing already carried out.</li>
            </ul>
            <p className="mt-3">
              You can exercise most of these yourself at any time — export your brain,{" "}
              <code className="font-mono text-xs bg-[var(--surface-2)] border border-[var(--border)] px-1.5 py-0.5 rounded">/brain:forget</code>{" "}
              a memory, or delete your brain or whole account from the Brain Cloud dashboard — or email
              us at{" "}
              <a
                href="mailto:support@omelas.tech"
                className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
              >
                support@omelas.tech
              </a>{" "}
              and we will respond within 30 days. If you believe we have mishandled your data, you may
              also lodge a complaint with the Dutch data protection authority, the{" "}
              <a
                href="https://www.autoriteitpersoonsgegevens.nl/en"
                className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
              >
                Autoriteit Persoonsgegevens
              </a>
              .
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
