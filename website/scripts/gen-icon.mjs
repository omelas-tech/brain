// Generates the Brain Memory "firing-neuron activation" brand mark in the
// technical-white identity's brand cyan (#46C6FF), then writes every SVG asset
// and rasterizes the PNGs. Run: node website/scripts/gen-icon.mjs
//
// Geometry matches the design handoff's inline #bm-glyph (Brain Memory —
// Technical.html) and the React <Glyph> component, so the mark is identical
// everywhere it appears (nav, favicon, app icon, cloud panel).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLOUD = path.resolve(ROOT, "..", "brain-cloud");
const TILE = "#07090A"; // brand near-black "deep-lab" rounded square

// The firing neuron, in 0..32 space (cyan shades baked into the fills).
const NEURON = `
  <circle cx="16" cy="16" r="12" fill="url(#core)" opacity="0.7"/>
  <g stroke="#2E9FD6" stroke-width="1.25" stroke-linecap="round">
    <line x1="16" y1="16" x2="8"  y2="8"  stroke-opacity="0.4"/>
    <line x1="16" y1="16" x2="25" y2="8"  stroke-opacity="0.82"/>
    <line x1="16" y1="16" x2="27" y2="17" stroke-opacity="0.5"/>
    <line x1="16" y1="16" x2="24" y2="25" stroke-opacity="0.75"/>
    <line x1="16" y1="16" x2="8"  y2="23" stroke-opacity="0.4"/>
    <line x1="16" y1="16" x2="6"  y2="16" stroke-opacity="0.35"/>
  </g>
  <circle cx="8"  cy="8"  r="1.6" fill="#1C7FB0"/>
  <circle cx="27" cy="17" r="1.4" fill="#4FB8E6"/>
  <circle cx="24" cy="25" r="1.9" fill="#2E9FD6"/>
  <circle cx="8"  cy="23" r="1.6" fill="#2389BE"/>
  <circle cx="6"  cy="16" r="1.3" fill="#1B6E97"/>
  <circle cx="25" cy="8"  r="2.4" fill="#6FD3FF"/>
  <circle cx="21" cy="11.5" r="1.3" fill="#CFEEFF"/>
  <circle cx="16" cy="16" r="3.7" fill="#DFF4FF"/>
  <circle cx="16" cy="16" r="1.9" fill="#FFFFFF"/>`;

const CORE_GRADIENT = `<radialGradient id="core" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#8FDDFF" stop-opacity="0.95"/><stop offset="100%" stop-color="#46C6FF" stop-opacity="0"/></radialGradient>`;

// Rounded-square brand tile + neuron — for favicons / app icon.
const tileSvg = (px) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${px}" height="${px}" role="img" aria-label="Brain Memory">` +
  `<defs>${CORE_GRADIENT}</defs>` +
  `<rect x="0" y="0" width="32" height="32" rx="7" ry="7" fill="${TILE}"/>` +
  `${NEURON}</svg>\n`;
// Transparent mark (no tile) — for embedding on surfaces that already have a bg.
const markSvg = (px) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${px}" height="${px}" role="img" aria-label="Brain Memory">` +
  `<defs>${CORE_GRADIENT}</defs>${NEURON}</svg>\n`;

// ---- write SVGs ----
const writes = {
  "website/public/icon.svg": tileSvg(1024),
  "website/public/favicon.svg": tileSvg(32),
  "website/public/icon-mark.svg": markSvg(1024),
  "assets/icon.svg": tileSvg(1024),
};
for (const [rel, content] of Object.entries(writes)) {
  fs.writeFileSync(path.join(ROOT, rel), content);
  console.log("svg  ✓", rel);
}
// Cloud panel (app.brainmemory.work) — keep its mark in sync.
const cloudWrites = {
  "web/public/favicon.svg": tileSvg(32),
  "web/public/brain-icon.svg": tileSvg(256),
};
for (const [rel, content] of Object.entries(cloudWrites)) {
  const dest = path.join(CLOUD, rel);
  if (fs.existsSync(path.dirname(dest))) {
    fs.writeFileSync(dest, content);
    console.log("svg  ✓ brain-cloud/" + rel);
  }
}

// ---- rasterize PNGs from the 1024 master ----
const master = path.join(ROOT, "website/public/icon.svg");
const png = (abs, px) => {
  execFileSync("rsvg-convert", ["-w", String(px), "-h", String(px), master, "-o", abs]);
  console.log("png  ✓", path.relative(path.resolve(ROOT, ".."), abs), px + "px");
};
png(path.join(ROOT, "website/public/icon.png"), 1024);
png(path.join(ROOT, "website/public/favicon-32.png"), 32);
png(path.join(ROOT, "website/public/favicon-16.png"), 16);
fs.copyFileSync(path.join(ROOT, "website/public/icon.png"), path.join(ROOT, "assets/icon.png"));
console.log("png  ✓ assets/icon.png (copied)");
// Cloud favicons
if (fs.existsSync(path.join(CLOUD, "web/public"))) {
  png(path.join(CLOUD, "web/public/favicon-32.png"), 32);
  png(path.join(CLOUD, "web/public/favicon-16.png"), 16);
}

console.log("\ndone.");
