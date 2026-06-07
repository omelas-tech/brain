"use client";

import { useId } from "react";

/**
 * Brain Memory glyph — the "Neon glow" mark: an abstract memory network of
 * bright cores + colored halos (multicolor palette) on transparent, so it reads
 * on the site's dark surfaces. Generated from the approved icon design
 * (Brain Icon Explorations.html, style "glow", palette "multi", locked seed) —
 * see website/scripts/gen-icon.mjs, which produces the matching favicon/app icon.
 *
 * Self-colored; set size via className/style. Gradient/filter ids are namespaced
 * per instance so multiple glyphs on one page don't collide.
 */
const DEFS = `<filter id="__ID__-lg" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6"/></filter><radialGradient id="__ID__-g0"><stop offset="0%" stop-color="#adb5c2" stop-opacity="1.00"/><stop offset="100%" stop-color="#5A6B84" stop-opacity="0"/></radialGradient><radialGradient id="__ID__-g1"><stop offset="0%" stop-color="#b7d4eb" stop-opacity="0.66"/><stop offset="100%" stop-color="#6FA8D6" stop-opacity="0"/></radialGradient><radialGradient id="__ID__-g2"><stop offset="0%" stop-color="#f8d09f" stop-opacity="0.67"/><stop offset="100%" stop-color="#F0A03E" stop-opacity="0"/></radialGradient><radialGradient id="__ID__-g3"><stop offset="0%" stop-color="#9fc7c7" stop-opacity="0.80"/><stop offset="100%" stop-color="#3F8E8E" stop-opacity="0"/></radialGradient><radialGradient id="__ID__-g4"><stop offset="0%" stop-color="#fae1a5" stop-opacity="0.70"/><stop offset="100%" stop-color="#F5C24B" stop-opacity="0"/></radialGradient>`;
const BODY = `<g filter="url(#__ID__-lg)" opacity="0.9"><line x1="128" y1="128" x2="138.9" y2="230.8" stroke="#658aad" stroke-width="3.71" stroke-opacity="0.40" stroke-linecap="round"/><line x1="128" y1="128" x2="231.4" y2="127.5" stroke="#a89768" stroke-width="3.84" stroke-opacity="0.42" stroke-linecap="round"/><line x1="128" y1="128" x2="24.8" y2="134.6" stroke="#a58661" stroke-width="3.73" stroke-opacity="0.41" stroke-linecap="round"/><line x1="138.9" y1="230.8" x2="231.4" y2="127.5" stroke="#b2b591" stroke-width="2.75" stroke-opacity="0.30" stroke-linecap="round"/><line x1="138.9" y1="230.8" x2="24.8" y2="134.6" stroke="#b0a48a" stroke-width="2.64" stroke-opacity="0.29" stroke-linecap="round"/><line x1="24.8" y1="134.6" x2="122.7" y2="24.7" stroke="#989766" stroke-width="3.10" stroke-opacity="0.34" stroke-linecap="round"/><line x1="128" y1="128" x2="122.7" y2="24.7" stroke="#4d7d89" stroke-width="4.18" stroke-opacity="0.45" stroke-linecap="round"/><line x1="122.7" y1="24.7" x2="231.4" y2="127.5" stroke="#9aa86d" stroke-width="3.22" stroke-opacity="0.35" stroke-linecap="round"/></g><circle cx="128" cy="128" r="62.40" fill="url(#__ID__-g0)"/><circle cx="128" cy="128" r="18.72" fill="#dbdee4" fill-opacity="1.00"/><circle cx="138.9" cy="230.8" r="34.66" fill="url(#__ID__-g1)"/><circle cx="138.9" cy="230.8" r="10.40" fill="#dfecf6" fill-opacity="0.80"/><circle cx="24.8" cy="134.6" r="35.06" fill="url(#__ID__-g2)"/><circle cx="24.8" cy="134.6" r="10.52" fill="#fcead5" fill-opacity="0.80"/><circle cx="122.7" cy="24.7" r="46.49" fill="url(#__ID__-g3)"/><circle cx="122.7" cy="24.7" r="13.95" fill="#d5e6e6" fill-opacity="0.88"/><circle cx="231.4" cy="127.5" r="37.92" fill="url(#__ID__-g4)"/><circle cx="231.4" cy="127.5" r="11.38" fill="#fdf2d7" fill-opacity="0.82"/>`;

export default function Glyph({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  const raw = useId().replace(/:/g, ""); // safe for SVG/url() id references
  const html = (DEFS + BODY).replaceAll("__ID__", raw);
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 256 256"
      role="img"
      aria-label="Brain Memory"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
