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
 * A minimal sign-in page: Google login via the Firebase web SDK, then POST the
 * resulting ID token (as JSON) to `action`. On a JSON `{redirect}` response it
 * navigates there (the OAuth flow); otherwise it shows the JSON (the demo page).
 */
export function loginPageHtml(opts: { action: string; loginId?: string; title: string }): string {
  const cfg = firebaseConfig();
  return `<!doctype html><html><head><meta charset="utf-8"><title>${opts.title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:system-ui;background:#07090A;color:#FFF2D2;display:grid;place-items:center;height:100vh;margin:0}
  .card{background:#0e1113;border:1px solid #20242890;border-radius:16px;padding:2rem 2.5rem;text-align:center;max-width:340px}
  button{background:#E8A33D;color:#07090A;border:0;border-radius:10px;padding:.7rem 1.2rem;font-weight:600;font-size:1rem;cursor:pointer}
  pre{text-align:left;color:#FFDD8C;font-size:.8rem;white-space:pre-wrap;word-break:break-all}
  h1{font-size:1.1rem}
</style></head><body><div class="card">
  <h1>🧠 ${opts.title}</h1>
  <p id="msg">Sign in to connect your brain.</p>
  <button id="btn">Sign in with Google</button>
  <pre id="out"></pre>
</div>
<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
const app = initializeApp(${JSON.stringify(cfg)});
const auth = getAuth(app);
const out = document.getElementById('out'), msg = document.getElementById('msg');
document.getElementById('btn').onclick = async () => {
  try {
    msg.textContent = 'Opening Google sign-in…';
    const cred = await signInWithPopup(auth, new GoogleAuthProvider());
    const id_token = await cred.user.getIdToken();
    msg.textContent = 'Verifying with the connector…';
    const res = await fetch(${JSON.stringify(opts.action)}, {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ login_id: ${JSON.stringify(opts.loginId ?? null)}, id_token })
    });
    const data = await res.json();
    if (data.redirect) { window.location = data.redirect; return; }
    msg.textContent = 'Verified by the connector:';
    out.textContent = JSON.stringify(data, null, 2);
  } catch (e) { msg.textContent = 'Error: ' + e.message; }
};
</script></body></html>`;
}
