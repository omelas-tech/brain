// Generates the wide Brain Memory LinkedIn covers (dark + light): the brand
// firing-neuron app tile centered on a flat canvas, no text — matching the
// Omelas card_brain presentation. Output: website/public/linkedin_cover{,_light}.png
// at 6336×1584 (4× the 1584×396 LinkedIn banner).
//
// Run: node website/scripts/gen-linkedin-cover.mjs
// Deps: rsvg-convert (brew install librsvg). Pure file I/O — no fonts, no network.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");

// ---- canonical firing-neuron mark (0..32 space) ----
const CORE_GRAD = `<radialGradient id="core" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#8FDDFF" stop-opacity="0.95"/><stop offset="100%" stop-color="#46C6FF" stop-opacity="0"/></radialGradient>`;
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

const W = 6336, H = 1584, cx = W / 2, cy = H / 2;
const TILE = "#07090A";        // brand near-black "deep-lab" tile
const TILE_SIZE = 1080;        // ~68% of banner height — prominent, centered

function coverSvg({ bg, shadow, shadowOpacity }) {
  const s = TILE_SIZE / 32, x = cx - TILE_SIZE / 2, y = cy - TILE_SIZE / 2, r = 7 * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${CORE_GRAD}
    <filter id="sh" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="26" stdDeviation="40" flood-color="${shadow}" flood-opacity="${shadowOpacity}"/></filter></defs>
  <rect width="${W}" height="${H}" fill="${bg}"/>
  <g filter="url(#sh)"><rect x="${x}" y="${y}" width="${TILE_SIZE}" height="${TILE_SIZE}" rx="${r}" ry="${r}" fill="${TILE}"/></g>
  <g transform="translate(${x} ${y}) scale(${s})">${NEURON}</g>
</svg>\n`;
}

const variants = [
  ["linkedin_cover.png", { bg: "#252525", shadow: "#000000", shadowOpacity: 0.55 }],
  ["linkedin_cover_light.png", { bg: "#F4F2EC", shadow: "#3a4654", shadowOpacity: 0.4 }],
];
for (const [name, opts] of variants) {
  const tmp = path.join(PUBLIC, name.replace(/\.png$/, ".svg"));
  fs.writeFileSync(tmp, coverSvg(opts));
  execFileSync("rsvg-convert", ["-w", String(W), "-h", String(H), tmp, "-o", path.join(PUBLIC, name)]);
  fs.rmSync(tmp);
  console.log("png  ✓ website/public/" + name + "  6336×1584");
}
console.log("\ndone.");
