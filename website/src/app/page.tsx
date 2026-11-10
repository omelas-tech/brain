"use client";

import { useEffect, useState } from "react";
import Header from "./components/Header";
import Footer from "./components/Footer";
import BrainField from "./components/BrainField";
import DecayCurve from "./components/DecayCurve";
import { SuiteDotPlot } from "./components/BenchmarkCharts";
import { changelog } from "../lib/changelog-data";

// Latest released version, baked in at build time from CHANGELOG.md (the
// changelog is cut at every release, so this never drifts from npm).
const VERSION = changelog[0]?.version ?? "0.0.0";

// FAQ — rendered on the page and as FAQPage structured data. Facts only.
const FAQ = [
  {
    q: "What is Brain Memory?",
    a: "Long-term memory for AI agents. Agents store decisions, conventions and preferences as Markdown files and recall them in later sessions.",
  },
  {
    q: "Which agents does it work with?",
    a: "Through the hosted MCP connector: Claude Code, Codex CLI, OpenCode, Copilot CLI, Kilo, Antigravity, the Claude apps and ChatGPT. The local plugin supports the same CLIs. OpenClaw and Hermes use it as their memory engine.",
  },
  {
    q: "Where are memories stored?",
    a: "In ~/.brain/ on your machine, one Markdown file per memory. There is no database. Set BRAIN_DIR to keep the folder elsewhere.",
  },
  {
    q: "How is it different from a vector database?",
    a: "Recall is computed from the files, without embeddings or model calls: keyword relevance, strength after decay, links between memories and the current project. Every agent gets the same ranking.",
  },
  {
    q: "Is it free?",
    a: "Yes. The plugin is MIT-licensed and published on npm as brain-memory. Brain Cloud sync is optional.",
  },
];

const faqStructuredData = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
};

export default function Home() {
  // scroll-reveal
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqStructuredData).replace(/</g, "\\u003c"),
        }}
      />
      <Header />

      {/* ============ HERO ============ */}
      <header className="hero" id="top">
        <BrainField />

        <div className="hero-inner">
          <div className="hero-copy">
            <span className="hero-tag">
              <span className="dot" />v{VERSION} · on npm
            </span>
            <h1>
              Long-term memory
              <br />
              <span className="serif">for AI&nbsp;agents.</span>
            </h1>
            <p className="sub">
              Agents remember decisions, conventions and preferences across sessions.
              Memories are Markdown files in <code>~/.brain/</code>, shared by every agent you use.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#quickstart">
                Get started
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </a>
              <CopyButton
                className="btn btn-ghost"
                text="npm i -g brain-memory"
              >
                <span className="cmd">$</span> npm i -g brain-memory
              </CopyButton>
            </div>
            <div className="hero-badges">
              <span className="badge"><span className="k">npm</span><span className="v">v{VERSION}</span></span>
              <span className="badge"><span className="k">license</span><span className="v">MIT</span></span>
            </div>
          </div>
        </div>

        <div className="hero-hud" aria-hidden="true">
          <div className="row"><span className="lbl">nodes</span><span className="num" data-hud="nodes">—</span></div>
          <div className="row"><span className="lbl">synapses</span><span className="num" data-hud="synapses">—</span></div>
          <div className="row"><span className="lbl">active</span><span className="num" data-hud="active">—</span></div>
          <div className="row"><span className="lbl">mean strength</span><span className="num" data-hud="strength">—</span></div>
          <div className="row"><span className="lbl">recall rate</span><span className="num" data-hud="recall">—</span></div>
        </div>

        <div className="scroll-cue" aria-hidden="true"><span>scroll</span><span className="line" /></div>
      </header>

      {/* ============ 01 HOW IT WORKS ============ */}
      <section className="section" id="how">
        <div className="wrap wide">
          <div className="section-head reveal">
            <span className="eyebrow"><span className="idx">01</span> How it works</span>
            <h2>Three steps.</h2>
          </div>
          <div className="works-layout">
            <div className="steps reveal">
              {steps.map((s, i) => (
                <div className="step" key={s.title}>
                  <span className="st-num">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="decay-panel reveal">
              <div className="dp-head">
                <span className="dp-title">Forgetting curve</span>
                <span className="dp-sub">strength(t) = e^(−λt)</span>
              </div>
              <DecayCurve />
              <div className="decay-legend">
                <span className="li"><span className="swatch" style={{ background: "var(--accent)" }} />strength</span>
                <span className="li"><span className="swatch" style={{ background: "var(--accent-soft)" }} />full timeline</span>
                <span className="li"><span className="swatch" style={{ background: "var(--accent)", width: 4, height: 4, borderRadius: "50%" }} />recall event</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ 02 SPECIFICATION ============ */}
      <section className="section" id="spec">
        <div className="wrap wide">
          <div className="section-head reveal">
            <span className="eyebrow"><span className="idx">02</span> Specification</span>
            <h2>What every brain includes.</h2>
          </div>
          <table className="data-table reveal">
            <tbody>
              {spec.map((r) => (
                <tr key={r.k}><td style={{ width: "28%" }}>{r.k}</td><td>{r.v}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ============ 03 BENCHMARKS ============ */}
      <section className="section" id="benchmarks">
        <div className="wrap wide">
          <div className="section-head reveal">
            <span className="eyebrow"><span className="idx">03</span> Benchmarks</span>
            <h2>Tested against keyword search, vector search and full-context prompts.</h2>
            <p className="lede">
              Claude Sonnet 5.5, 10 runs per arm, graded by a three-judge panel from other model families.
              Wins, ties and nulls are all published.{" "}
              <a href="/docs/benchmarks/results">Results →</a>{" "}
              <a href="/docs/benchmarks">Methodology →</a>
            </p>
          </div>

          <div className="stat-row reveal">
            <div className="stat"><div className="v">9<span className="u">/10</span></div><div className="k">passed with 1,000 distractor memories. BM25 and vector search: 0/10.</div></div>
            <div className="stat"><div className="v">−28<span className="u">%</span></div><div className="k">tokens when only the needed skill is loaded, at the same pass rate.</div></div>
            <div className="stat"><div className="v">10<span className="u">/10</span></div><div className="k">completed with a poisoned memory present. Without quarantine: 0/10.</div></div>
          </div>

          <div className="reveal">
            <SuiteDotPlot />
          </div>
          <p className="qs-note reveal">
            Judge agreement with human grading has not been measured yet. Raw data:{" "}
            <a href="/benchmarks/sonnet-5-5-suite-2026-11-10.json">JSON</a>.
          </p>
        </div>
      </section>

      {/* ============ 04 NEUROSCIENCE ============ */}
      <section className="section" id="neuro">
        <div className="wrap wide">
          <div className="section-head reveal">
            <span className="eyebrow"><span className="idx">04</span> Mechanisms</span>
            <h2>Each mechanism follows a published model.</h2>
          </div>
          <div className="neuro-table reveal">
            <table className="data-table">
              <thead><tr><th style={{ width: "32%" }}>Mechanism</th><th>In Brain Memory</th></tr></thead>
              <tbody>
                {neuroRows.map((r) => (
                  <tr key={r.name}><td>{r.name}</td><td>{r.impl}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ============ 05 COMPATIBILITY ============ */}
      <section className="section" id="compat">
        <div className="wrap wide">
          <div className="section-head reveal">
            <span className="eyebrow"><span className="idx">05</span> Compatibility</span>
            <h2>One store. Every agent.</h2>
            <p className="lede">
              Add the hosted MCP connector to any agent below. Sign-in is OAuth.
            </p>
          </div>

          <div className="qs-block reveal">
            <div className="qs-line">
              <span className="prompt">MCP</span>
              <span className="cmd">https://mcp.brainmemory.ai/mcp</span>
              <CopyButton className="copy" text="https://mcp.brainmemory.ai/mcp" idleLabel="copy" />
            </div>
          </div>

          <div className="compat-grid reveal">
            {connectorHosts.map((c) => (
              <div className="compat-card" key={c.name}>
                <div className="cc-name">{c.name}</div>
                <div className="cc-tag">{c.vendor}</div>
                <div className="code-chip">{c.setup}</div>
              </div>
            ))}
          </div>

          <div className="section-head reveal" style={{ marginTop: 48 }}>
            <h2>Or run it locally.</h2>
            <p className="lede">
              The npm plugin writes to <code>~/.brain/</code> on your machine. No account needed.
            </p>
          </div>
          <div className="compat-grid reveal">
            {nativeHosts.map((c) => (
              <div className="compat-card" key={c.name}>
                <div className="cc-name">{c.name}{c.experimental ? " *" : ""}</div>
                <div className="cc-tag">{c.vendor}</div>
                <div className="code-chip">brain <span className="flag">{c.flag}</span> --global</div>
              </div>
            ))}
          </div>
          <p className="qs-note reveal">* Experimental.</p>
        </div>
      </section>

      {/* ============ 06 QUICK START ============ */}
      <section className="section" id="quickstart">
        <div className="wrap">
          <div className="section-head reveal">
            <span className="eyebrow"><span className="idx">06</span> Quick start</span>
            <h2>Install, then connect your agent.</h2>
          </div>
          <div className="qs-block reveal">
            <div className="qs-line">
              <span className="prompt">$</span>
              <span className="cmd">npm install -g brain-memory</span>
              <CopyButton className="copy" text="npm install -g brain-memory" idleLabel="copy" />
            </div>
          </div>
          <p className="qs-note reveal">
            Then run <code>brain --claude</code>, <code>--codex</code>, <code>--opencode</code> or{" "}
            <code>--all</code>. For the Claude and ChatGPT apps, add the MCP connector.
          </p>
        </div>
      </section>

      {/* ============ 07 QUESTIONS ============ */}
      <section className="section" id="faq">
        <div className="wrap">
          <div className="section-head reveal">
            <span className="eyebrow"><span className="idx">07</span> FAQ</span>
            <h2>Questions.</h2>
          </div>
          <table className="data-table reveal">
            <tbody>
              {FAQ.map(({ q, a }) => (
                <tr key={q}><td style={{ width: "34%" }}>{q}</td><td>{a}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ============ 08 REFERENCES ============ */}
      <section className="section" id="references">
        <div className="wrap">
          <div className="section-head reveal">
            <span className="eyebrow"><span className="idx">08</span> References</span>
            <h2>Sources.</h2>
          </div>

          {referenceGroups.map((group) => (
            <div className="ref-group reveal" key={group.heading}>
              <h4>{group.heading}</h4>
              {group.refs.map((ref) => (
                <div className="ref" key={ref.id}>
                  <a href={ref.url} target="_blank" rel="noopener noreferrer" className="r-title">{ref.title}</a>
                  <span className="r-meta">{ref.id}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <Footer />
    </>
  );
}

/* ─── Copy affordance icons ───────────────────────────────────────── */
function ClipboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/* ─── Copy button (hero install pill + quick-start) ───────────────────
   Always gives feedback: a clipboard icon hints it's copyable, and on
   click it confirms with a green check + "copied". */
function CopyButton({
  text,
  className,
  children,
  idleLabel,
}: {
  text: string;
  className?: string;
  children?: React.ReactNode;
  idleLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      aria-label="Copy to clipboard"
      title={copied ? "Copied!" : "Copy to clipboard"}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch {}
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {children}
      <span className={`copy-ind${copied ? " is-copied" : ""}`} aria-live="polite">
        {copied ? <><CheckIcon />copied</> : <><ClipboardIcon />{idleLabel}</>}
      </span>
    </button>
  );
}


/* ─── Static content ──────────────────────────────────────────────── */
const steps = [
  { title: "Remember", body: "The agent saves decisions, conventions and preferences as Markdown files." },
  { title: "Recall", body: "At session start and on request, the most relevant memories are loaded into context." },
  { title: "Maintain", body: "Memories fade unless used. Recall strengthens them. A sleep cycle consolidates and prunes." },
];

/** The specification table — facts only, no adjectives. */
const spec = [
  { k: "Storage", v: "One Markdown file per memory in ~/.brain/, with YAML frontmatter. No database." },
  { k: "Recall", v: "Keyword relevance, strength after decay, links between memories and project context. No model calls; the same ranking in every agent." },
  { k: "Memory types", v: "Eight types, from decision to observation, each with its own strength and decay rate." },
  { k: "Time", v: "A newer fact can supersede an older one. Past states stay queryable by date." },
  { k: "Skills", v: "Procedures stored as SKILL.md files and loaded only when a task needs them." },
  { k: "Safety", v: "Every memory records its origin. Content from tools or the web waits for your approval before recall." },
  { k: "Sync", v: "Git remote, encrypted export, any synced folder via BRAIN_DIR, or Brain Cloud." },
  { k: "Requirements", v: "Node.js 18 or later. No runtime dependencies." },
  { k: "License", v: "MIT" },
];

const neuroRows = [
  { name: "Ebbinghaus decay", impl: "Strength falls exponentially, at a rate set by memory type." },
  { name: "Spacing effect", impl: "Longer gaps between recalls give larger, longer-lasting boosts." },
  { name: "Spreading activation", impl: "Recalling a memory also surfaces its linked memories." },
  { name: "Hebbian learning", impl: "Memories recalled together become more strongly linked." },
  { name: "Context-dependent recall", impl: "Memories from the current project rank higher." },
  { name: "Synaptic homeostasis", impl: "Sleep scales all strengths down to prevent inflation." },
];

// The hosted MCP connector (streamable HTTP + OAuth) reaches every host below.
const connectorHosts = [
  { name: "Claude Code", vendor: "Anthropic", setup: "claude mcp add --transport http brain …/mcp" },
  { name: "Codex CLI", vendor: "OpenAI", setup: "codex mcp add brain --url …/mcp" },
  { name: "OpenCode", vendor: "Any model", setup: "opencode.json → mcp remote url" },
  { name: "Copilot CLI", vendor: "GitHub", setup: "mcp-config.json → type http + url" },
  { name: "Kilo", vendor: "Any model", setup: "kilo.jsonc → mcp remote url" },
  { name: "Claude apps", vendor: "Anthropic", setup: "Settings → Connectors → Add (URL + OAuth)" },
  { name: "ChatGPT", vendor: "OpenAI", setup: "Settings → Connectors → custom (paid / Dev Mode)" },
  { name: "Antigravity", vendor: "Google", setup: "mcp_config.json → serverUrl" },
];

// The local npm plugin (~/.brain/) for the current CLIs.
const nativeHosts = [
  { name: "Claude Code", vendor: "Anthropic", flag: "--claude" },
  { name: "Codex CLI", vendor: "OpenAI", flag: "--codex" },
  { name: "OpenCode", vendor: "Any model", flag: "--opencode" },
  { name: "Copilot CLI", vendor: "GitHub", flag: "--copilot" },
  { name: "Kilo", vendor: "Any model", flag: "--kilo" },
  { name: "Antigravity", vendor: "Google", flag: "--antigravity", experimental: true },
];

const referenceGroups = [
  {
    heading: "Foundations",
    refs: [
      { title: "Cognitive Architectures for Language Agents (CoALA)", id: "arXiv 2309.02427", url: "https://arxiv.org/abs/2309.02427" },
      { title: "MemGPT: Towards LLMs as Operating Systems", id: "arXiv 2310.08560", url: "https://arxiv.org/abs/2310.08560" },
      { title: "Generative Agents: Interactive Simulacra of Human Behavior", id: "arXiv 2304.03442", url: "https://arxiv.org/abs/2304.03442" },
      { title: "Ebbinghaus — Über das Gedächtnis (1885)", id: "foundational", url: "https://en.wikipedia.org/wiki/Forgetting_curve" },
    ],
  },
  {
    heading: "Memory benchmarks",
    refs: [
      { title: "LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory", id: "arXiv 2410.10813", url: "https://arxiv.org/abs/2410.10813" },
      { title: "MemoryAgentBench: A Unified Evaluation for Long-Term Memory Agents", id: "arXiv 2507.05257", url: "https://arxiv.org/abs/2507.05257" },
      { title: "SWE-Bench-CL: Continual Learning for Coding Agents", id: "arXiv 2507.00014", url: "https://arxiv.org/abs/2507.00014" },
      { title: "Mem0: Scalable Long-Term Memory for Production AI Agents", id: "arXiv 2504.19413", url: "https://arxiv.org/abs/2504.19413" },
      { title: "BEAM: Benchmarking Long-Term Memory up to 10M Tokens", id: "arXiv 2510.27246", url: "https://arxiv.org/abs/2510.27246" },
    ],
  },
  {
    heading: "Methodology",
    refs: [
      { title: "Preference Leakage: A Pitfall in LLM-as-a-Judge", id: "arXiv 2502.01534", url: "https://arxiv.org/abs/2502.01534" },
      { title: "Replacing Judges with Juries: a Panel of LLM Evaluators (PoLL)", id: "arXiv 2404.18796", url: "https://arxiv.org/abs/2404.18796" },
      { title: "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena", id: "arXiv 2306.05685", url: "https://arxiv.org/abs/2306.05685" },
      { title: "When Judgment Becomes Noise", id: "arXiv 2509.20293", url: "https://arxiv.org/abs/2509.20293" },
      { title: "LastingBench: Defending Benchmarks Against Data Leakage", id: "arXiv 2506.21614", url: "https://arxiv.org/abs/2506.21614" },
    ],
  },
  {
    heading: "Memory security",
    refs: [
      { title: "OWASP Top 10 for Agentic Applications — ASI06: Memory & Context Poisoning", id: "OWASP 2026", url: "https://genai.owasp.org/" },
      { title: "MemGhost: Persistent Manipulation of LLM Agents via Memory Injection", id: "arXiv 2607.05189", url: "https://arxiv.org/abs/2607.05189" },
      { title: "A Survey on Long-Term Memory Security in LLM Agents", id: "arXiv 2604.16548", url: "https://arxiv.org/abs/2604.16548" },
    ],
  },
];
