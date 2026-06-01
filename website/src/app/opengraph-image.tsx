import { ImageResponse } from "next/og";

// Branded 1200×630 Open Graph / Twitter image, generated at build time.
// Rendered to a static PNG under `output: export`. Next automatically injects
// the resulting absolute og:image / twitter:image meta on every route.
export const dynamic = "force-static";
export const alt = "Brain Memory — Memory for AI agents, modeled on the brain.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand palette (see CLAUDE.md): amber on near-black "deep-lab" aesthetic.
const BG = "#07090A";
const AMBER = "#E8A33D";
const AMBER_BRIGHT = "#FFDD8C";
const TEXT = "#F5F3EE";
const MUTED = "#9AA0A6";
const DIM = "#5A6066";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: BG,
          backgroundImage:
            "radial-gradient(900px 500px at 78% -10%, rgba(232,163,61,0.16), rgba(7,9,10,0))",
          padding: "76px 80px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Brand lockup */}
        <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 22,
              backgroundColor: "#0C0F10",
              border: "1px solid #1C2226",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: "50%",
                backgroundColor: AMBER_BRIGHT,
                boxShadow: `0 0 44px 12px rgba(232,163,61,0.7)`,
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span
              style={{
                color: AMBER,
                fontSize: 30,
                fontWeight: 700,
                letterSpacing: 9,
              }}
            >
              BRAIN MEMORY
            </span>
            <span style={{ color: DIM, fontSize: 22, letterSpacing: 2 }}>
              by Omelas
            </span>
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span
            style={{ color: TEXT, fontSize: 76, fontWeight: 700, lineHeight: 1.04 }}
          >
            Memory for AI agents,
          </span>
          <span
            style={{
              color: AMBER,
              fontSize: 76,
              fontStyle: "italic",
              fontWeight: 600,
              lineHeight: 1.1,
            }}
          >
            modeled on the brain.
          </span>
          <span
            style={{
              marginTop: 30,
              color: MUTED,
              fontSize: 30,
              lineHeight: 1.35,
              maxWidth: 1000,
            }}
          >
            Decays on an Ebbinghaus curve, strengthens through recall, consolidates
            during sleep — deterministic across Claude Code, Gemini, Codex &amp;
            OpenCode.
          </span>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ color: AMBER, fontSize: 27, letterSpacing: 1 }}>
            brainmemory.work
          </span>
          <span style={{ color: DIM, fontSize: 25 }}>npm i -g brain-memory</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
