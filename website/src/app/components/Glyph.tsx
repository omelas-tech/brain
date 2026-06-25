"use client";

import { useId } from "react";

/**
 * Brain Memory glyph — the firing-neuron "activation" mark: a white-hot core
 * fading through a cyan glow halo to graded synapses and nodes (bright
 * "activated" → dim outer), in the brand cyan (#46C6FF). Transparent, so it
 * reads on both the light paper surfaces and the deep-lab dark tile.
 *
 * Self-colored (the cyan shades are baked into the fills); set size via
 * className/style. The core-glow gradient id is namespaced per instance so
 * multiple glyphs on one page don't collide.
 */
export default function Glyph({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Brain Memory"
    >
      <defs>
        <radialGradient id={`${id}-core`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#8FDDFF" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#46C6FF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="12" fill={`url(#${id}-core)`} opacity="0.7" />
      <g stroke="#2E9FD6" strokeWidth="1.25" strokeLinecap="round">
        <line x1="16" y1="16" x2="8" y2="8" strokeOpacity="0.4" />
        <line x1="16" y1="16" x2="25" y2="8" strokeOpacity="0.82" />
        <line x1="16" y1="16" x2="27" y2="17" strokeOpacity="0.5" />
        <line x1="16" y1="16" x2="24" y2="25" strokeOpacity="0.75" />
        <line x1="16" y1="16" x2="8" y2="23" strokeOpacity="0.4" />
        <line x1="16" y1="16" x2="6" y2="16" strokeOpacity="0.35" />
      </g>
      <circle cx="8" cy="8" r="1.6" fill="#1C7FB0" />
      <circle cx="27" cy="17" r="1.4" fill="#4FB8E6" />
      <circle cx="24" cy="25" r="1.9" fill="#2E9FD6" />
      <circle cx="8" cy="23" r="1.6" fill="#2389BE" />
      <circle cx="6" cy="16" r="1.3" fill="#1B6E97" />
      <circle cx="25" cy="8" r="2.4" fill="#6FD3FF" />
      <circle cx="21" cy="11.5" r="1.3" fill="#CFEEFF" />
      <circle cx="16" cy="16" r="3.7" fill="#DFF4FF" />
      <circle cx="16" cy="16" r="1.9" fill="#FFFFFF" />
    </svg>
  );
}
