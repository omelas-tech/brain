"use client";

/**
 * Benchmark charts for the Sonnet 5.5 suite (2026-11-10).
 *
 * Encoding is shared by every chart so a reader learns it once:
 *   brain arm      → filled, --viz-brain (the emphasis hue)
 *   baseline arm   → filled, --viz-base  (best non-brain retriever / dump)
 *   no-memory floor→ filled, --viz-floor (gray)
 *   oracle ceiling → hollow ring in secondary ink
 * Colors were checked with the dataviz validate_palette.js (light + dark).
 * Every value plotted here is also in the tables on the same page.
 */

import { useEffect, useRef, useState } from "react";

type Role = "floor" | "base" | "brain" | "oracle";

const ROLE_LABEL: Record<Role, string> = {
  floor: "No memory (floor)",
  base: "Best baseline",
  brain: "Brain",
  oracle: "Oracle (ceiling)",
};

function Marker({ role, size = 10 }: { role: Role; size?: number }) {
  const style: React.CSSProperties =
    role === "oracle"
      ? { border: "2px solid var(--text-secondary)", background: "var(--surface)" }
      : {
          background: `var(--viz-${role})`,
          boxShadow: "0 0 0 2px var(--surface)",
        };
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, ...style }}
    />
  );
}

function Legend({ roles }: { roles: Role[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[11px] text-[var(--text-secondary)]">
      {roles.map((r) => (
        <span key={r} className="inline-flex items-center gap-1.5">
          <Marker role={r} size={r === "brain" ? 11 : 9} />
          {ROLE_LABEL[r]}
        </span>
      ))}
    </div>
  );
}

function Frame({
  title,
  subtitle,
  children,
  footnote,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footnote?: React.ReactNode;
}) {
  return (
    <figure className="not-prose my-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <figcaption className="mb-4">
        <div className="text-[15px] font-semibold leading-snug tracking-tight text-[var(--text-primary)]">
          {title}
        </div>
        <div className="mt-0.5 text-[13px] leading-snug text-[var(--text-secondary)]">{subtitle}</div>
      </figcaption>
      {children}
      {footnote && (
        <div className="mt-4 border-t border-[var(--border-subtle)] pt-3 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
          {footnote}
        </div>
      )}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Tooltip — one per chart, positioned inside the chart's own box.    */
/* ------------------------------------------------------------------ */

type Tip = { x: number; y: number; lines: string[] } | null;

function useTip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const show = (el: Element, lines: string[]) => {
    const b = box.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!b) return;
    setTip({ x: r.left + r.width / 2 - b.left, y: r.top - b.top, lines });
  };
  const hide = () => setTip(null);
  return { box, tip, show, hide };
}

function TipBox({ tip, width }: { tip: Tip; width: number }) {
  if (!tip) return null;
  const W = 210;
  const left = Math.max(0, Math.min(tip.x - W / 2, width - W));
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] leading-snug shadow-lg"
      style={{ left, top: tip.y - 8, width: W, transform: "translateY(-100%)" }}
    >
      <div className="font-semibold text-[var(--text-primary)]">{tip.lines[0]}</div>
      {tip.lines.slice(1).map((l) => (
        <div key={l} className="text-[var(--text-secondary)]">
          {l}
        </div>
      ))}
    </div>
  );
}

function useWidth(ref: React.RefObject<HTMLDivElement | null>, fallback: number) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/* ------------------------------------------------------------------ */
/* 1. Suite overview — pass rate per scenario, four lanes per row.    */
/* ------------------------------------------------------------------ */

type Row = {
  id: string;
  name: string;
  floor: number;
  base: number;
  baseName: string;
  brain: number;
  brainName: string;
  oracle: number;
  verdict: "Win" | "Tie" | "Null";
  note: string;
};

const SUITE: Row[] = [
  { id: "A", name: "Noisy folder", floor: 0, base: 0, baseName: "BM25 / vector", brain: 9, brainName: "brain-full", oracle: 10, verdict: "Win", note: "retrievers fail under 1000 distractors" },
  { id: "B", name: "Three sessions", floor: 0, base: 10, baseName: "BM25", brain: 10, brainName: "brain-real", oracle: 10, verdict: "Tie", note: "BM25 ~800 tokens leaner" },
  { id: "C", name: "Contradiction", floor: 0, base: 10, baseName: "BM25", brain: 10, brainName: "brain-real", oracle: 10, verdict: "Tie", note: "BM25 ~250 tokens leaner" },
  { id: "D", name: "Skills", floor: 0, base: 10, baseName: "all skills loaded", brain: 10, brainName: "one skill loaded", oracle: 10, verdict: "Win", note: "same pass rate, 28% fewer tokens" },
  { id: "F", name: "Abstention", floor: 10, base: 10, baseName: "BM25", brain: 10, brainName: "brain-real", oracle: 10, verdict: "Null", note: "the model abstains without memory" },
  { id: "G", name: "Poisoned memory", floor: 9, base: 9, baseName: "context dump", brain: 10, brainName: "brain-enforce", oracle: 10, verdict: "Win", note: "quarantine off: 0/10, all refused" },
];

const LANES: Role[] = ["floor", "base", "brain", "oracle"];

export function SuiteDotPlot() {
  const { box, tip, show, hide } = useTip();
  const width = useWidth(box, 640);

  return (
    <Frame
      title="Runs passed out of 10, per scenario"
      subtitle="Claude Sonnet 5.5, single-shot, N=10 per arm. Each row has four lanes: floor, best baseline, brain, oracle."
      footnote={
        <>
          D&rsquo;s baseline is loading every skill body; G&rsquo;s is the whole haystack dumped into the prompt.
          In G, brain with quarantine switched off passed 0/10 because Claude&rsquo;s API refused every run.
        </>
      }
    >
      <div className="mb-4">
        <Legend roles={LANES} />
      </div>
      <div ref={box} className="relative">
        {/* axis header */}
        <div className="grid grid-cols-[6.5rem_1fr] gap-x-3 sm:grid-cols-[8.5rem_1fr_12.5rem]">
          <div />
          <div className="relative h-4 font-mono text-[10px] text-[var(--text-tertiary)]">
            {[0, 5, 10].map((v) => (
              <span
                key={v}
                className="absolute -translate-x-1/2"
                style={{ left: `${v * 10}%` }}
              >
                {v}
              </span>
            ))}
          </div>
          <div className="hidden sm:block" />
        </div>

        {SUITE.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[6.5rem_1fr] items-center gap-x-3 border-t border-[var(--border-subtle)] py-2 sm:grid-cols-[8.5rem_1fr_12.5rem]"
          >
            <div className="leading-tight">
              <span className="mr-1.5 font-mono text-[11px] text-[var(--text-tertiary)]">{r.id}</span>
              <span className="text-[13px] text-[var(--text-primary)]">{r.name}</span>
            </div>

            <div className="relative h-[46px]">
              {[0, 5, 10].map((v) => (
                <span
                  key={v}
                  aria-hidden
                  className="absolute top-0 bottom-0 w-px"
                  style={{ left: `${v * 10}%`, background: v === 0 ? "var(--grid-major)" : "var(--grid-minor)" }}
                />
              ))}
              {LANES.map((role, i) => {
                const v = r[role];
                const who =
                  role === "base" ? r.baseName : role === "brain" ? r.brainName : ROLE_LABEL[role];
                const size = role === "brain" ? 12 : 10;
                return (
                  <button
                    key={role}
                    type="button"
                    aria-label={`Scenario ${r.id}, ${ROLE_LABEL[role]} (${who}): ${v} of 10 passed`}
                    onPointerEnter={(e) => show(e.currentTarget, [`${r.id} · ${ROLE_LABEL[role]}`, who, `${v}/10 passed`])}
                    onPointerLeave={hide}
                    onFocus={(e) => show(e.currentTarget, [`${r.id} · ${ROLE_LABEL[role]}`, who, `${v}/10 passed`])}
                    onBlur={hide}
                    className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-default items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    style={{ left: `${v * 10}%`, top: 5 + i * 12 }}
                  >
                    <Marker role={role} size={size} />
                  </button>
                );
              })}
            </div>

            <div className="col-start-2 flex items-baseline gap-2 pt-1 sm:col-start-3 sm:pt-0">
              <span
                className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
                style={
                  r.verdict === "Win"
                    ? { color: "var(--accent-text)", background: "var(--accent-soft)" }
                    : { color: "var(--text-secondary)", background: "var(--surface-3)" }
                }
              >
                {r.verdict}
              </span>
              <span className="text-[12px] leading-snug text-[var(--text-secondary)]">{r.note}</span>
            </div>
          </div>
        ))}
        <div className="grid grid-cols-[6.5rem_1fr] gap-x-3 sm:grid-cols-[8.5rem_1fr_12.5rem]">
          <div />
          <div className="pt-1 text-center font-mono text-[10px] text-[var(--text-tertiary)]">runs passed (of 10)</div>
        </div>
        <TipBox tip={tip} width={width} />
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Scenario A — what each approach paid for its pass rate.         */
/* ------------------------------------------------------------------ */

type Pt = {
  name: string;
  role: Role;
  tokens: number;
  pass: number;
  /** label placement relative to the mark */
  pos: "above-start" | "above-end" | "below" | "below-end" | "below-start" | "none";
  /** placement when the chart is narrower than 520px */
  compact?: Pt["pos"];
  short?: string;
};

const SCENARIO_A: Pt[] = [
  { name: "no memory", role: "floor", tokens: 1916, pass: 0, pos: "below-end" },
  { name: "vector store", role: "base", tokens: 2504, pass: 0, pos: "none" },
  { name: "BM25 · vector", role: "base", tokens: 2632, pass: 0, pos: "above-start" },
  { name: "brain, session start", role: "brain", tokens: 3777, pass: 9, pos: "below", compact: "below-end" },
  { name: "oracle", role: "oracle", tokens: 4447, pass: 10, pos: "above-end" },
  { name: "brain, model calls recall", role: "brain", tokens: 4947, pass: 10, pos: "above-start", compact: "below-start", short: "brain, recall tool" },
  { name: "dump 8k", role: "base", tokens: 15314, pass: 10, pos: "above-start" },
  { name: "dump 60k", role: "base", tokens: 85135, pass: 10, pos: "above-end", short: "60k" },
];

const TIP_NAME: Record<string, string> = {
  "BM25 · vector": "keyword (BM25)",
  "vector store": "vector-baseline",
  "dump 8k": "context dump, 8k",
  "dump 60k": "context dump, 60k",
};

export function ScenarioACost() {
  const { box, tip, show, hide } = useTip();
  const width = useWidth(box, 640);
  const H = 300;
  const m = { l: 34, r: 14, t: 26, b: 44 };
  const pw = Math.max(200, width - m.l - m.r);
  const ph = H - m.t - m.b;
  const lx = (t: number) => m.l + ((Math.log10(t) - 3) / 2) * pw; // 1k..100k
  const ly = (p: number) => m.t + ph - ((p + 0.8) / 11.6) * ph; // pad so 0 and 10 sit inside
  const xticks = [1000, 3000, 10000, 30000, 100000];
  const fmt = (t: number) => (t >= 1000 ? `${t / 1000}k` : String(t));

  return (
    <Frame
      title="Scenario A: pass rate against what it cost"
      subtitle="1000 distractor memories. Up and to the left is better. Median tokens per run on a log scale."
      footnote={
        <>
          The two context dumps pass by putting the whole corpus in the prompt, at 4× and 22× brain&rsquo;s median tokens.
          BM25 and the vector store sit almost on top of each other at 0/10.
        </>
      }
    >
      <div className="mb-3">
        <Legend roles={["floor", "base", "brain", "oracle"]} />
      </div>
      <div ref={box} className="relative">
        <svg width={width} height={H} role="img" aria-label="Scatter of pass rate against median tokens for scenario A arms" className="block overflow-visible">
          {/* grid */}
          {[0, 5, 10].map((p) => (
            <g key={p}>
              <line x1={m.l} x2={m.l + pw} y1={ly(p)} y2={ly(p)} stroke={p === 0 ? "var(--grid-major)" : "var(--grid-minor)"} />
              <text x={m.l - 8} y={ly(p)} dy="0.32em" textAnchor="end" className="fill-[var(--text-tertiary)] font-mono" fontSize={10}>
                {p}
              </text>
            </g>
          ))}
          {xticks.map((t) => (
            <g key={t}>
              <line x1={lx(t)} x2={lx(t)} y1={m.t} y2={m.t + ph} stroke="var(--grid-minor)" />
              <text x={lx(t)} y={m.t + ph + 16} textAnchor="middle" className="fill-[var(--text-tertiary)] font-mono" fontSize={10}>
                {fmt(t)}
              </text>
            </g>
          ))}
          <text x={m.l + pw / 2} y={H - 6} textAnchor="middle" className="fill-[var(--text-tertiary)] font-mono" fontSize={10}>
            median tokens per run
          </text>
          <text x={m.l - 8} y={m.t - 12} textAnchor="start" className="fill-[var(--text-tertiary)] font-mono" fontSize={10}>
            passed / 10
          </text>

          {/* marks */}
          {SCENARIO_A.map((p) => {
            const x = lx(p.tokens);
            const y = ly(p.pass);
            const r = p.role === "brain" ? 6 : 5;
            const lines = [TIP_NAME[p.name] ?? p.name, `${p.pass}/10 passed`, `${p.tokens.toLocaleString("en-US")} median tokens`];
            return (
              <g
                key={p.name}
                tabIndex={0}
                role="button"
                aria-label={`${lines[0]}: ${lines[1]}, ${lines[2]}`}
                onPointerEnter={(e) => show(e.currentTarget, lines)}
                onPointerLeave={hide}
                onFocus={(e) => show(e.currentTarget, lines)}
                onBlur={hide}
                className="cursor-default outline-none"
              >
                <circle cx={x} cy={y} r={12} fill="transparent" />
                {p.role === "oracle" ? (
                  <circle cx={x} cy={y} r={r} fill="var(--surface)" stroke="var(--text-secondary)" strokeWidth={2} />
                ) : (
                  <circle cx={x} cy={y} r={r} fill={`var(--viz-${p.role})`} stroke="var(--surface)" strokeWidth={2} />
                )}
              </g>
            );
          })}

          {/* direct labels (text ink, never series color) */}
          {SCENARIO_A.filter((p) => p.pos !== "none").map((p) => {
            const x = lx(p.tokens);
            const y = ly(p.pass);
            const compact = width < 520;
            const pos = (compact && p.compact) || p.pos;
            const [vert, h] = pos.split("-") as ["above" | "below", "start" | "end" | undefined];
            const dy = vert === "above" ? -11 : 19;
            const dx = h === "start" ? -2 : h === "end" ? 2 : 0;
            const anchor = h === "start" ? "start" : h === "end" ? "end" : "middle";
            return (
              <text
                key={`l-${p.name}`}
                x={x + dx}
                y={y + dy}
                textAnchor={anchor}
                fontSize={11}
                className={p.role === "brain" ? "fill-[var(--text-primary)] font-semibold" : "fill-[var(--text-secondary)]"}
                pointerEvents="none"
              >
                {(compact && p.short) || p.name}
              </text>
            );
          })}
        </svg>
        <TipBox tip={tip} width={width} />
      </div>
    </Frame>
  );
}
