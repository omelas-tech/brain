"use client";

import { useEffect, useState } from "react";
import Header from "./components/Header";
import Footer from "./components/Footer";
import BrainField from "./components/BrainField";
import DecayCurve from "./components/DecayCurve";

// FAQ structured data — eligible for FAQ rich results and used as direct
// answer fuel by AI search engines. Every answer below is factual.
const FAQ = [
  {
    q: "What is Brain Memory?",
    a: "Brain Memory is a hierarchical, file-system-based memory system for AI coding agents. Modeled on human neuroscience, memories decay on an Ebbinghaus curve, strengthen through recall, connect via associative networks, and consolidate during a sleep cycle.",
  },
  {
    q: "Which AI agents does Brain Memory support?",
    a: "The universal path is the hosted MCP connector (https://mcp.brainmemory.ai/mcp) — one connector reaches Claude Code, OpenAI Codex CLI, OpenCode, the Claude.ai apps, ChatGPT, and Google Antigravity. There's also a free local-first native plugin for Claude Code, Codex, OpenCode, and Antigravity (experimental). A deterministic recall engine produces identical scoring across every agent and model — one brain, any model, every agent.",
  },
  {
    q: "Is Brain Memory free and open source?",
    a: "Yes. Brain Memory is free and open source, published on npm as brain-memory and developed in the open by Omelas on GitHub.",
  },
  {
    q: "Where are my memories stored?",
    a: "All memories live in a single global ~/.brain/ directory in your home folder as human-readable Markdown files with YAML frontmatter. There is no database and no server — the file system is the database, so it is fully browseable, Git-friendly, and portable.",
  },
  {
    q: "How is Brain Memory different from a vector database?",
    a: "Instead of opaque embeddings in a vector store, Brain Memory uses transparent Markdown files scored by a deterministic engine that combines TF-IDF relevance, neuroscience-inspired strength and decay, spreading activation across an associative network, and context-dependent recall. It requires no runtime dependencies and is readable by both humans and agents.",
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
              <span className="dot" />beta · live on npm
            </span>
            <h1>
              Memory for AI&nbsp;agents,
              <br />
              <span className="serif">modeled on the&nbsp;brain.</span>
            </h1>
            <div className="hero-spec" aria-hidden="true">
              <span>SYS / brain-memory</span>
              <span className="sep">//</span>
              <span>arch: hierarchical-fs</span>
              <span className="sep">//</span>
              <span>decay: e^(−λt)</span>
              <span className="sep">//</span>
              <span className="ok">recall: deterministic</span>
            </div>
            <p className="sub">
              A hierarchical, file-system memory that{" "}
              <b>decays on an Ebbinghaus curve</b>, strengthens through recall,
              and consolidates during sleep. One hosted MCP connector reaches Claude&nbsp;Code,
              Codex&nbsp;CLI, OpenCode, Antigravity, and the Claude &amp; ChatGPT apps — <b>one brain, any model, every agent.</b>
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
                text="npm i -g brain-memory@beta"
              >
                <span className="cmd">$</span> npm i -g brain-memory
              </CopyButton>
            </div>
            <div className="hero-badges">
              <span className="badge"><span className="k">npm</span><span className="v">beta</span></span>
              <span className="badge"><span className="k">license</span><span className="v amber">MIT</span></span>
              <span className="badge"><span className="k">deterministic</span><span className="v">recall</span></span>
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

      {/* ============ 01 WHAT'S INSIDE ============ */}
      <section className="section" id="inside">
        <div className="wrap wide">
          <div className="section-head reveal">
            <span className="eyebrow"><span className="idx">01</span> What&apos;s inside</span>
            <h2>A memory architecture, not a vector store.</h2>
          </div>
          <div className="feature-grid reveal">
            {features.map((f) => (
              <div className="feature" key={f.title}>
                <div className="ft-top">
                  <svg className="ft-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: f.icon }} />
                  <h3>{f.title}</h3>
                  <span className="ft-num">/</span>
                </div>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ 02 HOW IT WORKS ============ */}
      <section className="section" id="how">
        <div className="wrap wide">
          <div className="section-head reveal">
            <span className="eyebrow"><span className="idx">02</span> How it works</span>
            <h2>The lifecycle of a memory.</h2>
          </div>
          <div className="works-layout">
            <div className="steps reveal">
              {steps.map((s, i) => (
                <div className="step" key={s.title}>
                  <span className="st-num">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{s.title}</h3>
                    <p dangerouslySetInnerHTML={{ __html: s.body }} />
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

      {/* ============ 03 BENCHMARKS ============ */}
      <section className="section" id="benchmarks">
        <div className="wrap wide">
          <div className="section-head reveal">
            <span className="eyebrow"><span className="idx">03</span> Benchmark results</span>
            <h2>Six-scenario suite for long-term agent memory.</h2>
            <p className="lede">
              Grounded in 2025–2026 long-term-memory evaluation methodology —
              LongMemEval, MemoryAgentBench, SWE-Bench-CL, Mem0 / BEAM. Cross-family
              LLM judge, distractor haystacks, <em>N</em>-arm matrix.{" "}
              <a href="/docs/benchmarks">Methodology →</a>{" "}
              <a href="/docs/benchmarks/results">Live results →</a>
            </p>
          </div>

          <div className="stat-row reveal">
            <div className="stat"><div className="v">27.8<span className="u">K</span></div><div className="k">brain-real tokens / success</div></div>
            <div className="stat"><div className="v">50.8<span className="u">K</span></div><div className="k">context-dump tokens / success</div></div>
            <div className="stat"><div className="v">86.3<span className="u">K</span></div><div className="k">brain-no-pin tokens / success</div></div>
          </div>

          <table className="data-table scenarios reveal">
            <thead><tr><th style={{ width: "40%" }}>Scenario</th><th>What it tests</th></tr></thead>
            <tbody>
              {scenarioRows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="sc-id">{r.id}</span> <span className="sc-name">{r.name}</span>
                    <span className="sc-q">&ldquo;{r.pitch}&rdquo;</span>
                  </td>
                  <td>{r.tests}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <BenchmarkResults />
        </div>
      </section>

      {/* ============ 04 NEUROSCIENCE ============ */}
      <section className="section" id="neuro">
        <div className="wrap wide">
          <div className="section-head reveal">
            <span className="eyebrow"><span className="idx">04</span> Neuroscience foundations</span>
            <h2>Every mechanism maps to a published model.</h2>
          </div>
          <div className="neuro-table reveal">
            <table className="data-table">
              <thead><tr><th style={{ width: "32%" }}>Mechanism</th><th>Implementation in Brain Memory</th></tr></thead>
              <tbody>
                {neuroRows.map((r) => (
                  <tr key={r.name}><td>{r.name}</td><td>{r.impl}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ============ 05 RESEARCH ============ */}
      <section className="section" id="references">
        <div className="wrap">
          <div className="section-head reveal">
            <span className="eyebrow"><span className="idx">05</span> Research &amp; references</span>
            <h2>Grounded in the literature.</h2>
            <p className="lede">
              Brain Memory&apos;s architecture and benchmark methodology draw on the
              academic literature on language-agent memory and evaluation. Selected
              citations below.
            </p>
          </div>

          {referenceGroups.map((group) => (
            <div className="ref-group reveal" key={group.heading}>
              <h4>{group.heading}</h4>
              {group.refs.map((ref) => (
                <div className="ref" key={ref.id}>
                  <a href={ref.url} target="_blank" rel="noopener noreferrer" className="r-title">{ref.title}</a>
                  <span className="r-meta">{ref.id}</span>
                  <p className="r-desc">{ref.note}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ============ 06 COMPATIBILITY ============ */}
      <section className="section" id="compat">
        <div className="wrap wide">
          <div className="section-head reveal">
            <span className="eyebrow"><span className="idx">06</span> Compatibility</span>
            <h2>One memory store. Every agent.</h2>
            <p className="lede">
              The universal path is the <b>hosted MCP connector</b> — one
              streamable-HTTP + OAuth endpoint that reaches every host below.
              Prefer to stay local? The free <b>native plugin</b> writes to
              <code>~/.brain/</code> for the current CLIs.
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
            <h2>Or run it local-first.</h2>
            <p className="lede">
              <code>npm i -g brain-memory@beta &amp;&amp; brain</code> installs the
              free native plugin — slash commands and prompt sections wired into
              the agent&apos;s own config, all pointing at a single
              <code>~/.brain/</code>.
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
          <p className="qs-note reveal">
            * Antigravity native support is experimental. For everything else —
            the Claude.ai apps and ChatGPT included — use the MCP connector above.
          </p>
        </div>
      </section>

      {/* ============ 07 QUICK START ============ */}
      <section className="section" id="quickstart">
        <div className="wrap">
          <div className="section-head reveal">
            <span className="eyebrow"><span className="idx">07</span> Quick start</span>
            <h2>Install globally, then wire your runtime.</h2>
          </div>
          <div className="qs-block reveal">
            <div className="qs-line">
              <span className="prompt">$</span>
              <span className="cmd">npm install -g brain-memory@beta</span>
              <CopyButton className="copy" text="npm install -g brain-memory@beta" idleLabel="copy" />
            </div>
          </div>
          <p className="qs-note reveal">
            Then run <code>brain --claude</code> (or <code>--codex</code> /{" "}
            <code>--opencode</code> / <code>--antigravity</code>, or <code>--all</code>) to configure your runtime(s).
            For the Claude and ChatGPT apps, add the MCP connector instead. One store,
            deterministic recall, every agent.
          </p>
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

/* ─── Benchmark results (real data, per-agent tabs) ───────────────── */
function BenchmarkResults() {
  const agents = Object.keys(agentData);
  const [active, setActive] = useState(agents[0]);
  const data = agentData[active];

  return (
    <div className="reveal">
      <div className="bench-tabs">
        {agents.map((a) => (
          <button
            key={a}
            className={`bench-tab${active === a ? " active" : ""}`}
            onClick={() => setActive(a)}
          >
            {a}
          </button>
        ))}
      </div>
      <div className="bench-meta">{data.subtitle}</div>

      <div style={{ overflowX: "auto" }}>
        <table className="results">
          <thead>
            <tr><th>arm</th><th>tokens</th><th>tok / success</th><th>recall@5</th><th>pass</th></tr>
          </thead>
          <tbody>
            {data.arms.map((row) => {
              const hl = row.arm === "brain-real";
              const timeout = row.tokens === "timeout";
              return (
                <tr key={row.arm} className={hl ? "hl" : ""}>
                  <td>{row.arm}</td>
                  <td className={timeout ? "danger" : ""}>{row.tokens}</td>
                  <td>{row.tokensPerSuccess}</td>
                  <td>{row.recallAt5}</td>
                  <td className={row.passRate === "0%" ? "danger" : "pass"}>{row.passRate}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="bench-note">
        {data.scenario} · 1 run · all arms judged by a cross-family LLM. Results
        in progress; numbers update as runs complete.
      </p>
    </div>
  );
}

/* ─── Static content ──────────────────────────────────────────────── */
const features = [
  { title: "Hierarchical memory", icon: '<path d="M3 4h6l2 2h10v3M3 4v16h18V9M3 9h18"/>', body: "The directory tree is the semantic structure. Browse memory in any file explorer — no opaque embeddings." },
  { title: "Strength & decay", icon: '<path d="M3 20c4-12 14-12 18 0M3 20h18"/>', body: "Memories fade along an exponential forgetting curve. Recall arrests decay and pushes strength back up." },
  { title: "Associative network", icon: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="7" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 7l3 9M17 8l-4 8"/>', body: "Weighted edges link related memories. Recalling one activates its neighbours via spreading activation." },
  { title: "Spaced reinforcement", icon: '<path d="M4 18V8m6 10V5m6 13v-7"/><circle cx="4" cy="6" r="1.5"/><circle cx="10" cy="3" r="1.5"/><circle cx="16" cy="9" r="1.5"/>', body: "Longer intervals between recalls produce larger, more durable boosts. The spacing effect, by design." },
  { title: "Cognitive types", icon: '<circle cx="12" cy="12" r="8"/><path d="M12 4v8l5 3"/>', body: "Episodic, semantic, and procedural memories each carry their own decay rate and consolidation rules." },
  { title: "Cross-agent", icon: '<path d="M7 8H4v8h3m10-8h3v8h-3M7 12h10"/>', body: "Claude Code, Codex CLI, OpenCode, and Antigravity share one store — plus the Claude and ChatGPT apps via the hosted MCP connector, and any LLM underneath. Switch model or agent, keep your memory. Identical scoring, deterministic recall everywhere." },
  { title: "Sleep & consolidation", icon: '<path d="M17 6a5 5 0 0 1 0 10h-1M7 18a5 5 0 0 1 0-10h1M9 12h6"/>', body: "A nine-phase nightly cycle: replay, consolidation, pruning, reorganization, REM-style recombination." },
  { title: "Sync your way — no lock-in", icon: '<path d="M12 3v6m0 0l3-3m-3 3L9 6m-5 9a8 8 0 0 0 16 0"/><rect x="3" y="15" width="18" height="6" rx="2"/>', body: "Plain files in a folder. Point BRAIN_DIR at Google Drive, Dropbox, or iCloud — or sync via git or encrypted export. No account required." },
];

const steps = [
  { title: "Memorize", body: 'Agents write decisions, learnings, and preferences as Markdown with YAML frontmatter. Initial strength is set by <span class="mono-em">type</span> and <span class="mono-em">impact</span>.' },
  { title: "Decay", body: "Strength decays exponentially at each memory's own rate. Episodic fades fast; procedural is sticky." },
  { title: "Recall", body: 'Deterministic scoring: <span class="mono-em">TF-IDF × decayed-strength + spreading-activation × context-match</span>. Identical results across every agent.' },
  { title: "Reinforce", body: "Recalled memories strengthen via spaced reinforcement. Longer gaps → larger boosts; the decay rate itself improves with each recall." },
  { title: "Sleep", body: "The nine-phase cycle runs maintenance: replay, synaptic homeostasis, knowledge propagation, semantic crystallization, pruning, REM recombination, expertise detection." },
];

const scenarioRows = [
  { id: "A", name: "Noisy Project Folder", pitch: "200 memories from 6 projects — does brain find the 3 relevant ones?", tests: "Retrieval under distractors · LongMemEval-S analog" },
  { id: "B", name: "Three Sessions, One Decision", pitch: "Postgres Monday, gRPC rewrite Wednesday, new resource Friday — still Postgres?", tests: "Multi-session continuity · pinned-tier ablation" },
  { id: "C", name: "The Contradiction Test", pitch: "Tabs, then spaces, then tabs again — which version wins?", tests: "Decay-weighted recency · contradiction handling" },
  { id: "D", name: "Skill Progressive Disclosure", pitch: "Five skills indexed, one needed — does brain load just the one?", tests: "Procedural skills (L0/L1/L2) token efficiency" },
  { id: "E", name: "Continual Coding", pitch: "Five bugs in order — does bug 5 finish faster than bug 1?", tests: "Forward transfer · agent writes its own memories" },
  { id: "F", name: "Abstention", pitch: "No deployment target in memory — does the agent ask or invent?", tests: "Confabulation resistance · stale-fact rejection" },
];

const neuroRows = [
  { name: "Spreading activation", impl: "Recalling memory A automatically surfaces its linked neighbours B and C along weighted edges." },
  { name: "Hebbian learning", impl: "Memories recalled together strengthen their mutual link — neurons that fire together, wire together." },
  { name: "Context-dependent recall", impl: "Memories encoded in a similar context score higher at retrieval time." },
  { name: "Spacing effect", impl: "Longer recall intervals produce larger, longer-lasting strength boosts." },
  { name: "Ebbinghaus decay", impl: "Exponential forgetting with per-memory decay rates set by cognitive type." },
  { name: "Synaptic homeostasis", impl: "Global strength down-scaling during sleep prevents runaway inflation." },
];

// The universal path — one hosted MCP connector (streamable-HTTP + OAuth)
// reaches every host below. Per-host is just how you point each one at the URL.
const connectorHosts = [
  { name: "Claude Code", vendor: "Anthropic", setup: "claude mcp add --transport http brain …/mcp" },
  { name: "Codex CLI", vendor: "OpenAI", setup: "codex mcp add brain --url …/mcp" },
  { name: "OpenCode", vendor: "Any model", setup: "opencode.json → mcp remote url" },
  { name: "Claude apps", vendor: "Anthropic", setup: "Settings → Connectors → Add (URL + OAuth)" },
  { name: "ChatGPT", vendor: "OpenAI", setup: "Settings → Connectors → custom (paid / Dev Mode)" },
  { name: "Antigravity", vendor: "Google", setup: "mcp_config.json → serverUrl" },
];

// The free local-first native plugin (~/.brain/) for the current CLIs.
const nativeHosts = [
  { name: "Claude Code", vendor: "Anthropic", flag: "--claude" },
  { name: "Codex CLI", vendor: "OpenAI", flag: "--codex" },
  { name: "OpenCode", vendor: "Any model", flag: "--opencode" },
  { name: "Antigravity", vendor: "Google", flag: "--antigravity", experimental: true },
];

const referenceGroups = [
  {
    heading: "Foundations",
    refs: [
      { title: "Cognitive Architectures for Language Agents (CoALA)", id: "arXiv 2309.02427", url: "https://arxiv.org/abs/2309.02427", note: "Sumers, Yao, Narasimhan, Griffiths — the agent-memory model Brain Memory implements. Pinned tier, procedural skills, and budget-aware working memory map to CoALA's semantic / procedural / episodic decomposition." },
      { title: "MemGPT: Towards LLMs as Operating Systems", id: "arXiv 2310.08560", url: "https://arxiv.org/abs/2310.08560", note: "Packer et al. — paging-style memory management that motivated budget-bounded working memory." },
      { title: "Generative Agents: Interactive Simulacra of Human Behavior", id: "arXiv 2304.03442", url: "https://arxiv.org/abs/2304.03442", note: "Park et al. — recency · importance · relevance retrieval that inspired the recall scoring weights." },
      { title: "Ebbinghaus — Über das Gedächtnis (1885)", id: "foundational", url: "https://en.wikipedia.org/wiki/Forgetting_curve", note: "The original forgetting curve. Brain Memory's exponential decay and spaced-reinforcement boosts follow it directly." },
    ],
  },
  {
    heading: "Memory benchmarks",
    refs: [
      { title: "LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory", id: "arXiv 2410.10813", url: "https://arxiv.org/abs/2410.10813", note: "Distractor-haystack design (Scenario A) and the rubric-based LLM judge." },
      { title: "MemoryAgentBench: A Unified Evaluation for Long-Term Memory Agents", id: "arXiv 2507.05257", url: "https://arxiv.org/abs/2507.05257", note: "Four-competency framework; FactConsolidation inspired Scenario C (The Contradiction Test)." },
      { title: "SWE-Bench-CL: Continual Learning for Coding Agents", id: "arXiv 2507.00014", url: "https://arxiv.org/abs/2507.00014", note: "Forward transfer in continual coding — basis for Scenario E." },
      { title: "Mem0 / BEAM: Memory Architectures for Production Agents", id: "arXiv 2504.19413", url: "https://arxiv.org/abs/2504.19413", note: "Tokens-per-query co-reported with accuracy — source of the tokens-per-successful-task metric." },
    ],
  },
  {
    heading: "Methodology",
    refs: [
      { title: "Preference Leakage: A Pitfall in LLM-as-a-Judge", id: "arXiv 2502.01534", url: "https://arxiv.org/abs/2502.01534", note: "Documents same-family judging cost. Brain's benchmark enforces a cross-family judge map." },
      { title: "When Judgment Becomes Noise: Position Bias in LLM Judges", id: "arXiv 2509.20293", url: "https://arxiv.org/abs/2509.20293", note: "Empirical position-bias study. Brain's benchmark uses position-swap on every pairwise judgment." },
      { title: "LastingBench: Defending Benchmarks Against Data Leakage", id: "arXiv 2506.21614", url: "https://arxiv.org/abs/2506.21614", note: "Synthetic, decay-driven scenarios guard against memorised public-set answers." },
    ],
  },
];

interface ArmRow { arm: string; tokens: string; tokensPerSuccess: string; recallAt5: string; passRate: string; }
interface AgentArmResult { subtitle: string; scenario: string; arms: ArmRow[]; }
const agentData: Record<string, AgentArmResult> = {
  "Gemini Flash": {
    subtitle: "gemini-2.5-flash · Scenario A × 1 run",
    scenario: "Scenario A — Noisy Project Folder",
    arms: [
      { arm: "bare", tokens: "24.1K", tokensPerSuccess: "24.1K", recallAt5: "—", passRate: "100%" },
      { arm: "fixture-only", tokens: "16.8K", tokensPerSuccess: "16.8K", recallAt5: "—", passRate: "100%" },
      { arm: "brain-real", tokens: "27.8K", tokensPerSuccess: "27.8K", recallAt5: "0.33", passRate: "100%" },
      { arm: "brain-no-recall", tokens: "43.6K", tokensPerSuccess: "43.6K", recallAt5: "—", passRate: "100%" },
      { arm: "brain-no-pin", tokens: "86.3K", tokensPerSuccess: "86.3K", recallAt5: "0.33", passRate: "100%" },
      { arm: "context-dump", tokens: "50.8K", tokensPerSuccess: "50.8K", recallAt5: "—", passRate: "100%" },
    ],
  },
  "OpenCode → DeepSeek V4 Pro": {
    subtitle: "deepseek/deepseek-v4-pro · Scenario A × 1 run",
    scenario: "Scenario A — Noisy Project Folder",
    arms: [
      { arm: "bare", tokens: "20.0K", tokensPerSuccess: "20.0K", recallAt5: "—", passRate: "100%" },
      { arm: "fixture-only", tokens: "13.8K", tokensPerSuccess: "13.8K", recallAt5: "—", passRate: "100%" },
      { arm: "brain-real", tokens: "timeout", tokensPerSuccess: "—", recallAt5: "—", passRate: "0%" },
      { arm: "brain-no-recall", tokens: "19.7K", tokensPerSuccess: "19.7K", recallAt5: "—", passRate: "100%" },
      { arm: "brain-no-pin", tokens: "17.5K", tokensPerSuccess: "17.5K", recallAt5: "0.33", passRate: "100%" },
      { arm: "context-dump", tokens: "timeout", tokensPerSuccess: "—", recallAt5: "—", passRate: "0%" },
    ],
  },
};
