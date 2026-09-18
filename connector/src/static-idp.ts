// The "static" identity provider: log in to a self-hosted brain-store by pasting
// the token its operator issued (`brain-store user add <name>`).
//
// The connector never stores or checks tokens itself. It asks the store: a token
// is valid if `GET /auth/me` says so, and the user is whoever the store says it is.

const storeApi = () => (process.env.BRAIN_CLOUD_API_URL || "").replace(/\/$/, "");

/**
 * The static provider is only usable when the store address is set EXPLICITLY.
 * Falling back to the hosted default would send a self-hosted user's token to
 * somebody else's server.
 */
export const isStaticConfigured = () => storeApi() !== "";

export interface StoreUser {
  id: string;
  email?: string;
  name?: string;
}

/** Thrown by verifyStoreToken. `rejected` distinguishes "bad token" from "store is down". */
export class StoreLoginError extends Error {
  rejected: boolean;
  constructor(message: string, rejected: boolean) {
    super(message);
    this.rejected = rejected;
  }
}

/** Ask the store who this token belongs to. */
export async function verifyStoreToken(token: string): Promise<StoreUser> {
  if (!token) throw new StoreLoginError("no token given", true);
  // Bound what we are willing to forward: a token is short and has no whitespace.
  if (token.length > 512 || /\s/.test(token)) throw new StoreLoginError("that does not look like a store token", true);

  let res: Response;
  try {
    res = await fetch(`${storeApi()}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    throw new StoreLoginError(`store unreachable: ${(e as Error).message}`, false);
  }
  if (res.status === 401 || res.status === 403) throw new StoreLoginError("the store rejected this token", true);
  if (!res.ok) throw new StoreLoginError(`store answered ${res.status}`, false);

  const data = (await res.json().catch(() => null)) as { user?: StoreUser } | null;
  const user = data?.user;
  if (!user || typeof user.id !== "string" || !user.id) throw new StoreLoginError("store returned no user", false);
  return user;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/**
 * The sign-in page for a self-hosted store. Deliberately plain: no external
 * scripts, fonts or images, so the page that receives a credential loads nothing
 * from anywhere but this server.
 */
export function staticLoginPageHtml(opts: {
  action: string;
  loginId: string;
  title: string;
  clientName?: string;
  scope?: string;
  origin?: string;
}): string {
  const client = esc(opts.clientName || "An MCP client");
  const scopes = (opts.scope || "brain.read brain.write").split(/\s+/).filter(Boolean);
  const verb = scopes.includes("brain.write") ? "read and write" : "read";
  const host = esc(opts.origin || "this connector");
  let storeHost = storeApi();
  try { storeHost = new URL(storeApi()).host; } catch { /* shown as configured */ }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${esc(opts.title)}</title>
<style>
  :root { color-scheme: light dark; --bg:#f7f8fa; --card:#fff; --ink:#15181d; --muted:#5b6472; --line:#d9dee6; --accent:#0e7490; --bad:#b42318; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b0e12; --card:#141920; --ink:#e8ecf1; --muted:#9aa5b4; --line:#2a313c; --accent:#38bdf8; --bad:#ff8a80; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:16px; background:var(--bg); color:var(--ink);
         font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  main { width:100%; max-width:420px; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:28px; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { margin:0 0 16px; color:var(--muted); }
  label { display:block; font-weight:600; margin-bottom:6px; }
  input { width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:8px; background:transparent; color:inherit;
          font:14px ui-monospace,SFMono-Regular,Menlo,monospace; }
  input:focus { outline:2px solid var(--accent); outline-offset:1px; }
  button { margin-top:16px; width:100%; padding:11px; border:0; border-radius:8px; background:var(--accent); color:#fff;
           font:600 15px system-ui,sans-serif; cursor:pointer; }
  button[disabled] { opacity:.6; cursor:default; }
  #msg { min-height:1.5em; margin:12px 0 0; color:var(--bad); }
  small { display:block; margin-top:18px; color:var(--muted); }
  code { font:13px ui-monospace,SFMono-Regular,Menlo,monospace; }
</style>
</head>
<body>
<main>
  <h1>${esc(opts.title)}</h1>
  <p><strong>${client}</strong> is asking to ${verb} your memories, held in the store at <code>${esc(storeHost)}</code>.</p>
  <form id="f" autocomplete="off">
    <label for="t">Store token</label>
    <input id="t" name="store_token" type="password" required autofocus spellcheck="false" autocapitalize="off" placeholder="bst_…">
    <button id="b" type="submit">Connect</button>
    <p id="msg" role="alert"></p>
  </form>
  <small>The token is issued by whoever runs your store (<code>brain-store user add</code>). It is sent to ${host} and from there to your store, and to nobody else.</small>
</main>
<script>
  const form = document.getElementById('f'), msg = document.getElementById('msg'), btn = document.getElementById('b');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    msg.textContent = '';
    btn.disabled = true;
    try {
      const res = await fetch(${JSON.stringify(opts.action)}, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ login_id: ${JSON.stringify(opts.loginId)}, store_token: document.getElementById('t').value }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.redirect) { msg.style.color = 'inherit'; msg.textContent = 'Connected. Redirecting…'; window.location = data.redirect; return; }
      msg.textContent = data.error_description || 'Login failed.';
    } catch (e) {
      msg.textContent = 'Could not reach the connector.';
    }
    btn.disabled = false;
  });
</script>
</body>
</html>`;
}
