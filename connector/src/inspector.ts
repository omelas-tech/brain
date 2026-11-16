// MCP App: the memory inspector (`ui://brain/inspector`).
//
// MCP Apps (SEP-1865, extension `io.modelcontextprotocol/ui`) let a server ship
// an HTML view the host renders in a sandboxed iframe next to a tool's result.
// This view is linked from `brain_verify` and shows the review queue: every
// memory held for verification, with where it came from and why it was held.
//
// It is read-only. It makes no tool calls and has no approve or reject
// buttons: resolving a memory stays in the conversation, through the normal
// tool-call consent path. The view only makes the queue readable.
//
// Gated behind CONNECTOR_ENABLE_UI=1 (see server.ts). With the flag off the
// tool surface carries no UI metadata at all.
//
// The HTML is self-contained — inline CSS and JS, no CDN, no fetch — so it
// runs under the default MCP Apps CSP (`default-src 'none'` plus inline). It
// speaks the view side of the protocol by hand instead of bundling the
// ext-apps SDK: `ui/initialize` → `ui/notifications/initialized`, then it
// renders whatever `ui/notifications/tool-result` delivers.
//
// Memory titles and reasons are untrusted text (a quarantined memory is, by
// definition, content nobody has vetted). Everything is written with
// textContent — never innerHTML.

export const INSPECTOR_URI = "ui://brain/inspector";
export const INSPECTOR_MIME = "text/html;profile=mcp-app";
/** Protocol revision the view speaks (ext-apps LATEST_PROTOCOL_VERSION). */
export const INSPECTOR_PROTOCOL = "2026-01-26";

/** Tool `_meta` linking a tool to the view. The flat key is the pre-GA spelling some hosts still read. */
export const INSPECTOR_TOOL_META = {
  ui: { resourceUri: INSPECTOR_URI },
  "ui/resourceUri": INSPECTOR_URI,
};

/** Self-contained inspector HTML. */
export function inspectorHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Brain — Memory Inspector</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: var(--color-background-primary, light-dark(#ffffff, #0f1113));
    --fg: var(--color-text-primary, light-dark(#111111, #e8e8e8));
    --muted: var(--color-text-secondary, light-dark(#666666, #9aa0a6));
    --line: var(--color-border-primary, light-dark(#e3e3e3, #2a2d31));
    --warn: light-dark(#8a5300, #e0a94a);
    --danger: light-dark(#b00020, #ff7a8a);
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 var(--font-sans, ui-sans-serif, system-ui, sans-serif); background: var(--bg); color: var(--fg); }
  header { padding: 14px 16px 10px; border-bottom: 1px solid var(--line); }
  h1 { font-size: 15px; margin: 0; }
  .sub { color: var(--muted); font-size: 12px; margin-top: 2px; }
  main { padding: 4px 16px 14px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { padding: 10px 0; border-bottom: 1px solid var(--line); }
  li:last-child { border-bottom: 0; }
  .title { font-weight: 600; overflow-wrap: anywhere; }
  .meta { color: var(--muted); font-size: 12px; margin-top: 2px; overflow-wrap: anywhere; }
  .badge { display: inline-block; padding: 0 7px; border-radius: 999px; font-size: 11px; border: 1px solid currentColor; margin-right: 6px; }
  .b-danger { color: var(--danger); }
  .b-warn { color: var(--warn); }
  .id { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); }
  .empty { color: var(--muted); padding: 18px 0 6px; }
  footer { color: var(--muted); font-size: 12px; padding: 10px 16px 14px; border-top: 1px solid var(--line); }
</style>
</head>
<body>
<header>
  <h1 id="heading">Memory Inspector</h1>
  <div class="sub" id="sub">Memories held for verification before they can be recalled.</div>
</header>
<main id="root"><p class="empty">Waiting for the review queue…</p></main>
<footer id="foot" hidden>This view is read-only. To resolve a memory, ask in the conversation to approve or reject it by name.</footer>
<script>
(function () {
  var host = window.parent;
  var nextId = 1;
  var pendingRequests = {};

  function send(msg) { msg.jsonrpc = '2.0'; host.postMessage(msg, '*'); }
  function request(method, params, done) {
    var id = nextId++;
    pendingRequests[id] = done;
    send({ id: id, method: method, params: params });
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function reportSize() {
    send({ method: 'ui/notifications/size-changed', params: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight
    } });
  }

  // Origins that did not come from the user/agent dialogue are the dangerous
  // ones; everything else was held for what the text says, not where it came from.
  function originBadge(origin) {
    var outside = origin === 'external' || origin === 'tool-output';
    return el('span', 'badge ' + (outside ? 'b-danger' : 'b-warn'), origin || 'unknown origin');
  }
  function day(iso) { return typeof iso === 'string' ? iso.slice(0, 10) : ''; }

  function renderQueue(pending) {
    var root = document.getElementById('root');
    root.textContent = '';
    document.getElementById('heading').textContent =
      pending.length === 1 ? '1 memory awaiting review' : pending.length + ' memories awaiting review';
    document.getElementById('foot').hidden = pending.length === 0;
    if (!pending.length) {
      root.appendChild(el('p', 'empty', 'Nothing is waiting for review.'));
      return;
    }
    var list = el('ul');
    pending.forEach(function (m) {
      var item = el('li');
      item.appendChild(el('div', 'title', m.title || m.id || 'Untitled memory'));
      var meta = el('div', 'meta');
      meta.appendChild(originBadge(m.origin));
      var parts = [];
      if (m.type) parts.push(m.type);
      if (Array.isArray(m.reasons) && m.reasons.length) parts.push('held for: ' + m.reasons.join(', '));
      if (day(m.flagged)) parts.push('since ' + day(m.flagged));
      meta.appendChild(document.createTextNode(parts.join(' · ')));
      item.appendChild(meta);
      if (m.id) item.appendChild(el('div', 'id', m.id));
      list.appendChild(item);
    });
    root.appendChild(list);
  }

  // approve / reject results carry no queue — show the tool's own summary line.
  function renderMessage(text) {
    var root = document.getElementById('root');
    root.textContent = '';
    document.getElementById('heading').textContent = 'Memory Inspector';
    document.getElementById('foot').hidden = true;
    root.appendChild(el('p', 'empty', text));
  }

  function onToolResult(result) {
    var data = result && result.structuredContent;
    if (data && Array.isArray(data.pending)) {
      renderQueue(data.pending);
    } else {
      var first = result && Array.isArray(result.content) && result.content[0];
      renderMessage(first && typeof first.text === 'string' ? first.text : 'No review queue in this result.');
    }
    reportSize();
  }

  function applyHostContext(ctx) {
    var vars = ctx && ctx.styles && ctx.styles.variables;
    if (!vars) return;
    Object.keys(vars).forEach(function (name) {
      if (name.indexOf('--') === 0 && typeof vars[name] === 'string') {
        document.documentElement.style.setProperty(name, vars[name]);
      }
    });
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== host) return;
    var msg = ev.data;
    if (!msg || msg.jsonrpc !== '2.0') return;
    if (msg.method === undefined) {
      var done = pendingRequests[msg.id];
      delete pendingRequests[msg.id];
      if (done) done(msg.result, msg.error);
      return;
    }
    if (msg.method === 'ui/notifications/tool-result') onToolResult(msg.params);
    else if (msg.method === 'ui/notifications/host-context-changed') applyHostContext(msg.params);
    else if (msg.id !== undefined) {
      // Requests from the host: answer the two a passive view can, refuse the rest.
      if (msg.method === 'ping' || msg.method === 'ui/resource-teardown') send({ id: msg.id, result: {} });
      else send({ id: msg.id, error: { code: -32601, message: 'Method not found' } });
    }
  });

  request('ui/initialize', {
    appInfo: { name: 'brain-memory-inspector', version: '1.0.0' },
    appCapabilities: {},
    protocolVersion: '${INSPECTOR_PROTOCOL}'
  }, function (result) {
    applyHostContext(result && result.hostContext);
    send({ method: 'ui/notifications/initialized' });
    reportSize();
  });

  if (typeof ResizeObserver === 'function') new ResizeObserver(reportSize).observe(document.documentElement);
})();
</script>
</body>
</html>`;
}
