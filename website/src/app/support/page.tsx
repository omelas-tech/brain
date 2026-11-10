import Link from "next/link";
import Header from "../components/Header";
import Footer from "../components/Footer";

export const metadata = {
  title: "Support — Brain Memory",
  description:
    "Get help with Brain Memory: email support, bug reports, security reports, and how to export or delete your data.",
  alternates: { canonical: "/support" },
};

const link = "text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2";

function code(text: string) {
  return (
    <code className="font-mono text-xs bg-[var(--surface-2)] border border-[var(--border)] px-1.5 py-0.5 rounded">
      {text}
    </code>
  );
}

export default function SupportPage() {
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
            Support
          </h1>
        </div>
        <p className="font-mono text-xs uppercase tracking-wider text-[var(--text-tertiary)] mb-10">
          help, bugs, security and your data
        </p>

        <div className="space-y-8 text-[var(--text-secondary)] leading-relaxed text-[0.9375rem]">
          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">Email</h2>
            <p>
              For help with the plugin, Brain Cloud, or the connector in Claude, ChatGPT or another
              client, email{" "}
              <a href="mailto:support@omelas.tech" className={link}>
                support@omelas.tech
              </a>
              . Include the client you use and, for the CLI, the output of {code("brain --version")}.
              Never send us your memories or a sign-in token.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">Bugs and feature requests</h2>
            <p>
              Brain Memory is open source. Report bugs and ask for features on{" "}
              <a
                href="https://github.com/omelas-tech/brain/issues"
                target="_blank"
                rel="noopener noreferrer"
                className={link}
              >
                GitHub Issues
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">Security</h2>
            <p>
              Report vulnerabilities privately, as described on the{" "}
              <Link href="/security" className={link}>
                security page
              </Link>
              , not in a public issue.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">Your data</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                See, export or delete a synced brain, or your whole account, in the{" "}
                <a href="https://app.brainmemory.ai" className={link}>
                  Brain Cloud dashboard
                </a>
                .
              </li>
              <li>
                Remove a single memory by asking your assistant to forget it, or with{" "}
                {code("brain forget")}.
              </li>
              <li>
                Disconnect the connector from your AI client&apos;s connector or plugin settings. Its
                copy of your brain is cleared after 15 minutes without use.
              </li>
              <li>
                What we store and for how long is in the{" "}
                <Link href="/privacy" className={link}>
                  privacy policy
                </Link>
                .
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">Documentation</h2>
            <p>
              Setup guides for every supported agent are in the{" "}
              <Link href="/docs" className={link}>
                docs
              </Link>
              .
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
