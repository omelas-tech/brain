"use client";

import { useId } from "react";

/**
 * Brain Memory glyph — a firing memory node: white-hot center, amber glow halo,
 * and graded synapses/nodes (bright "activated" → dim outer) in the connectome's
 * amber palette. Self-colored (no currentColor); set size via className/style.
 * Ported from the design handoff (#bm-glyph "activation" symbol).
 */
export default function Glyph({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  const gid = useId();
  return (
    <svg className={className} style={style} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <radialGradient id={gid} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFD27A" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#E8A33D" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="12" fill={`url(#${gid})`} opacity="0.7" />
      <g stroke="#E8A33D" strokeWidth="1.25" strokeLinecap="round">
        <line x1="16" y1="16" x2="8" y2="8" strokeOpacity="0.4" />
        <line x1="16" y1="16" x2="25" y2="8" strokeOpacity="0.82" />
        <line x1="16" y1="16" x2="27" y2="17" strokeOpacity="0.5" />
        <line x1="16" y1="16" x2="24" y2="25" strokeOpacity="0.75" />
        <line x1="16" y1="16" x2="8" y2="23" strokeOpacity="0.4" />
        <line x1="16" y1="16" x2="6" y2="16" strokeOpacity="0.35" />
      </g>
      <circle cx="8" cy="8" r="1.6" fill="#9A6E28" />
      <circle cx="27" cy="17" r="1.4" fill="#DCA044" />
      <circle cx="24" cy="25" r="1.9" fill="#F0B24A" />
      <circle cx="8" cy="23" r="1.6" fill="#A9762E" />
      <circle cx="6" cy="16" r="1.3" fill="#8A6022" />
      <circle cx="25" cy="8" r="2.4" fill="#FFDD8C" />
      <circle cx="21" cy="11.5" r="1.3" fill="#FFF0CC" />
      <circle cx="16" cy="16" r="3.7" fill="#FFF2D2" />
      <circle cx="16" cy="16" r="1.9" fill="#FFFFFF" />
    </svg>
  );
}
