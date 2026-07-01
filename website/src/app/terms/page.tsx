import Header from "../components/Header";
import Footer from "../components/Footer";

export const metadata = {
  title: "Terms of Service — Brain Memory",
  description:
    "Terms of Service for Brain Memory — the plugin, the optional Brain Cloud sync hub, and the Claude connector, operated by Omelas.",
  alternates: { canonical: "/terms" },
};

function code(text: string) {
  return (
    <code className="font-mono text-xs bg-[var(--surface-2)] border border-[var(--border)] px-1.5 py-0.5 rounded">
      {text}
    </code>
  );
}

export default function TermsPage() {
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
            Terms of Service
          </h1>
        </div>
        <p className="font-mono text-xs uppercase tracking-wider text-[var(--text-tertiary)] mb-10">
          last updated · june 2026
        </p>

        <div className="space-y-8 text-[var(--text-secondary)] leading-relaxed text-[0.9375rem]">
          <section>
            <p>
              These Terms of Service (&ldquo;Terms&rdquo;) govern your use of Brain Memory — the{" "}
              {code("brain-memory")} plugin and CLI, the optional hosted{" "}
              <strong className="text-[var(--text-primary)]">Brain Cloud</strong> sync service, and
              the <strong className="text-[var(--text-primary)]">Claude connector</strong>{" "}
              (collectively, the &ldquo;Service&rdquo;), operated by{" "}
              <strong className="text-[var(--text-primary)]">Omelas</strong> (
              <a
                href="https://omelas.tech"
                className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
              >
                omelas.tech
              </a>
              ), a sole proprietorship (eenmanszaak) registered in the Netherlands
              (KvK&nbsp;98455303, VAT&nbsp;NL005331814B35) (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By
              installing, accessing, or using the Service you agree to these Terms. If you do not
              agree, do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">1. The Service</h2>
            <p>
              Brain Memory is a local-first memory system for AI coding agents. The plugin stores
              your memories as plain files on your own device. Brain Cloud and the Claude connector
              are <strong>optional</strong> hosted components that sync your memories and expose them
              to compatible AI clients. We may add, change, or discontinue features over time. The
              Service integrates with third-party products (such as Anthropic&apos;s Claude and
              Google sign-in) whose own terms govern your use of them; we are not responsible for
              third-party services.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">
              2. Accounts &amp; eligibility
            </h2>
            <p>
              The local plugin requires no account. Brain Cloud and the connector require signing in
              with a Google account via Firebase authentication. You are responsible for safeguarding
              your account and for all activity under it, and you must provide accurate information.
              You must be at least 13 years old (or the minimum age of digital consent in your
              jurisdiction) and legally able to enter into these Terms. One brain maps to one signed-in
              account; you are responsible for using the correct account.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">3. Acceptable use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-5 space-y-1.5 mt-2">
              <li>use the Service to violate any law or infringe anyone&apos;s rights;</li>
              <li>
                upload content you have no right to store, or content that is unlawful, malicious, or
                harmful;
              </li>
              <li>
                attempt to access another user&apos;s brain or account, probe or breach security, or
                circumvent rate limits, quotas, or access controls;
              </li>
              <li>
                disrupt or overload the Service, or use it to build a competing service by bulk
                extraction; or
              </li>
              <li>reverse engineer the hosted components except to the extent the law permits.</li>
            </ul>
            <p className="mt-3">
              We may suspend or limit access to protect the Service or other users, with notice where
              practicable.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">
              4. Your content &amp; data
            </h2>
            <p>
              <strong className="text-[var(--text-primary)]">You own your memories.</strong> We claim
              no ownership of the content you create or sync. You grant us a limited license to store,
              process, transmit, and display your content solely to operate and provide the Service to
              you (for example, to run server-side recall and sync your brain across your devices). We
              do not sell your content and do not use it to train models. How we handle your data —
              including encryption at rest, RAM-only working copies on the connector, and our
              retention, export, and deletion practices — is described in our{" "}
              <a
                href="/privacy"
                className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
              >
                Privacy Policy
              </a>
              , which is incorporated into these Terms. You are responsible for keeping your own
              backups; the {code("/brain:sync export")} command produces a portable, optionally
              encrypted copy at any time.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">
              5. Subscriptions &amp; billing
            </h2>
            <p>
              The plugin and local use are free and open source. Brain Cloud may offer free and paid
              subscription tiers. Paid plans are billed in advance through our payment processor,
              Stripe, on a recurring basis (monthly or annual) until cancelled.
            </p>
            <ul className="list-disc pl-5 space-y-1.5 mt-2">
              <li>
                <strong className="text-[var(--text-primary)]">Renewal.</strong> Subscriptions renew
                automatically at the then-current price unless you cancel before the renewal date.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Cancellation.</strong> You may cancel
                anytime from the dashboard; access continues through the end of the paid period and
                does not renew thereafter.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Refunds.</strong> Except where required
                by law, payments are non-refundable, and partial periods are not pro-rated.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Price &amp; tax changes.</strong> We may
                change prices with notice; changes apply on your next renewal. You are responsible for
                applicable taxes.
              </li>
            </ul>
            <p className="mt-3">
              <strong className="text-[var(--text-primary)]">VAT.</strong> Unless marked otherwise,
              prices are stated exclusive of VAT; we add VAT at the rate applicable to your country
              where required (EU One-Stop-Shop).
            </p>
            <p className="mt-3">
              <strong className="text-[var(--text-primary)]">Right of withdrawal (EU/EEA consumers).</strong>{" "}
              You normally have 14 days to withdraw from a purchase of digital services. Because Brain
              Cloud is supplied to you immediately, by subscribing and requesting immediate access you
              expressly consent to immediate performance and acknowledge that you{" "}
              <strong className="text-[var(--text-primary)]">lose your 14-day right of withdrawal</strong>{" "}
              once the service has been fully performed. This does not affect your other mandatory
              statutory consumer rights.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">
              6. Intellectual property
            </h2>
            <p>
              The Brain Memory and Omelas names, logos, and brand are ours. The {code("brain-memory")}{" "}
              software is provided under its open-source license (see the public repository); these
              Terms govern the hosted Service, not your rights under that license. Aside from the
              rights expressly granted, we reserve all rights in the Service.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">
              7. Availability &amp; disclaimers
            </h2>
            <p>
              The hosted Service is provided <strong>&ldquo;as is&rdquo;</strong> and{" "}
              <strong>&ldquo;as available&rdquo;</strong>, without warranties of any kind, whether
              express or implied, including merchantability, fitness for a particular purpose, and
              non-infringement. We do not warrant that the Service will be uninterrupted, error-free,
              or that data will never be lost. Because Brain Memory is local-first, keeping a local or
              exported copy of your brain is the recommended safeguard against any cloud outage or data
              loss.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">
              8. Limitation of liability
            </h2>
            <p>
              To the maximum extent permitted by law, Omelas will not be liable for any indirect,
              incidental, special, consequential, or punitive damages, or for any loss of data,
              profits, or goodwill. Our total liability for any claim relating to the Service is
              limited to the greater of the amount you paid us for the Service in the twelve months
              before the claim, or USD&nbsp;50. Some jurisdictions do not allow certain limitations, so
              parts of this section may not apply to you.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">9. Indemnification</h2>
            <p>
              You agree to indemnify and hold Omelas harmless from claims, damages, and expenses
              (including reasonable legal fees) arising out of your content, your use of the Service,
              or your violation of these Terms or applicable law.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">10. Termination</h2>
            <p>
              You may stop using the Service at any time and delete your account and synced brain from
              the dashboard. We may suspend or terminate access if you materially breach these Terms or
              to comply with the law. On termination, your right to use the hosted Service ends; you can
              export your brain beforehand, and your local files remain yours and untouched. Sections
              that by their nature should survive termination (ownership, disclaimers, liability limits,
              indemnification, and governing law) survive.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">11. Changes to these Terms</h2>
            <p>
              We may update these Terms from time to time. When we make material changes, we will
              update the &ldquo;last updated&rdquo; date above and, where appropriate, provide
              additional notice. Your continued use of the Service after changes take effect constitutes
              acceptance of the revised Terms.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">
              12. Governing law &amp; contact
            </h2>
            <p>
              These Terms are governed by the laws of{" "}
              <span className="text-[var(--text-primary)]">the Netherlands</span>, without regard to
              its conflict-of-laws rules, and you agree to the exclusive jurisdiction of the competent
              courts of the Netherlands, except where mandatory consumer-protection law (including
              applicable EU consumer rules) provides otherwise. Questions about these Terms? Contact
              us at{" "}
              <a
                href="mailto:support@omelas.tech"
                className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
              >
                support@omelas.tech
              </a>
              .
            </p>
            <p className="mt-3">
              <strong className="text-[var(--text-primary)]">Operator &amp; legal information:</strong>{" "}
              Omelas (
              <a
                href="https://omelas.tech"
                className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
              >
                omelas.tech
              </a>
              ), a sole proprietorship (eenmanszaak) established in the Netherlands ·
              Petrus&nbsp;Dondersstraat&nbsp;80, 5614&nbsp;AJ&nbsp;Eindhoven · KvK&nbsp;98455303
              · VAT&nbsp;NL005331814B35 ·{" "}
              <a
                href="mailto:support@omelas.tech"
                className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
              >
                support@omelas.tech
              </a>
              .
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
