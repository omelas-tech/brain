// OAuth 2.1 Authorization Server for the connector.
//
// Ported from the proven, dependency-free spike (brain-cloud/connector-spike):
// RFC 8414 (AS metadata) + 7591 (DCR) + PKCE S256 + 8707 (resource/audience) +
// 9207 (iss). Mints tokens into auth.ts's store so the resource guard accepts them.
//
// Both former stubs are now fully wired:
//   • Identity — /authorize bounces the user through the active identity provider
//     (identity.ts): Firebase Google login for the hosted service, or a pasted
//     store token for a self-hosted brain-store. Verified server-side either way.
//   • Store — the user's brain is pulled from the store (store.ts) keyed on the
//     verified subject; writes sync back. With no provider configured, /authorize
//     falls back to a fixed dev user so the headless tests run without a browser —
//     never in production.

import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import type { Express, Request, Response } from "express";

import { issueToken } from "./auth.js";
import { activeProvider, RenewError, type VerifiedLogin } from "./identity.js";
import { ensureUserBrain } from "./store.js";
import {
  getClient,
  putClient,
  clientCount,
  createRefreshGrant,
  lookupGrant,
  rotateGrant,
  updateGrant,
  revokeFamily,
  sweepGrants,
  refreshGraceMs,
  type RefreshGrant,
} from "./persist.js";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest();
const rand = () => b64url(crypto.randomBytes(32));

const SCOPES = ["brain.read", "brain.write"];
const CODE_TTL_MS = 60_000;
const ACCESS_TOKEN_TTL_S = 3600; // matches auth.TOKEN_TTL_MS; short is fine — clients refresh silently

// How long a login lives without use. Sliding window: every silent refresh
// rotates the token and restarts the clock, so an active user never sees the
// login page again; only ~a month of total inactivity does.
const refreshTtlMs = () => Number(process.env.CONNECTOR_REFRESH_TTL_MS ?? 30 * 24 * 3600 * 1000);

interface AuthCode {
  clientId: string; redirectUri: string; codeChallenge: string;
  resource: string; userId: string; scope: string; exp: number;
  brainId?: string; idToken?: string; // the store bearer (a Firebase ID token, or a static store token) — carried to the session for sync-back
  fbRefreshToken?: string; // the provider's renewal secret (Firebase refresh token, or the static store token) — lets the OAuth refresh grant renew identity
  identityNote?: string; // carried to the session: login-time identity-hygiene hint
}
interface PendingLogin {
  clientId: string; redirectUri: string; codeChallenge: string;
  resource: string; scope: string; state?: string; exp: number;
  attempts: number; // failed completions so far (see IdentityProvider.maxAttempts)
  carry?: Record<string, string>; // redirect-style providers: PKCE verifier + nonce, server-side only
}
const authCodes = new Map<string, AuthCode>();
const pendingLogins = new Map<string, PendingLogin>(); // login_id → validated OAuth params
const LOGIN_TTL_MS = 600_000;
const MAX_CLIENTS = 50_000; // bound the open-DCR registry against memory exhaustion

/** Drop expired auth codes, pending logins, and refresh grants. */
export function sweepExpired(now = Date.now()): void {
  for (const [k, v] of authCodes) if (v.exp < now) authCodes.delete(k);
  for (const [k, v] of pendingLogins) if (v.exp < now) pendingLogins.delete(k);
  sweepGrants(now);
}

/** Build the OAuth callback URL back to the client (code + state + iss). */
function callbackUrl(redirectUri: string, issuer: string, params: Record<string, string>, state?: string): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  if (state) u.searchParams.set("state", state);
  u.searchParams.set("iss", issuer); // RFC 9207
  return u.toString();
}

function mintAuthCode(p: { clientId: string; redirectUri: string; codeChallenge: string; resource: string; scope: string; userId: string; brainId?: string; idToken?: string; fbRefreshToken?: string; identityNote?: string }): string {
  const code = "code_" + rand();
  authCodes.set(code, { ...p, exp: Date.now() + CODE_TTL_MS });
  return code;
}

const issuerOf = (req: Request) => `${req.protocol}://${req.get("host")}`;
export const mcpResource = (issuer: string) => `${issuer}/mcp`;

/**
 * Is the no-Firebase dev auto-approve stub permitted? Only when explicitly opted
 * in (CONNECTOR_DEV_AUTH=1) AND not running in production. Production NEVER allows
 * it, regardless of the flag — see also the boot guard in server.ts.
 */
export function devAuthAllowed(): boolean {
  return process.env.CONNECTOR_DEV_AUTH === "1" && process.env.NODE_ENV !== "production";
}

// Maps a provider subject (a Firebase uid, or `static:<store user id>`) → brain user.
export function resolveBrainUserId(subject: string): string {
  return "brain_" + b64url(sha256(subject)).slice(0, 12);
}

// STUB:STORE — real flow ensures this dir is populated from the user's canonical
// store (brain-cloud bundle, or BYOS git/Drive). Base is configurable for tests.
// Default to an EPHEMERAL OS-temp base so plaintext working copies never land in a
// persistent home dir on dev / non-systemd hosts; prod overrides this to a RAM
// tmpfs (CONNECTOR_BRAIN_BASE=/run/brain-connector). Either way, copies are reaped
// when idle / on session end (see store.purgeBrain + the reaper in server.ts).
export function resolveBrainDir(userId: string): string {
  const base = process.env.CONNECTOR_BRAIN_BASE || path.join(os.tmpdir(), "brain-connector", "users");
  return path.join(base, userId, ".brain");
}

/**
 * A login has been verified: provision the user's brain from the store, mint the
 * auth code, and return the URL that takes the browser back to the OAuth client.
 */
async function finishLogin(login: PendingLogin, verified: VerifiedLogin, issuer: string): Promise<string> {
  const userId = resolveBrainUserId(verified.subject);
  const id_token = verified.storeToken;

  // STUB:STORE (now real) — populate this user's brain from their canonical
  // store, via their store credential, before issuing the code.
  const store = await ensureUserBrain({ userId, brainDir: resolveBrainDir(userId), idToken: id_token, refresh: true });
  // Log the opaque user id only — never the email (PII) — for ops correlation.
  // The identity status (ok / no-cloud-brain / multiple-brains) is non-PII and
  // useful for spotting wrong-account sign-ins in the field.
  console.log(`[connector] login ${userId} — brain via ${store.source} (${store.memoryCount} memories, identity: ${store.identity?.status ?? "n/a"})`);

  const code = mintAuthCode({
    clientId: login.clientId, redirectUri: login.redirectUri, codeChallenge: login.codeChallenge,
    resource: login.resource, scope: login.scope, userId,
    brainId: store.brainId, idToken: id_token, // carry to session for write sync-back
    fbRefreshToken: verified.renewal,
    identityNote: store.identity?.note, // surfaced to the user by the MCP tools
  });
  return callbackUrl(login.redirectUri, issuer, { code }, login.state);
}

export function registerOAuthRoutes(app: Express): void {
  // RFC 8414 — Authorization Server Metadata
  app.get("/.well-known/oauth-authorization-server", (req, res) => {
    const issuer = issuerOf(req);
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      scopes_supported: SCOPES,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"], // public client + PKCE
      authorization_response_iss_parameter_supported: true, // RFC 9207
    });
  });

  // RFC 7591 — Dynamic Client Registration
  app.post("/register", (req: Request, res: Response) => {
    const redirectUris = req.body?.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
      res.status(400).json({ error: "invalid_redirect_uri", error_description: "redirect_uris required" });
      return;
    }
    if (clientCount() >= MAX_CLIENTS) {
      res.status(503).json({ error: "temporarily_unavailable", error_description: "client registry full" });
      return;
    }
    const clientId = "client_" + rand();
    const name = typeof req.body?.client_name === "string" ? req.body.client_name : undefined;
    putClient(clientId, { redirectUris, name });
    res.status(201).json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });

  // Authorization endpoint (PKCE S256 + resource required)
  app.get("/authorize", (req: Request, res: Response) => {
    const issuer = issuerOf(req);
    const q = req.query as Record<string, string>;
    const client = getClient(q.client_id);
    if (!client || !client.redirectUris.includes(q.redirect_uri)) {
      res.status(400).json({ error: "invalid_request", error_description: "unknown client_id or redirect_uri" });
      return;
    }
    const fail = (error: string, desc?: string) =>
      res.redirect(302, callbackUrl(q.redirect_uri, issuer, { error, error_description: desc! }, q.state));
    if (q.response_type !== "code") return fail("unsupported_response_type");
    if (q.code_challenge_method !== "S256") return fail("invalid_request", "PKCE S256 required");
    if (!q.code_challenge) return fail("invalid_request", "code_challenge required");
    if (q.resource !== mcpResource(issuer)) return fail("invalid_target", "resource must be this MCP server");

    const params = {
      clientId: q.client_id, redirectUri: q.redirect_uri, codeChallenge: q.code_challenge,
      resource: q.resource, scope: q.scope || SCOPES.join(" "),
    };

    // Establish WHO the user is.
    const idp = activeProvider();
    if (!idp) {
      // FAIL CLOSED: with no identity provider, the only way to "log in" is the
      // dev stub below, which auto-approves a FIXED shared user. That must NEVER
      // happen in production (it would hand anyone a token for a shared brain), so
      // it is gated behind an explicit opt-in AND refused under NODE_ENV=production.
      // The server also refuses to BOOT in production without Firebase (server.ts);
      // this is the defense-in-depth layer for a misconfigured non-prod box.
      if (!devAuthAllowed()) {
        return fail("server_error", "login unavailable: identity provider not configured");
      }
      // STUB:FIREBASE (dev/test only) — headless auto-approve of a fixed user.
      const userId = resolveBrainUserId("firebase-uid-TEST");
      const code = mintAuthCode({ ...params, userId });
      return res.redirect(302, callbackUrl(q.redirect_uri, issuer, { code }, q.state));
    }

    // Real login: stash the validated OAuth params, render the provider's sign-in
    // page. /authorize/complete verifies what it posts back and mints the code.
    const loginId = "login_" + rand();
    if (idp.startRedirect) {
      // Redirect-style provider: the issuer hosts the login. Our login id travels
      // as `state`; the PKCE verifier and nonce stay here, never in the browser.
      idp.startRedirect({ callbackUrl: `${issuer}/oidc/callback`, state: loginId }).then((started) => {
        pendingLogins.set(loginId, { ...params, state: q.state, exp: Date.now() + LOGIN_TTL_MS, attempts: 0, carry: started.carry });
        res.redirect(302, started.url);
      }, (e: Error) => {
        console.error(`[connector] identity provider unavailable: ${e.message}`);
        fail("temporarily_unavailable", "identity provider unavailable");
      });
      return;
    }
    pendingLogins.set(loginId, { ...params, state: q.state, exp: Date.now() + LOGIN_TTL_MS, attempts: 0 });
    if (idp.name === "static") {
      // This page takes a credential: never let another site frame it.
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Cache-Control", "no-store");
    }
    res.type("html").send(idp.loginPage({
      action: "/authorize/complete",
      loginId,
      title: "Connect your brain",
      clientName: client.name,
      scope: params.scope,
      origin: req.get("host"),
    }));
  });

  // Redirect-style providers land here on the way back from the issuer.
  app.get("/oidc/callback", async (req: Request, res: Response) => {
    const issuer = issuerOf(req);
    const q = req.query as Record<string, string>;
    const login = pendingLogins.get(q.state);
    pendingLogins.delete(q.state); // single-use
    const idp = activeProvider();
    if (!login || login.exp < Date.now() || !login.carry || !idp?.finishRedirect) {
      res.status(400).type("text").send("This sign-in link is unknown or has expired. Start again from your client.");
      return;
    }
    const back = (error: string, desc: string) =>
      res.redirect(302, callbackUrl(login.redirectUri, issuer, { error, error_description: desc }, login.state));
    if (q.error || !q.code) return back("access_denied", q.error ? `sign-in was not completed (${q.error})` : "no authorization code");
    try {
      const verified = await idp.finishRedirect({ callbackUrl: `${issuer}/oidc/callback`, code: q.code, carry: login.carry });
      res.redirect(302, await finishLogin(login, verified, issuer));
    } catch (e: any) {
      back("access_denied", `login failed: ${e.message}`);
    }
  });

  // Completes a login: verify what the provider's page posted, resolve the brain
  // user, mint the auth code, and hand the client-callback URL back to the page.
  app.post("/authorize/complete", async (req: Request, res: Response) => {
    const issuer = issuerOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const login_id = body.login_id as string;
    const login = pendingLogins.get(login_id);
    pendingLogins.delete(login_id); // single-use (re-armed below for a provider that allows retries)
    if (!login || login.exp < Date.now()) {
      res.status(400).json({ error: "invalid_request", error_description: "unknown or expired login" });
      return;
    }
    const idp = activeProvider();
    if (!idp) {
      res.status(400).json({ error: "invalid_request", error_description: "login unavailable: identity provider not configured" });
      return;
    }
    let verified;
    try {
      verified = await idp.verifyLogin(body);
    } catch (e: any) {
      // A pasted token can be mistyped: let the same page try again, a bounded
      // number of times, rather than sending the user back to their client.
      login.attempts += 1;
      const retry = login.attempts < idp.maxAttempts;
      if (retry) pendingLogins.set(login_id, login);
      res.status(401).json({
        error: "access_denied",
        error_description: `login failed: ${e.message}${retry ? "" : idp.maxAttempts > 1 ? " — too many attempts, please reconnect from your client" : ""}`,
      });
      return;
    }
    res.json({ redirect: await finishLogin(login, verified, issuer) });
  });

  // Token endpoint — authorization_code (PKCE + audience binding) and
  // refresh_token (silent renewal — the reason users don't re-login hourly).
  app.post("/token", async (req: Request, res: Response) => {
    const b = req.body ?? {};
    if (b.grant_type === "refresh_token") return handleRefreshGrant(b, res);
    if (b.grant_type !== "authorization_code") {
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }
    const entry = authCodes.get(b.code);
    authCodes.delete(b.code); // single-use
    if (!entry || entry.exp < Date.now()) {
      res.status(400).json({ error: "invalid_grant", error_description: "unknown or expired code" });
      return;
    }
    if (entry.clientId !== b.client_id || entry.redirectUri !== b.redirect_uri) {
      res.status(400).json({ error: "invalid_grant", error_description: "client/redirect mismatch" });
      return;
    }
    if (b64url(sha256(b.code_verifier || "")) !== entry.codeChallenge) {
      res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
      return;
    }
    if (b.resource !== entry.resource) {
      res.status(400).json({ error: "invalid_target", error_description: "resource mismatch" });
      return;
    }
    const access_token = issueToken(entry.userId, resolveBrainDir(entry.userId), {
      scope: entry.scope,
      aud: entry.resource, // RFC 8707 audience binding
      brainId: entry.brainId, idToken: entry.idToken, // for write sync-back
      identityNote: entry.identityNote, // login-time identity-hygiene hint
    });
    const now = Date.now();
    const refresh_token = createRefreshGrant({
      familyId: "fam_" + rand(),
      clientId: entry.clientId, userId: entry.userId, scope: entry.scope, aud: entry.resource,
      brainId: entry.brainId, identityNote: entry.identityNote, fbRefreshToken: entry.fbRefreshToken,
      exp: now + refreshTtlMs(), createdAt: now, lastUsedAt: now,
    });
    res.json({ access_token, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_S, refresh_token, scope: entry.scope });
  });
}

/**
 * The refresh_token grant. Renews the whole credential chain with no user present:
 *   ① validate + rotate our refresh token (OAuth 2.1: single-use, family-revoked
 *     on reuse — a replayed token means theft, so every sibling dies with it.
 *     Exception: inside a short grace window a replay is a benign burst race —
 *     concurrent refreshes or a retry after a lost response — and gets the SAME
 *     successor token back instead of a family kill);
 *   ② renew the STORE credential through the identity provider, so the new
 *     session can still pull/sync-back (with Firebase, the 1-hour ID token from
 *     login is long dead by now; with a static token, this is where a token
 *     rotated or removed at the store ends the session);
 *   ③ re-provision the brain working copy if it was purged, and mint the access
 *     token. Transient failures return 503 — the client keeps its refresh token
 *     and retries; only a real revocation invalidates the grant.
 */
async function handleRefreshGrant(b: Record<string, string>, res: Response): Promise<void> {
  const invalid = (desc: string) =>
    void res.status(400).json({ error: "invalid_grant", error_description: desc });

  const found = typeof b.refresh_token === "string" && b.refresh_token ? lookupGrant(b.refresh_token) : null;
  if (!found) return invalid("unknown or expired refresh token");
  const { hash, grant } = found;
  const now = Date.now();
  if (grant.revoked) return invalid("refresh token revoked");
  if (grant.exp < now) return invalid("refresh token expired — please reconnect");
  if (b.client_id !== grant.clientId) return invalid("client mismatch");
  if (b.resource && b.resource !== grant.aud) {
    res.status(400).json({ error: "invalid_target", error_description: "resource mismatch" });
    return;
  }
  if (grant.rotatedTo) {
    // Replay of an already-rotated token. Within the grace window, answer with
    // the SAME successor (burst race — see rotateGrant); past it, theft: kill
    // the family. The successor must itself still be pristine.
    const inGrace = grant.successorToken != null && grant.rotatedAt != null && now - grant.rotatedAt <= refreshGraceMs();
    const succ = inGrace ? lookupGrant(grant.successorToken!) : null;
    if (succ && !succ.grant.revoked && !succ.grant.rotatedTo && succ.grant.exp > now) {
      return renewSession(succ.hash, succ.grant, { rotate: false, presentedToken: grant.successorToken! }, res);
    }
    const n = revokeFamily(grant.familyId);
    console.error(`[connector] refresh-token reuse detected for ${grant.userId} — revoked ${n} grant(s) in family`);
    return invalid("refresh token reuse detected — all sessions for this login were revoked");
  }
  return renewSession(hash, grant, { rotate: true, presentedToken: b.refresh_token }, res);
}

/** Steps ②+③ of the refresh grant: renew identity, re-provision, mint tokens. */
async function renewSession(
  hash: string,
  grant: RefreshGrant,
  opts: { rotate: boolean; presentedToken: string },
  res: Response,
): Promise<void> {
  const invalid = (desc: string) =>
    void res.status(400).json({ error: "invalid_grant", error_description: desc });
  const now = Date.now();

  // Renew the store credential. A grant minted under a provider but carrying no
  // renewal secret can't renew identity — fail closed rather than silently serving
  // an empty brain.
  let idToken: string | undefined;
  let fbRefreshToken = grant.fbRefreshToken;
  const idp = activeProvider();
  if (idp) {
    if (!fbRefreshToken) return invalid("session cannot be renewed — please reconnect");
    try {
      const renewed = await idp.renew(fbRefreshToken);
      idToken = renewed.storeToken;
      fbRefreshToken = renewed.renewal;
    } catch (e) {
      if (e instanceof RenewError && !e.permanent) {
        res.status(503).json({ error: "temporarily_unavailable", error_description: "identity provider unreachable — retry" });
        return;
      }
      // The provider refused the credential (account revoked/disabled, or the
      // store token rotated) → the login is over.
      revokeFamily(grant.familyId);
      console.log(`[connector] refresh for ${grant.userId} refused by identity provider — family revoked`);
      return invalid("login expired — please reconnect");
    }
  }

  // Re-provision the working copy (it may have been purged since the last call).
  const brainDir = resolveBrainDir(grant.userId);
  const store = await ensureUserBrain({ userId: grant.userId, brainDir, idToken });
  if (store.source.includes("(failed:")) {
    // brain-cloud outage mid-refresh: issuing a token now would serve an empty
    // brain. Let the client retry — it keeps both its tokens.
    res.status(503).json({ error: "temporarily_unavailable", error_description: "brain store unreachable — retry" });
    return;
  }
  const brainId = store.brainId ?? grant.brainId;
  const identityNote = store.identity?.note ?? grant.identityNote;

  let refresh_token: string;
  if (opts.rotate) {
    refresh_token = rotateGrant(hash, {
      ...grant,
      brainId, identityNote, fbRefreshToken,
      exp: now + refreshTtlMs(), // sliding window restarts on every use
      lastUsedAt: now,
    });
  } else {
    // Grace replay: hand back the SAME successor token; just keep its grant current
    // (Google may have rotated the Firebase refresh token underneath us).
    refresh_token = opts.presentedToken;
    updateGrant(hash, { brainId, identityNote, fbRefreshToken, lastUsedAt: now });
  }
  const access_token = issueToken(grant.userId, brainDir, {
    scope: grant.scope, aud: grant.aud, brainId, idToken, identityNote,
  });
  res.json({ access_token, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_S, refresh_token, scope: grant.scope });
}
