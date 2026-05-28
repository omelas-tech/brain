"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import Header from "./components/Header";
import Footer from "./components/Footer";

export default function Home() {
  return (
    <div className="min-h-dvh">
      <Header />

      <main className="max-w-3xl mx-auto px-5 sm:px-6">
        {/* ─── Hero ─────────────────────────────────────────────────── */}
        <section className="pt-[var(--space-hero-top)] pb-[var(--space-hero-bottom)]">
          <div className="grid lg:grid-cols-[1fr_auto] gap-10 lg:gap-12 items-center">
            <div>
              <h1
                className="font-semibold tracking-tight leading-[1.04] mb-6 sm:mb-8 text-[var(--text-primary)] fade-in"
                style={{ fontSize: "var(--fs-h1)" }}
              >
                Memory for AI agents,{" "}
                <span className="italic text-[var(--text-secondary)]">
                  modeled on the brain.
                </span>
              </h1>
              <p
                className="text-[var(--text-secondary)] leading-relaxed mb-8 max-w-xl fade-in fade-in-delay-1"
                style={{ fontSize: "var(--fs-lead)" }}
              >
                Hierarchical, file-system-based memory that decays, strengthens
                through recall, and consolidates during sleep. Claude Code,
                Gemini CLI, and Codex CLI — one brain, all agents.
              </p>
              <div className="flex flex-wrap items-center gap-3 fade-in fade-in-delay-2">
                <Link
                  href="/docs"
                  className="font-mono text-sm font-medium bg-[var(--text-primary)] text-[var(--bg)] hover:bg-[var(--accent)] transition-colors px-4 py-2 rounded-md"
                >
                  get started
                </Link>
                <CopyButton />
              </div>
              <div className="mt-6 flex flex-wrap gap-3 fade-in fade-in-delay-3">
                <img src="https://img.shields.io/npm/v/brain-memory" alt="npm version" className="h-5" />
                <img src="https://github.com/onurkarali/actions/workflows/ci.yml/badge.svg" alt="CI" className="h-5" />
                <img src="https://img.shields.io/npm/l/brain-memory" alt="license" className="h-5" />
              </div>
            </div>

            <div className="hidden lg:block fade-in fade-in-delay-3">
              <Image
                src="/icon.svg"
                alt="Brain Memory"
                width={220}
                height={220}
                className="rounded-[44px]"
                priority
              />
            </div>
          </div>
        </section>

        {/* ─── 01 Features ──────────────────────────────────────────── */}
        <Section number="01" title="What's inside">
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-7">
            <Feature
              title="Hierarchical memory"
              description="The directory tree is the semantic structure. Browseable in any file explorer."
            />
            <Feature
              title="Strength & decay"
              description="Memories fade following Ebbinghaus' forgetting curve. Recalled memories strengthen."
            />
            <Feature
              title="Associative network"
              description="Weighted connections between memories. Recalling one activates related ones."
            />
            <Feature
              title="Spaced reinforcement"
              description="Longer recall intervals produce larger boosts. Diminishing returns on cramming."
            />
            <Feature
              title="Cognitive types"
              description="Episodic, semantic, and procedural memories each decay differently."
            />
            <Feature
              title="Cross-agent"
              description="Claude Code, Gemini CLI, Codex CLI. Same memory store, deterministic recall."
            />
            <Feature
              title="Sleep & consolidation"
              description="Nine-phase nightly cycle: replay, consolidation, pruning, reorganization."
            />
            <Feature
              title="Portable sync"
              description="Git remote or AES-256-GCM encrypted export. Self-hosted on your VPS."
            />
          </div>
        </Section>

        {/* ─── 02 How it works ──────────────────────────────────────── */}
        <Section number="02" title="How it works">
          <ol className="space-y-7">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-5">
                <span className="font-mono text-xs text-[var(--text-tertiary)] pt-1 tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="font-semibold text-[var(--text-primary)] mb-1">{s.title}</h3>
                  <p className="text-[var(--text-secondary)] leading-relaxed text-[0.9375rem]">
                    {s.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        {/* ─── 03 Benchmarks ────────────────────────────────────────── */}
        <Section number="03" title="Benchmark results">
          <p className="text-[var(--text-secondary)] leading-relaxed mb-2 text-[0.9375rem]">
            Six-scenario suite grounded in 2025-2026 long-term-memory eval methodology (LongMemEval, MemoryAgentBench, SWE-Bench-CL, Mem0 / BEAM). Cross-family LLM judge, distractor haystacks, N-arm matrix.{" "}
            <a
              href="/docs/benchmarks"
              className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
            >
              Methodology →
            </a>{" "}
            <a
              href="/docs/benchmarks/results"
              className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
            >
              Live results →
            </a>
          </p>
          <p className="text-[var(--text-tertiary)] text-xs mb-8 font-mono">
            Preliminary — 1 run × Scenario A × Gemini Flash, May 2026. Full multi-run results in progress.
          </p>

          <div className="grid sm:grid-cols-3 gap-px bg-[var(--border)] rounded-lg overflow-hidden border border-[var(--border)] mb-8">
            <Stat label="brain-real tokens / success" value="27.8K" />
            <Stat label="context-dump tokens / success" value="50.8K" />
            <Stat label="brain-no-pin tokens / success" value="86.3K" />
          </div>

          <div className="border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--surface)] mb-6">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
                  <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">scenario</th>
                  <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">tests</th>
                </tr>
              </thead>
              <tbody>
                {scenarioRows.map((r, i) => (
                  <tr key={r.id} className={i < scenarioRows.length - 1 ? "border-b border-[var(--border-subtle)]" : ""}>
                    <td className="px-5 py-3.5">
                      <div className="text-[var(--text-primary)] font-medium">
                        <span className="font-mono text-[var(--text-tertiary)] mr-2">{r.id}</span>
                        {r.name}
                      </div>
                      <div className="text-xs text-[var(--text-tertiary)] mt-0.5 italic">&ldquo;{r.pitch}&rdquo;</div>
                    </td>
                    <td className="px-5 py-3.5 text-[var(--text-secondary)] text-xs">{r.tests}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <BenchmarkAgentDetails />
        </Section>

        {/* ─── 04 Neuroscience ──────────────────────────────────────── */}
        <Section number="04" title="Neuroscience foundations">
          <div className="border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--surface)]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
                  <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">mechanism</th>
                  <th className="px-5 py-3 font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">implementation</th>
                </tr>
              </thead>
              <tbody>
                {neuroRows.map((r, i) => (
                  <tr key={r.name} className={i < neuroRows.length - 1 ? "border-b border-[var(--border-subtle)]" : ""}>
                    <td className="px-5 py-3.5 text-[var(--text-primary)] font-medium">{r.name}</td>
                    <td className="px-5 py-3.5 text-[var(--text-secondary)]">{r.impl}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ─── 05 Compatibility ─────────────────────────────────────── */}
        <Section number="05" title="Compatibility">
          <div className="grid sm:grid-cols-3 gap-px bg-[var(--border)] rounded-lg overflow-hidden border border-[var(--border)]">
            <AgentCell name="Claude Code" vendor="anthropic" cmd="brain-memory --claude --global" />
            <AgentCell name="Gemini CLI" vendor="google" cmd="brain-memory --gemini --global" />
            <AgentCell name="Codex CLI" vendor="openai" cmd="brain-memory --codex --global" />
          </div>
        </Section>

        {/* ─── 06 Quick start ───────────────────────────────────────── */}
        <Section number="06" title="Quick start">
          <div className="border border-[var(--border)] rounded-lg p-6 bg-[var(--surface)] mb-4">
            <code className="font-mono text-base sm:text-lg text-[var(--text-primary)]">
              <span className="text-[var(--text-tertiary)]">$ </span>
              npm install -g brain-memory@beta
            </code>
          </div>
          <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
            Install globally, then run{" "}
            <code className="font-mono text-xs bg-[var(--surface-2)] border border-[var(--border)] px-1.5 py-0.5 rounded">brain-memory</code>{" "}
            to configure your runtime(s).
          </p>
        </Section>
      </main>

      <Footer />
    </div>
  );
}

/* ─── Section wrapper ─────────────────────────────────────────────── */
function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-[var(--space-section)] border-t border-[var(--border)]">
      <div className="flex items-baseline gap-3 mb-8">
        <span className="font-mono text-xs text-[var(--text-tertiary)] tabular-nums">{number}</span>
        <h2
          className="font-semibold text-[var(--text-primary)] tracking-tight"
          style={{ fontSize: "var(--fs-h2)" }}
        >
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function Feature({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="font-semibold text-[var(--text-primary)] mb-1.5">{title}</h3>
      <p className="text-[var(--text-secondary)] leading-relaxed text-[0.9375rem]">{description}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--surface)] p-5">
      <div className="text-2xl font-semibold text-[var(--text-primary)] tracking-tight mb-1">{value}</div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">{label}</div>
    </div>
  );
}

function AgentCell({ name, vendor, cmd }: { name: string; vendor: string; cmd: string }) {
  return (
    <div className="bg-[var(--surface)] p-5">
      <div className="font-semibold text-[var(--text-primary)] mb-0.5">{name}</div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-3">{vendor}</div>
      <code className="block font-mono text-xs bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1.5 text-[var(--text-secondary)] overflow-x-auto whitespace-nowrap">
        {cmd}
      </code>
    </div>
  );
}


/* ─── Copy Button ─────────────────────────────────────────────────── */
function CopyButton() {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText("npm install -g brain-memory@beta");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="font-mono text-xs border border-[var(--border-strong)] hover:border-[var(--text-primary)] rounded-md px-3 py-2 inline-flex items-center gap-2 transition-colors"
    >
      <span className="text-[var(--text-tertiary)]">$</span>
      <span className="text-[var(--text-primary)]">npm i -g brain-memory</span>
      <span className="text-[var(--text-tertiary)]">{copied ? "✓" : "⧉"}</span>
    </button>
  );
}

/* ─── Static content ──────────────────────────────────────────────── */
const steps = [
  {
    title: "Memorize",
    body: "Agents store decisions, learnings, and preferences as Markdown files with YAML frontmatter. Initial strength is set by type and impact.",
  },
  {
    title: "Decay",
    body: "Strength decays exponentially per memory's decay rate. Episodic fades fast; procedural is sticky.",
  },
  {
    title: "Recall",
    body: "Deterministic TF-IDF + decayed strength + spreading activation + context match. Identical scoring across all agents.",
  },
  {
    title: "Reinforce",
    body: "Recalled memories strengthen via spaced reinforcement. Longer gaps → larger boosts. Decay rate improves with each recall.",
  },
  {
    title: "Sleep",
    body: "Nine-phase maintenance: replay, synaptic homeostasis, knowledge propagation, semantic crystallization, reorganize, consolidate, prune, REM dream, expertise detection.",
  },
];

const scenarioRows = [
  { id: "A", name: "Noisy Project Folder", pitch: "200 memories from 6 projects — does brain find the 3 relevant ones?", tests: "Retrieval under distractors (LongMemEval-S analog)" },
  { id: "B", name: "Three Sessions, One Decision", pitch: "Postgres Monday, gRPC rewrite Wednesday, new resource Friday — still Postgres?", tests: "Multi-session continuity + pinned tier ablation" },
  { id: "C", name: "The Contradiction Test", pitch: "Tabs, then spaces, then tabs again — which version wins?", tests: "Decay-weighted recency + contradiction handling" },
  { id: "D", name: "Skill Progressive Disclosure", pitch: "Five skills indexed, one needed — does brain load just the one?", tests: "Procedural skills (L0/L1/L2) token efficiency" },
  { id: "E", name: "Continual Coding", pitch: "Five bugs in order — does bug 5 finish faster than bug 1?", tests: "Forward transfer + agent writes its own memories" },
  { id: "F", name: "Abstention", pitch: "No deployment target in memory — does the agent ask or invent?", tests: "Confabulation resistance" },
];

const neuroRows = [
  { name: "Spreading activation", impl: "Recalling memory A automatically surfaces linked memories B and C." },
  { name: "Hebbian learning", impl: "Memories recalled together strengthen mutual links." },
  { name: "Context-dependent recall", impl: "Memories encoded in similar context score higher at retrieval." },
  { name: "Spacing effect", impl: "Longer recall intervals produce larger strength boosts." },
  { name: "Ebbinghaus decay", impl: "Exponential forgetting with per-memory decay rates." },
  { name: "Synaptic homeostasis", impl: "Global strength downscaling during sleep prevents inflation." },
];

/* ─── Benchmark Agent Details (arm matrix per agent, Scenario A) ──────────── */
interface ArmRow {
  arm: string;
  tokens: string;
  tokensPerSuccess: string;
  recallAt5: string;
  passRate: string;
}
interface AgentArmResult {
  subtitle: string;
  scenario: string;
  arms: ArmRow[];
}
const agentData: Record<string, AgentArmResult> = {
  "Gemini Flash": {
    subtitle: "gemini-2.5-flash · Scenario A × 1 run",
    scenario: "A — Noisy Project Folder",
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
    scenario: "A — Noisy Project Folder",
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

function BenchmarkAgentDetails() {
  const agents = Object.keys(agentData);
  const [activeAgent, setActiveAgent] = useState(agents[0]);
  const data = agentData[activeAgent];

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {agents.map((agent) => (
          <button
            key={agent}
            onClick={() => setActiveAgent(agent)}
            className={`font-mono text-xs px-3 py-1.5 rounded-md transition-colors ${
              activeAgent === agent
                ? "bg-[var(--text-primary)] text-[var(--bg)]"
                : "border border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-primary)]"
            }`}
          >
            {agent}
          </button>
        ))}
      </div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)] mb-4">
        {data.subtitle}
      </p>

      <div className="border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--surface)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">arm</th>
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] text-right">tokens</th>
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] text-right">tok / success</th>
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] text-right">recall@5</th>
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] text-right">pass</th>
              </tr>
            </thead>
            <tbody>
              {data.arms.map((row, i) => {
                const isHero = row.arm === "brain-real";
                const isTimeout = row.tokens === "timeout";
                return (
                  <tr
                    key={row.arm}
                    className={`${i < data.arms.length - 1 ? "border-b border-[var(--border-subtle)]" : ""} ${isHero ? "bg-[var(--surface-2)]" : ""}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-[var(--text-primary)] font-medium">{row.arm}</td>
                    <td className={`px-4 py-3 text-right font-mono ${isTimeout ? "text-[var(--danger)]" : "text-[var(--text-secondary)]"}`}>
                      {row.tokens}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[var(--text-tertiary)]">{row.tokensPerSuccess}</td>
                    <td className="px-4 py-3 text-right font-mono text-[var(--text-tertiary)]">{row.recallAt5}</td>
                    <td className={`px-4 py-3 text-right font-mono text-xs ${row.passRate === "0%" ? "text-[var(--danger)]" : "text-[var(--text-secondary)]"}`}>
                      {row.passRate}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)] mt-3">
        scenario A · 1 run · all arms judged by cross-family LLM (claude)
      </p>
    </div>
  );
}
