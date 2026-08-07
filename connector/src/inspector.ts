// Experimental MCP App: the memory inspector (`ui://brain/inspector`).
//
// MCP Apps let a server ship an interactive HTML UI the host renders in a
// sandboxed iframe. Client support is still emerging, so this is gated behind
// CONNECTOR_ENABLE_UI=1 and dormant by default — it must never affect the
// production tool surface. The HTML is fully self-contained (inline CSS/JS, no
// CDN, no external fetch) to satisfy an MCP App sandbox CSP.
//
// It renders the trust view: each recalled memory's origin, verification state,
// and provenance — the human-facing half of the quarantine defense. Actions
// (forget / verify) are intended to route back through the normal tool-call
// consent path; this first cut is read-only scaffolding.

export const INSPECTOR_URI = "ui://brain/inspector";

/** Self-contained inspector HTML. `data` is injected as a JSON island. */
export function inspectorHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Brain — Memory Inspector</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#111; --muted:#666; --line:#e3e3e3; --warn:#b26b00; --danger:#b00020; --ok:#1a7f37; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1113; --fg:#e8e8e8; --muted:#9aa0a6; --line:#2a2d31; } }
  body { margin:0; font:14px/1.5 ui-sans-serif,system-ui,sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:16px 20px; border-bottom:1px solid var(--line); }
  h1 { font-size:15px; margin:0; letter-spacing:.02em; }
  .sub { color:var(--muted); font-size:12px; margin-top:2px; }
  main { padding:12px 20px; }
  table { width:100%; border-collapse:collapse; }
  th,td { text-align:left; padding:8px 6px; border-bottom:1px solid var(--line); font-size:13px; vertical-align:top; }
  th { color:var(--muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
  .badge { display:inline-block; padding:1px 7px; border-radius:999px; font-size:11px; border:1px solid var(--line); }
  .b-danger { color:var(--danger); border-color:var(--danger); }
  .b-warn { color:var(--warn); border-color:var(--warn); }
  .b-ok { color:var(--ok); border-color:var(--ok); }
  .empty { color:var(--muted); padding:24px 0; }
  code { background:color-mix(in srgb, var(--fg) 8%, transparent); padding:1px 4px; border-radius:4px; }
</style>
</head>
<body>
<header>
  <h1>Memory Inspector</h1>
  <div class="sub">Provenance and verification state for recalled memories. Resolve pending items with <code>brain verify</code>.</div>
</header>
<main>
  <div id="root"><p class="empty">Waiting for recall data…</p></div>
</main>
<script>
  // The host posts recall results (array of memory objects) to this iframe.
  // Each object may carry: title, origin, low_trust, quarantine_pending,
  // superseded_by, confidence.
  function badge(m) {
    if (m.quarantine_pending) return '<span class="badge b-danger">\\u2298 unverified</span>';
    if (m.superseded_by) return '<span class="badge">superseded</span>';
    if (m.low_trust) return '<span class="badge b-warn">\\u26a0 ' + (m.origin||'') + '</span>';
    return '<span class="badge b-ok">' + (m.origin||'agent-inferred') + '</span>';
  }
  function render(mems) {
    var root = document.getElementById('root');
    if (!mems || !mems.length) { root.innerHTML = '<p class="empty">No memories to show.</p>'; return; }
    var rows = mems.map(function(m){
      return '<tr><td>' + (m.title||m.id||'memory') + '</td><td>' + badge(m) +
        '</td><td>' + (m.confidence!=null ? Number(m.confidence).toFixed(2) : '\\u2014') + '</td></tr>';
    }).join('');
    root.innerHTML = '<table><thead><tr><th>Memory</th><th>Trust</th><th>Confidence</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  window.addEventListener('message', function(ev){
    var d = ev && ev.data;
    if (d && d.type === 'brain/recall' && Array.isArray(d.results)) render(d.results);
  });
</script>
</body>
</html>`;
}
