"use client";

import { useEffect, useRef } from "react";

/**
 * Hero connectome — a 3D point cloud of memory nodes that decays on an
 * Ebbinghaus curve and re-brightens when recall events fire and spread
 * activation across synapses. Mouse-reactive, ambient, scroll-driven.
 * Ported from the design handoff (assets/js/brain-field.js).
 */
export default function BrainField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let ACCENT = { r: 232, g: 163, b: 61 };
    let LIGHT = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function hexToRgb(h: string) {
      h = (h || "").trim();
      let m = h.match(/^#?([0-9a-f]{6})$/i);
      if (m) { const n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
      m = h.match(/^#?([0-9a-f]{3})$/i);
      if (m) { const s = m[1]; return { r: parseInt(s[0] + s[0], 16), g: parseInt(s[1] + s[1], 16), b: parseInt(s[2] + s[2], 16) }; }
      return null;
    }
    function shade(c: { r: number; g: number; b: number }, f: number) {
      const t = f < 0 ? 0 : 255, k = Math.min(1, Math.abs(f));
      return { r: c.r + (t - c.r) * k, g: c.g + (t - c.g) * k, b: c.b + (t - c.b) * k };
    }
    function readTheme() {
      const root = document.documentElement;
      const a = hexToRgb(getComputedStyle(root).getPropertyValue("--accent"));
      if (a) ACCENT = a;
      LIGHT = root.getAttribute("data-theme") === "light";
      buildGlow();
    }

    const CFG = {
      nodes: 165, neighbours: 4, baseSpin: 0.0016,
      decay: 0.986, floor: 0.06, recallEvery: [34, 70],
      pulseSpeed: 0.022, spreadEnergy: 0.85, spreadFalloff: 0.62, spreadMin: 0.16,
    };

    let W = 0, H = 0, DPR = 1;
    let cx = 0, cy = 0, R = 320;
    type Node = { x: number; y: number; z: number; bx: number; by: number; bz: number; s: number; base: number; twk: number; edges: number[]; sx: number; sy: number; depth: number; rad: number; persp: number };
    let nodes: Node[] = [], edges: { a: number; b: number }[] = [];
    let pulses: { from: number; to: number; t: number; energy: number }[] = [];
    let rotY = 0.6; const rotX = -0.16;
    const mouse = { x: -9999, y: -9999, active: false, lx: 0, ly: 0 };
    let scrollP = 0, recallTimer = 24, frame = 0;
    let recallCount = 0, recallRate = 0, recallWindow: number[] = [];
    let glowSprite: HTMLCanvasElement | null = null;
    let raf = 0;

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.4;
    const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    function dist3(a: Node, b: Node) { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }

    function buildGlow() {
      const s = 64;
      const g = document.createElement("canvas");
      g.width = g.height = s;
      const gc = g.getContext("2d")!;
      const grad = gc.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, `rgba(${ACCENT.r},${ACCENT.g},${ACCENT.b},1)`);
      grad.addColorStop(0.18, `rgba(${ACCENT.r},${ACCENT.g},${ACCENT.b},0.55)`);
      grad.addColorStop(0.5, `rgba(${ACCENT.r},${ACCENT.g},${ACCENT.b},0.12)`);
      grad.addColorStop(1, `rgba(${ACCENT.r},${ACCENT.g},${ACCENT.b},0)`);
      gc.fillStyle = grad;
      gc.fillRect(0, 0, s, s);
      glowSprite = g;
    }

    function buildCloud() {
      nodes = [];
      for (let i = 0; i < CFG.nodes; i++) {
        let x = gauss() * 1.02;
        const y = gauss() * 0.74;
        const z = gauss() * 0.92;
        x += x > 0 ? 0.12 : -0.12;
        nodes.push({ x, y, z, bx: x, by: y, bz: z, s: rand(0.08, 0.4), base: rand(0.1, 0.32), twk: rand(0, Math.PI * 2), edges: [], sx: 0, sy: 0, depth: 0, rad: 0, persp: 1 });
      }
      edges = [];
      const seen = new Set<string>();
      for (let i = 0; i < nodes.length; i++) {
        const ds: [number, number][] = [];
        for (let j = 0; j < nodes.length; j++) if (j !== i) ds.push([dist3(nodes[i], nodes[j]), j]);
        ds.sort((a, b) => a[0] - b[0]);
        for (let k = 0; k < CFG.neighbours; k++) {
          const j = ds[k][1];
          const key = i < j ? i + "_" + j : j + "_" + i;
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push({ a: i, b: j });
        }
      }
      nodes.forEach((n) => (n.edges = []));
      edges.forEach((e, idx) => { nodes[e.a].edges.push(idx); nodes[e.b].edges.push(idx); });
    }

    function project(n: Node, consolidate: number, zoom: number) {
      const k = lerp(1, 0.66, consolidate);
      let x = n.x * k; const y = n.y * k, z = n.z * k;
      const wob = Math.sin(frame * 0.012 + n.twk) * 0.015;
      x += wob;
      const yy = y + wob * 0.6;
      const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
      const x1 = x * cosY - z * sinY;
      const z1 = x * sinY + z * cosY;
      const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
      const y1 = yy * cosX - z1 * sinX;
      const z2 = yy * sinX + z1 * cosX;
      const fov = 3.0;
      const persp = (fov / (fov - z2 * 0.9)) * zoom;
      n.sx = cx + x1 * R * persp;
      n.sy = cy + y1 * R * persp;
      n.depth = z2;
      n.persp = persp;
    }

    function fireNode(idx: number, energy: number) {
      const n = nodes[idx];
      n.s = 1;
      recallCount++;
      recallWindow.push(frame);
      for (const ei of n.edges) {
        const e = edges[ei];
        const to = e.a === idx ? e.b : e.a;
        pulses.push({ from: idx, to, t: 0, energy });
      }
    }
    function spontaneousRecall() {
      let idx = (Math.random() * nodes.length) | 0;
      for (let tries = 0; tries < 6; tries++) {
        const c = (Math.random() * nodes.length) | 0;
        if (nodes[c].s < nodes[idx].s) idx = c;
      }
      fireNode(idx, CFG.spreadEnergy);
    }

    function step() {
      frame++;
      rotY += CFG.baseSpin * lerp(1, 0.25, scrollP);
      const consolidate = scrollP;
      const zoom = lerp(1, 1.12, scrollP);
      for (const n of nodes) n.s = Math.max(CFG.floor, n.s * CFG.decay);
      if (!reduced) {
        recallTimer--;
        if (recallTimer <= 0) { spontaneousRecall(); recallTimer = rand(CFG.recallEvery[0], CFG.recallEvery[1]) | 0; }
      }
      for (const n of nodes) project(n, consolidate, zoom);
      if (mouse.active) {
        let near = -1, nd = 1e9;
        for (let i = 0; i < nodes.length; i++) {
          const dx = nodes[i].sx - mouse.x, dy = nodes[i].sy - mouse.y;
          const d = dx * dx + dy * dy;
          if (d < nd) { nd = d; near = i; }
          if (d < 13000) nodes[i].s = Math.min(1, nodes[i].s + 0.04 * (1 - d / 13000));
        }
        const speed = Math.hypot(mouse.x - mouse.lx, mouse.y - mouse.ly);
        if (near >= 0 && nd < 9000 && speed > 4 && frame % 5 === 0) fireNode(near, CFG.spreadEnergy * 0.9);
        mouse.lx = mouse.x; mouse.ly = mouse.y;
      }
      const next: typeof pulses = [];
      for (const p of pulses) {
        p.t += CFG.pulseSpeed;
        if (p.t >= 1) {
          const to = nodes[p.to];
          to.s = Math.min(1, to.s + p.energy * 0.7);
          const e2 = p.energy * CFG.spreadFalloff;
          if (e2 > CFG.spreadMin) {
            for (const ei of to.edges) {
              const e = edges[ei];
              const nxt = e.a === p.to ? e.b : e.a;
              if (nxt === p.from) continue;
              if (Math.random() < 0.7) next.push({ from: p.to, to: nxt, t: 0, energy: e2 });
            }
          }
        } else next.push(p);
      }
      pulses = next.length > 240 ? next.slice(next.length - 240) : next;
      recallWindow = recallWindow.filter((f) => frame - f < 60);
      recallRate = recallWindow.length;
    }

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1;
      for (const e of edges) {
        const a = nodes[e.a], b = nodes[e.b];
        const str = (a.s + b.s) * 0.5;
        const depth = (a.depth + b.depth) * 0.5;
        let da = clamp(0.05 + str * 0.5, 0, 0.62) * (0.45 + (depth + 1) * 0.27);
        if (da < 0.02) continue;
        let ec = ACCENT;
        if (LIGHT) { ec = shade(ACCENT, -0.45); da = clamp(da * 1.55, 0, 0.8); }
        ctx.strokeStyle = `rgba(${ec.r | 0},${ec.g | 0},${ec.b | 0},${da})`;
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      }
      const order = nodes.map((_n, i) => i).sort((i, j) => nodes[i].depth - nodes[j].depth);
      ctx.globalCompositeOperation = LIGHT ? "source-over" : "lighter";
      for (const i of order) {
        const n = nodes[i];
        const dz = (n.depth + 1) * 0.5;
        const size = (1.1 + n.s * 3.2) * n.persp * (0.6 + dz * 0.5);
        if (n.s > 0.12 && glowSprite) {
          const gs = size * (5 + n.s * 9);
          ctx.globalAlpha = clamp(n.s * (LIGHT ? 0.3 : 0.6), 0, 0.7) * (0.4 + dz * 0.6);
          ctx.drawImage(glowSprite, n.sx - gs / 2, n.sy - gs / 2, gs, gs);
        }
        ctx.globalAlpha = clamp(0.34 + n.s * 0.66, 0, 1) * (0.45 + dz * 0.55);
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, Math.max(0.6, size), 0, Math.PI * 2);
        if (LIGHT) {
          const d = shade(ACCENT, -0.12 - n.s * 0.42);
          ctx.fillStyle = `rgb(${d.r | 0},${d.g | 0},${d.b | 0})`;
        } else {
          const cc = lerp(190, 255, n.s);
          ctx.fillStyle = `rgb(${lerp(ACCENT.r, 235, n.s * n.s) | 0},${cc | 0},${lerp(ACCENT.b + 30, 220, n.s * 0.5) | 0})`;
        }
        ctx.fill();
      }
      for (const p of pulses) {
        const a = nodes[p.from], b = nodes[p.to];
        const x = lerp(a.sx, b.sx, p.t), y = lerp(a.sy, b.sy, p.t);
        const sz = 2.4 * p.energy + 1.4;
        if (glowSprite) {
          const gs = sz * 8;
          ctx.globalAlpha = clamp(p.energy, 0, 1) * (LIGHT ? 0.5 : 0.9);
          ctx.drawImage(glowSprite, x - gs / 2, y - gs / 2, gs, gs);
        }
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(x, y, sz, 0, Math.PI * 2);
        if (LIGHT) { const d = shade(ACCENT, -0.4); ctx.fillStyle = `rgb(${d.r | 0},${d.g | 0},${d.b | 0})`; }
        else ctx.fillStyle = "rgb(255,236,206)";
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }

    const hud: Record<string, HTMLElement> = {};
    function bindHud() {
      document.querySelectorAll<HTMLElement>("[data-hud]").forEach((el) => (hud[el.dataset.hud!] = el));
    }
    function paintHud() {
      if (frame % 6) return;
      let total = 0, active = 0;
      for (const n of nodes) { total += n.s; if (n.s > 0.4) active++; }
      if (hud.nodes) hud.nodes.textContent = String(CFG.nodes);
      if (hud.synapses) hud.synapses.textContent = String(edges.length);
      if (hud.active) hud.active.textContent = String(active);
      if (hud.strength) hud.strength.textContent = (total / CFG.nodes).toFixed(2);
      if (hud.recall) hud.recall.textContent = recallRate + "/s";
    }

    function loop() { step(); draw(); paintHud(); raf = requestAnimationFrame(loop); }

    function resize() {
      if (!canvas) return;
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = W * DPR; canvas.height = H * DPR;
      ctx!.setTransform(DPR, 0, 0, DPR, 0, 0);
      cx = W > 880 ? W * 0.66 : W * 0.5;
      cy = H * 0.5;
      R = Math.min(W, H) * (W > 880 ? 0.4 : 0.34);
    }

    function onMove(e: MouseEvent) {
      const r = canvas!.getBoundingClientRect();
      mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; mouse.active = true;
    }
    function onLeave() { mouse.active = false; mouse.x = mouse.y = -9999; }
    function onScroll() {
      const hero = canvas!.closest(".hero") || canvas!.parentElement!;
      const h = (hero as HTMLElement).offsetHeight || window.innerHeight;
      scrollP = clamp(window.scrollY / (h * 0.9), 0, 1);
      canvas!.style.opacity = String(lerp(1, 0.0, clamp((scrollP - 0.55) / 0.45, 0, 1)));
    }

    readTheme();
    buildCloud();
    bindHud();
    resize();
    onScroll();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseleave", onLeave);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("brainthemechange", readTheme);
    const opening: number[] = [];
    for (let i = 0; i < 6; i++) opening.push(window.setTimeout(spontaneousRecall, i * 130));
    loop();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("brainthemechange", readTheme);
      opening.forEach(clearTimeout);
    };
  }, []);

  return <canvas id="brain-canvas" ref={canvasRef} aria-hidden="true" />;
}
