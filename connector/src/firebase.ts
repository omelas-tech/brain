// Firebase identity for the connector.
//
// Login is client-side (the browser signs in with Google via the Firebase web
// SDK and gets an ID token); the connector verifies that token SERVER-SIDE here.
// Verification is secret-free — we validate the JWT against Google's public
// certs, so the connector needs only the (public) project config, no service
// account key. This is the same Firebase project brain-cloud already uses.

import crypto from "node:crypto";

const CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
}

/** Read the (public) Firebase web config from env. Null if not configured. */
export function firebaseConfig(): FirebaseWebConfig | null {
  const { FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID } = process.env;
  if (!FIREBASE_API_KEY || !FIREBASE_AUTH_DOMAIN || !FIREBASE_PROJECT_ID) return null;
  return {
    apiKey: FIREBASE_API_KEY,
    authDomain: FIREBASE_AUTH_DOMAIN,
    projectId: FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
  };
}

export const isFirebaseConfigured = () => firebaseConfig() !== null;

let certCache: { certs: Record<string, string>; exp: number } | null = null;

async function googleCerts(): Promise<Record<string, string>> {
  if (certCache && certCache.exp > Date.now()) return certCache.certs;
  const res = await fetch(CERTS_URL);
  const certs = (await res.json()) as Record<string, string>;
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  certCache = { certs, exp: Date.now() + maxAge * 1000 };
  return certs;
}

export interface FirebaseIdentity {
  uid: string;
  email?: string;
  name?: string;
}

/** Verify a Firebase ID token (RS256, against Google's certs) and return the identity. */
export async function verifyFirebaseIdToken(idToken: string): Promise<FirebaseIdentity> {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID not set");

  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [h, p, s] = parts;
  const header = JSON.parse(Buffer.from(h, "base64url").toString());
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());

  const certPem = (await googleCerts())[header.kid];
  if (!certPem) throw new Error("unknown signing key");
  const pubKey = new crypto.X509Certificate(certPem).publicKey;
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), pubKey, Buffer.from(s, "base64url"));
  if (!ok) throw new Error("invalid signature");

  if (claims.aud !== projectId) throw new Error("audience mismatch");
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("issuer mismatch");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) throw new Error("token expired");
  if (!claims.sub) throw new Error("no subject");

  return { uid: claims.sub, email: claims.email, name: claims.name };
}

/**
 * The connector's OAuth consent / sign-in screen.
 *
 * Visuals are ported from the approved `Brain Connect.html` design (dark + amber
 * "deep-lab" brand): the firing-node brain glyph (no emoji), a Claude Code → your
 * brain connection visual, the requested scopes, an ambient connectome backdrop,
 * and a Google button. Behaviour is unchanged from the old minimal page: Google
 * login via the Firebase web SDK, then POST the resulting ID token (as JSON) to
 * `action`. On a JSON `{redirect}` response it navigates there (the OAuth flow);
 * otherwise it shows the JSON (the /dev/whoami demo page).
 *
 * `clientName`, `scope`, and `origin` tailor the consent copy to the actual
 * request (the OAuth client, what it asked for, and the host shown in the trust
 * footer); all are optional so the demo page renders with sensible defaults.
 */
export function loginPageHtml(opts: {
  action: string;
  loginId?: string;
  title: string;
  clientName?: string;
  scope?: string;
  origin?: string;
}): string {
  const cfg = firebaseConfig();
  const clientLabel = opts.clientName || "An MCP client";
  const scopes = (opts.scope || "brain.read brain.write").split(/\s+/).filter(Boolean);
  const canWrite = scopes.includes("brain.write");
  const verb = canWrite ? "read and write" : "read";
  const origin = opts.origin || "mcp.brainmemory.ai";

  // The amber firing-node glyph, standalone, for the favicon (no served assets).
  const faviconSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="7" fill="#07090A"/>` +
    `<g stroke="#E8A33D" stroke-width="1.25" stroke-linecap="round">` +
    `<line x1="16" y1="16" x2="25" y2="8" stroke-opacity=".82"/>` +
    `<line x1="16" y1="16" x2="24" y2="25" stroke-opacity=".75"/>` +
    `<line x1="16" y1="16" x2="6" y2="16" stroke-opacity=".35"/></g>` +
    `<circle cx="25" cy="8" r="2.4" fill="#FFDD8C"/>` +
    `<circle cx="24" cy="25" r="1.9" fill="#F0B24A"/>` +
    `<circle cx="16" cy="16" r="3.7" fill="#FFF2D2"/>` +
    `<circle cx="16" cy="16" r="1.9" fill="#FFFFFF"/></svg>`;
  const favicon = `data:image/svg+xml,${encodeURIComponent(faviconSvg)}`;

  // Requested scopes — only show "Write & reinforce" when brain.write was asked for.
  const scopeRows =
    `<div class="scope">
      <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.6"/></svg>
      <div class="tx"><strong>Recall memories</strong><span>Run deterministic recall and read stored memories</span></div>
    </div>` +
    (canWrite ? `<div class="scope">
      <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
      <div class="tx"><strong>Write &amp; reinforce</strong><span>Create memories and strengthen them on recall</span></div>
    </div>` : "") +
    `<div class="scope">
      <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.7-3M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3M3 4v5h5M21 20v-5h-5"/></svg>
      <div class="tx"><strong>Sync across agents</strong><span>Keep one brain consistent across your CLI tools</span></div>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${opts.title}</title>
<link rel="icon" type="image/svg+xml" href="${favicon}" />
<style>
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --bg:        #07090A;
  --surface:   #0F1417;
  --surface-2: #151B1F;
  --surface-3: #1B2329;
  --border:        rgba(231, 245, 240, 0.09);
  --border-strong: rgba(231, 245, 240, 0.15);
  --fg:   #E9EFEC;
  --fg-2: #97A09C;
  --fg-3: #5A625F;
  --fg-4: #3C423F;
  --accent:        #E8A33D;
  --accent-bright: #FFCE7A;
  --accent-soft:   color-mix(in srgb, var(--accent) 12%, transparent);
  --accent-line:   color-mix(in srgb, var(--accent) 42%, transparent);
  --accent-glow:   color-mix(in srgb, var(--accent) 40%, transparent);
  --border-accent: rgba(232, 163, 61, 0.30);
  --sans: 'Space Grotesk', system-ui, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, monospace;
  --ease: cubic-bezier(0.22, 0.61, 0.36, 1);
}

* , *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font-family: var(--sans); font-size: 15px; line-height: 1.55;
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  display: flex; align-items: center; justify-content: center;
  min-height: 100%; padding: 28px 20px; overflow-x: hidden; overflow-y: auto;
}
svg { display: block; }
::selection { background: rgba(232,163,61,0.26); color: #FFF3E0; }

#field { position: fixed; inset: 0; z-index: 0; }
.vignette {
  position: fixed; inset: 0; z-index: 1; pointer-events: none;
  background: radial-gradient(78% 70% at 50% 46%, transparent 0%, rgba(7,9,10,0.62) 58%, var(--bg) 100%);
}

.card {
  position: relative; z-index: 2; width: min(440px, calc(100vw - 40px));
  margin: auto;
  background: rgba(15, 20, 23, 0.82);
  backdrop-filter: blur(18px) saturate(1.1); -webkit-backdrop-filter: blur(18px) saturate(1.1);
  border: 1px solid var(--border-strong); border-radius: 22px;
  padding: 38px 36px 30px;
  box-shadow: 0 30px 80px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.3);
  animation: rise .7s var(--ease) both;
}
@keyframes rise { from { opacity: 0; transform: translateY(14px) scale(.99); } to { opacity: 1; transform: none; } }

.connect-row { display: flex; align-items: center; justify-content: center; gap: 0; margin-bottom: 30px; }
.node {
  width: 62px; height: 62px; border-radius: 16px; flex: none;
  display: grid; place-items: center; position: relative;
}
.node.client { background: var(--surface-2); border: 1px solid var(--border-strong); }
.node.client svg { width: 28px; height: 28px; color: var(--fg-2); }
.node.brain {
  background: radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--accent) 22%, var(--surface-2)), var(--surface-2));
  border: 1px solid var(--border-accent);
  box-shadow: 0 0 28px -4px var(--accent-glow);
}
.node.brain svg { width: 40px; height: 40px; }
.node .tag {
  position: absolute; top: calc(100% + 9px); left: 50%; transform: translateX(-50%);
  font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.04em; color: var(--fg-3); white-space: nowrap;
}
.wire { width: 70px; height: 28px; position: relative; }
.wire svg { width: 100%; height: 100%; overflow: visible; }
.wire .track { stroke: var(--border-strong); stroke-width: 1.5; fill: none; stroke-dasharray: 3 4; }
.wire .spark { fill: var(--accent-bright); filter: drop-shadow(0 0 5px var(--accent)); }

.lede { text-align: center; }
.lede .eyebrow {
  font-family: var(--mono); font-size: 0.66rem; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--fg-3); margin-bottom: 12px;
}
.lede h1 { margin: 0; font-size: 1.42rem; font-weight: 600; letter-spacing: -0.02em; }
.lede p { margin: 10px auto 0; max-width: 320px; color: var(--fg-2); font-size: 0.94rem; }
.lede p b { color: var(--fg); font-weight: 500; }

.scopes { margin: 28px 0 26px; border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
.scopes .sc-head {
  font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--fg-3); padding: 12px 16px; background: var(--surface-2); border-bottom: 1px solid var(--border);
}
.scope { display: flex; gap: 13px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
.scope:last-child { border-bottom: 0; }
.scope .ic { width: 17px; height: 17px; flex: none; color: var(--accent); margin-top: 1px; }
.scope .tx strong { display: block; font-size: 0.9rem; font-weight: 500; color: var(--fg); }
.scope .tx span { font-size: 0.82rem; color: var(--fg-3); }

.gbtn {
  display: flex; align-items: center; justify-content: center; gap: 12px; width: 100%;
  font-family: var(--sans); font-size: 0.98rem; font-weight: 600; color: #1A1206;
  background: var(--accent); border: 0; border-radius: 12px; padding: 14px 20px;
  cursor: pointer; transition: background .2s, box-shadow .2s, transform .12s;
}
.gbtn:hover { background: var(--accent-bright); box-shadow: 0 0 32px -4px var(--accent-glow); }
.gbtn:active { transform: translateY(1px); }
.gbtn:disabled { opacity: .6; cursor: progress; }
.gbtn .gwrap { width: 20px; height: 20px; background: #fff; border-radius: 4px; display: grid; place-items: center; }
.gbtn .gwrap svg { width: 14px; height: 14px; }

.status { margin-top: 14px; text-align: center; font-family: var(--mono); font-size: 0.74rem; color: var(--fg-2); min-height: 1em; }
.status.err { color: #FF9B8C; }
.out { text-align: left; color: var(--accent-bright); font-family: var(--mono); font-size: 0.72rem; line-height: 1.5; white-space: pre-wrap; word-break: break-all; margin-top: 12px; max-height: 240px; overflow: auto; }
.out:empty { display: none; }

.foot { margin-top: 18px; text-align: center; }
.origin {
  display: inline-flex; align-items: center; gap: 7px; font-family: var(--mono); font-size: 0.72rem; color: var(--fg-3); white-space: nowrap;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; padding: 5px 12px;
}
.origin .lock { width: 11px; height: 11px; color: var(--fg-3); }
.origin b { color: var(--fg-2); font-weight: 500; }
.terms { margin-top: 14px; font-size: 0.76rem; color: var(--fg-4); }
.terms a { color: var(--fg-3); border-bottom: 1px solid var(--border-strong); }
.terms a:hover { color: var(--accent-bright); }

@media (prefers-reduced-motion: reduce) {
  .card { animation: none; }
  .wire .spark { display: none; }
}
</style>
</head>
<body>

<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <radialGradient id="bc-core" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#FFD27A" stop-opacity="0.95"/>
    <stop offset="100%" stop-color="#E8A33D" stop-opacity="0"/>
  </radialGradient>
  <symbol id="bm-glyph" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="12" fill="url(#bc-core)" opacity="0.7"/>
    <g stroke="#E8A33D" stroke-width="1.25" stroke-linecap="round">
      <line x1="16" y1="16" x2="8" y2="8" stroke-opacity="0.4"/>
      <line x1="16" y1="16" x2="25" y2="8" stroke-opacity="0.82"/>
      <line x1="16" y1="16" x2="27" y2="17" stroke-opacity="0.5"/>
      <line x1="16" y1="16" x2="24" y2="25" stroke-opacity="0.75"/>
      <line x1="16" y1="16" x2="8" y2="23" stroke-opacity="0.4"/>
      <line x1="16" y1="16" x2="6" y2="16" stroke-opacity="0.35"/>
    </g>
    <circle cx="8" cy="8" r="1.6" fill="#9A6E28"/>
    <circle cx="27" cy="17" r="1.4" fill="#DCA044"/>
    <circle cx="24" cy="25" r="1.9" fill="#F0B24A"/>
    <circle cx="8" cy="23" r="1.6" fill="#A9762E"/>
    <circle cx="6" cy="16" r="1.3" fill="#8A6022"/>
    <circle cx="25" cy="8" r="2.4" fill="#FFDD8C"/>
    <circle cx="21" cy="11.5" r="1.3" fill="#FFF0CC"/>
    <circle cx="16" cy="16" r="3.7" fill="#FFF2D2"/>
    <circle cx="16" cy="16" r="1.9" fill="#FFFFFF"/>
  </symbol>
</defs></svg>

<canvas id="field" aria-hidden="true"></canvas>
<div class="vignette"></div>

<main class="card" data-screen-label="oauth-connect">
  <div class="connect-row">
    <div class="node client">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 9l3 3-3 3M13 15h4"/></svg>
      <span class="tag">${clientLabel}</span>
    </div>
    <div class="wire">
      <svg viewBox="0 0 70 28" preserveAspectRatio="none">
        <path class="track" d="M2 14 H68"/>
        <circle class="spark" r="2.6"><animateMotion dur="1.8s" repeatCount="indefinite" path="M2 14 H68" keyPoints="0;1" keyTimes="0;1" calcMode="linear"/><animate attributeName="opacity" dur="1.8s" repeatCount="indefinite" values="0;1;1;0" keyTimes="0;0.1;0.85;1"/></circle>
      </svg>
    </div>
    <div class="node brain">
      <svg><use href="#bm-glyph"/></svg>
      <span class="tag">your brain</span>
    </div>
  </div>

  <div class="lede">
    <div class="eyebrow">Authorize connection</div>
    <h1>${opts.title}</h1>
    <p><b>${clientLabel}</b> wants to ${verb} memories in your Brain Memory store.</p>
  </div>

  <div class="scopes">
    <div class="sc-head">This will allow it to</div>
    ${scopeRows}
  </div>

  <button class="gbtn" id="btn">
    <span class="gwrap">
      <svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.6 2.4 30.1 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.1 5.3-4.6 7l7.2 5.6c4.2-3.9 6.6-9.6 6.6-16.4z"/><path fill="#FBBC05" d="M10.5 28.4c-.5-1.4-.8-3-.8-4.4s.3-3 .7-4.4l-7.9-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.6l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.1 0 11.3-2 15-5.5l-7.2-5.6c-2 1.4-4.6 2.2-7.8 2.2-6.3 0-11.6-4.1-13.5-9.7l-7.9 6.2C6.5 42.6 14.6 48 24 48z"/></svg>
    </span>
    Sign in with Google
  </button>

  <p class="status" id="msg"></p>
  <pre class="out" id="out"></pre>

  <div class="foot">
    <span class="origin">
      <svg class="lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
      <b>${origin}</b> · OAuth 2.0
    </span>
    <p class="terms">By connecting you agree to the <a href="#">Terms</a> and <a href="#">Privacy Policy</a>.</p>
  </div>
</main>

<script>
/* ambient connectome — calm, centered, dim. Reads --accent.
   (Ported from Brain Connect.html; color strings use concatenation, not template
   literals, so this whole block embeds cleanly in the server-side template.) */
(function () {
  const canvas = document.getElementById('field');
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const A = { r: 232, g: 163, b: 61 };
  let W, H, DPR, cx, cy, R, nodes = [], edges = [], pulses = [], frame = 0, spin = 0.0011, rotY = 0.5, recallT = 30;
  const rand = (a, b) => a + Math.random() * (b - a);
  const g3 = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.4;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  let glow;
  function buildGlow() {
    const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d'), gr = g.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
    gr.addColorStop(0, 'rgba(' + A.r + ',' + A.g + ',' + A.b + ',1)');
    gr.addColorStop(0.4, 'rgba(' + A.r + ',' + A.g + ',' + A.b + ',0.18)');
    gr.addColorStop(1, 'rgba(' + A.r + ',' + A.g + ',' + A.b + ',0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s); glow = c;
  }
  function build() {
    nodes = [];
    for (let i = 0; i < 120; i++) nodes.push({ x: g3()*1.0, y: g3()*0.78, z: g3()*0.9, s: rand(0.05,0.3), edges: [] });
    edges = []; const seen = new Set();
    for (let i = 0; i < nodes.length; i++) {
      const ds = [];
      for (let j = 0; j < nodes.length; j++) if (j !== i) { const a=nodes[i],b=nodes[j]; ds.push([(a.x-b.x)**2+(a.y-b.y)**2+(a.z-b.z)**2, j]); }
      ds.sort((p,q)=>p[0]-q[0]);
      for (let k = 0; k < 3; k++) { const j = ds[k][1], key = i<j?i+'_'+j:j+'_'+i; if (seen.has(key)) continue; seen.add(key); edges.push({a:i,b:j}); }
    }
    nodes.forEach(n => n.edges = []);
    edges.forEach((e, i) => { nodes[e.a].edges.push(i); nodes[e.b].edges.push(i); });
  }
  function fire(idx, en) { nodes[idx].s = 1; for (const ei of nodes[idx].edges) { const e = edges[ei]; pulses.push({ from: idx, to: e.a===idx?e.b:e.a, t: 0, en }); } }
  function resize() {
    DPR = Math.min(devicePixelRatio||1, 2); W = innerWidth; H = innerHeight;
    canvas.width = W*DPR; canvas.height = H*DPR; ctx.setTransform(DPR,0,0,DPR,0,0);
    cx = W/2; cy = H/2; R = Math.min(W, H) * 0.46;
  }
  function step() {
    frame++; rotY += spin;
    for (const n of nodes) n.s = Math.max(0.05, n.s * 0.987);
    if (!reduced && --recallT <= 0) { let idx = (Math.random()*nodes.length)|0; for (let t=0;t<5;t++){const c=(Math.random()*nodes.length)|0; if(nodes[c].s<nodes[idx].s)idx=c;} fire(idx, 0.8); recallT = rand(38, 80)|0; }
    const cosY=Math.cos(rotY), sinY=Math.sin(rotY), cosX=Math.cos(-0.18), sinX=Math.sin(-0.18);
    for (const n of nodes) {
      let x1 = n.x*cosY - n.z*sinY, z1 = n.x*sinY + n.z*cosY, y1 = n.y*cosX - z1*sinX, z2 = n.y*sinX + z1*cosX;
      const p = 3.0 / (3.0 - z2*0.9); n.sx = cx + x1*R*p; n.sy = cy + y1*R*p; n.depth = z2; n.p = p;
    }
    const nx = [];
    for (const p of pulses) { p.t += 0.024; if (p.t >= 1) { const to = nodes[p.to]; to.s = Math.min(1, to.s + p.en*0.7); const e2 = p.en*0.6; if (e2 > 0.16) for (const ei of to.edges){ const e=edges[ei], n2=e.a===p.to?e.b:e.a; if(n2!==p.from && Math.random()<0.65) nx.push({from:p.to,to:n2,t:0,en:e2}); } } else nx.push(p); }
    pulses = nx.length > 160 ? nx.slice(-160) : nx;
  }
  function draw() {
    ctx.clearRect(0,0,W,H);
    ctx.lineWidth = 1;
    for (const e of edges) { const a=nodes[e.a], b=nodes[e.b], st=(a.s+b.s)*0.5, dp=(a.depth+b.depth)*0.5, al=clamp(0.04+st*0.4,0,0.5)*(0.4+(dp+1)*0.3); if(al<0.02)continue; ctx.strokeStyle='rgba(' + A.r + ',' + A.g + ',' + A.b + ',' + al + ')'; ctx.beginPath(); ctx.moveTo(a.sx,a.sy); ctx.lineTo(b.sx,b.sy); ctx.stroke(); }
    const order = nodes.map((n,i)=>i).sort((i,j)=>nodes[i].depth-nodes[j].depth);
    ctx.globalCompositeOperation = 'lighter';
    for (const i of order) { const n=nodes[i], dz=(n.depth+1)*0.5, sz=(1+n.s*2.6)*n.p*(0.6+dz*0.5);
      if (n.s>0.12 && glow){ const gs=sz*(5+n.s*8); ctx.globalAlpha=clamp(n.s*0.5,0,0.6)*(0.4+dz*0.6); ctx.drawImage(glow,n.sx-gs/2,n.sy-gs/2,gs,gs); }
      ctx.globalAlpha=clamp(0.28+n.s*0.6,0,1)*(0.4+dz*0.6); ctx.beginPath(); ctx.arc(n.sx,n.sy,Math.max(0.5,sz),0,7); ctx.fillStyle='rgb(' + (lerp(A.r,250,n.s*n.s)|0) + ',' + (lerp(120,210,n.s)|0) + ',' + (lerp(50,150,n.s*0.5)|0) + ')'; ctx.fill();
    }
    for (const p of pulses) { const a=nodes[p.from], b=nodes[p.to], x=lerp(a.sx,b.sx,p.t), y=lerp(a.sy,b.sy,p.t), sz=2*p.en+1.2; if(glow){const gs=sz*8; ctx.globalAlpha=clamp(p.en,0,1)*0.8; ctx.drawImage(glow,x-gs/2,y-gs/2,gs,gs);} ctx.globalAlpha=1; ctx.beginPath(); ctx.arc(x,y,sz,0,7); ctx.fillStyle='rgb(255,236,200)'; ctx.fill(); }
    ctx.globalCompositeOperation='source-over'; ctx.globalAlpha=1;
  }
  function loop(){ step(); draw(); requestAnimationFrame(loop); }
  buildGlow(); build(); resize(); addEventListener('resize', resize);
  for (let i=0;i<5;i++) setTimeout(()=>fire((Math.random()*nodes.length)|0,0.8), i*150);
  loop();
})();
</script>

<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
const app = initializeApp(${JSON.stringify(cfg)});
const auth = getAuth(app);
const out = document.getElementById('out'), msg = document.getElementById('msg'), btn = document.getElementById('btn');
btn.addEventListener('click', async () => {
  try {
    btn.disabled = true;
    msg.classList.remove('err'); msg.textContent = 'Opening Google sign-in…';
    const cred = await signInWithPopup(auth, new GoogleAuthProvider());
    const id_token = await cred.user.getIdToken();
    msg.textContent = 'Verifying with the connector…';
    const res = await fetch(${JSON.stringify(opts.action)}, {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ login_id: ${JSON.stringify(opts.loginId ?? null)}, id_token })
    });
    const data = await res.json();
    if (data.redirect) { msg.textContent = 'Connected — redirecting…'; window.location = data.redirect; return; }
    msg.textContent = 'Verified by the connector:';
    out.textContent = JSON.stringify(data, null, 2);
    btn.disabled = false;
  } catch (e) { msg.classList.add('err'); msg.textContent = 'Error: ' + e.message; btn.disabled = false; }
});
</script>
</body>
</html>`;
}
