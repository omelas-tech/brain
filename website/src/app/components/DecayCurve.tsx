"use client";

import { useEffect, useRef } from "react";

/**
 * Animated Ebbinghaus forgetting curve. Strength decays exponentially;
 * at recall events it jumps back up and each successive recall decays
 * slower (the spacing effect). Ported from assets/js/decay-curve.js.
 */
export default function DecayCurve() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let W = 0, H = 0, DPR = 1, t = 0, raf = 0;
    let A = { r: 232, g: 163, b: 61 };
    let LIGHT = false, GRID = "", FG3 = "", HEAD = "";

    function hexToRgb(h: string) {
      h = (h || "").trim();
      let m = h.match(/^#?([0-9a-f]{6})$/i);
      if (m) { const n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
      m = h.match(/^#?([0-9a-f]{3})$/i);
      if (m) { const s = m[1]; return { r: parseInt(s[0] + s[0], 16), g: parseInt(s[1] + s[1], 16), b: parseInt(s[2] + s[2], 16) }; }
      return null;
    }
    const rgba = (a: number) => `rgba(${A.r},${A.g},${A.b},${a})`;
    function readTheme() {
      const root = document.documentElement;
      const a = hexToRgb(getComputedStyle(root).getPropertyValue("--accent"));
      if (a) A = a;
      LIGHT = root.getAttribute("data-theme") === "light";
      GRID = LIGHT ? "rgba(22,20,14,0.08)" : "rgba(231,245,240,0.06)";
      FG3 = LIGHT ? "rgba(90,85,74,0.85)" : "rgba(151,160,156,0.7)";
      HEAD = LIGHT ? `rgb(${(A.r * 0.55) | 0},${(A.g * 0.55) | 0},${(A.b * 0.55) | 0})` : "#FFE9C9";
    }

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas!.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas!.width = W * DPR; canvas!.height = H * DPR;
      ctx!.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    const PAD = { l: 30, r: 14, t: 18, b: 26 };
    const recalls = [0.0, 0.22, 0.46, 0.74];
    const rates = [4.6, 3.2, 2.0, 1.1];
    function strength(x: number) {
      let seg = 0;
      for (let i = 0; i < recalls.length; i++) if (x >= recalls[i]) seg = i;
      return Math.exp(-rates[seg] * (x - recalls[seg]));
    }
    const px = (x: number) => PAD.l + x * (W - PAD.l - PAD.r);
    const py = (s: number) => PAD.t + (1 - s) * (H - PAD.t - PAD.b);

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillStyle = FG3;
      for (let i = 0; i <= 4; i++) {
        const y = PAD.t + (i / 4) * (H - PAD.t - PAD.b);
        ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
        ctx.textAlign = "right"; ctx.textBaseline = "middle";
        ctx.fillText(100 - i * 25 + "", PAD.l - 6, y);
      }
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText("strength %", PAD.l - 24, 2);
      ctx.textAlign = "right";
      ctx.fillText("time →", W - PAD.r, H - 12);

      const head = reduced ? 1 : t % 1;

      ctx.strokeStyle = rgba(0.16); ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i <= 240; i++) { const x = i / 240, X = px(x), Y = py(strength(x)); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
      ctx.stroke();

      const grad = ctx.createLinearGradient(0, PAD.t, 0, H - PAD.b);
      grad.addColorStop(0, rgba(LIGHT ? 0.22 : 0.28));
      grad.addColorStop(1, rgba(0));
      ctx.beginPath();
      ctx.moveTo(px(0), py(0));
      for (let i = 0; i <= 240; i++) ctx.lineTo(px((i / 240) * head), py(strength((i / 240) * head)));
      ctx.lineTo(px(head), py(0));
      ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();

      ctx.strokeStyle = `rgb(${A.r},${A.g},${A.b})`; ctx.lineWidth = 2.4; ctx.lineJoin = "round";
      ctx.beginPath();
      for (let i = 0; i <= 240; i++) { const x = (i / 240) * head, X = px(x), Y = py(strength(x)); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
      ctx.stroke();

      recalls.forEach((rx, i) => {
        if (rx > head + 0.001 && i > 0) return;
        const X = px(rx);
        ctx.strokeStyle = rgba(0.25); ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(X, py(1)); ctx.lineTo(X, H - PAD.b); ctx.stroke();
        ctx.setLineDash([]);
        if (i > 0) {
          ctx.fillStyle = `rgb(${A.r},${A.g},${A.b})`;
          ctx.beginPath(); ctx.arc(X, py(1), 3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = FG3; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
          ctx.fillText("recall", X, py(1) - 6);
        }
      });

      const hx = px(head), hy = py(strength(head));
      ctx.fillStyle = HEAD;
      ctx.beginPath(); ctx.arc(hx, hy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgba(0.5); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(hx, hy, 8, 0, Math.PI * 2); ctx.stroke();

      if (!reduced) t += 0.0022;
      raf = requestAnimationFrame(draw);
    }

    readTheme();
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("brainthemechange", readTheme);
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("brainthemechange", readTheme);
    };
  }, []);

  return <canvas id="decay-canvas" ref={canvasRef} aria-label="Animated Ebbinghaus forgetting curve with spaced reinforcement" />;
}
