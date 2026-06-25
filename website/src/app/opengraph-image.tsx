import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Branded 1200×630 Open Graph / Twitter image, generated at build time.
// Rendered to a static PNG under `output: export`. Next automatically injects
// the resulting absolute og:image / twitter:image meta on every route.
export const dynamic = "force-static";

// The real "Neon glow" app icon (Satori can't render its SVG filters/gradients,
// so we embed the pre-rasterized PNG produced by website/scripts/gen-icon.mjs).
const ICON_DATA_URI =
  "data:image/png;base64," +
  readFileSync(join(process.cwd(), "public/icon.png")).toString("base64");
export const alt = "Brain Memory — Memory for AI agents, modeled on the brain.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand palette: cyan on near-black "deep-lab" aesthetic (the technical
// design's dark variant — bold and legible in social feeds).
const BG = "#07090A";
const CYAN = "#5BC8FF";
const TEXT = "#EAF1F5";
const MUTED = "#9AA6AD";
const DIM = "#5A6369";

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
            "radial-gradient(900px 500px at 78% -10%, rgba(70,198,255,0.18), rgba(7,9,10,0))",
          padding: "76px 80px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Brand lockup */}
        <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ICON_DATA_URI}
            width={96}
            height={96}
            alt="Brain Memory"
            style={{ borderRadius: 22 }}
          />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span
              style={{
                color: CYAN,
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
              color: CYAN,
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
          <span style={{ color: CYAN, fontSize: 27, letterSpacing: 1 }}>
            brainmemory.ai
          </span>
          <span style={{ color: DIM, fontSize: 25 }}>npm i -g brain-memory</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
