// OAuth 2.1 Authorization Server for the connector.
//
// Ported from the proven, dependency-free spike (brain-cloud/connector-spike):
// RFC 8414 (AS metadata) + 7591 (DCR) + PKCE S256 + 8707 (resource/audience) +
// 9207 (iss). Mints tokens into auth.ts's store so the resource guard accepts them.
//
// Two seams remain stubbed for Phase 2 (clearly marked):
//   STUB:FIREBASE   — /authorize auto-approves a fixed user instead of bouncing
//                     through Firebase login.
//   STUB:STORE      — resolveBrainDir maps a user to a local dir; Phase 2 syncs
//                     that dir from the user's canonical store (brain-cloud / BYOS).

import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import type { Express, Request, Response } from "express";

import { issueToken } from "./auth.js";
import {
  isFirebaseConfigured,
  verifyFirebaseIdToken,
  loginPageHtml,
} from "./firebase.js";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest();
const rand = () => b64url(crypto.randomBytes(32));

const SCOPES = ["brain.read", "brain.write"];
const CODE_TTL_MS = 60_000;

interface Client { redirectUris: string[]; }
interface AuthCode {
  clientId: string; redirectUri: string; codeChallenge: string;
  resource: string; userId: string; scope: string; exp: number;
}
interface PendingLogin {
  clientId: string; redirectUri: string; codeChallenge: string;
  resource: string; scope: string; state?: string; exp: number;
}
const clients = new Map<string, Client>();
const authCodes = new Map<string, AuthCode>();
const pendingLogins = new Map<string, PendingLogin>(); // login_id → validated OAuth params
const LOGIN_TTL_MS = 600_000;

/** Build the OAuth callback URL back to the client (code + state + iss). */
function callbackUrl(redirectUri: string, issuer: string, params: Record<string, string>, state?: string): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  if (state) u.searchParams.set("state", state);
  u.searchParams.set("iss", issuer); // RFC 9207
  return u.toString();
}

function mintAuthCode(p: { clientId: string; redirectUri: string; codeChallenge: string; resource: string; scope: string; userId: string }): string {
  const code = "code_" + rand();
  authCodes.set(code, { ...p, exp: Date.now() + CODE_TTL_MS });
  return code;
}

const issuerOf = (req: Request) => `${req.protocol}://${req.get("host")}`;
export const mcpResource = (issuer: string) => `${issuer}/mcp`;

// STUB:FIREBASE — real flow verifies a Firebase login and maps uid → brain user.
export function resolveBrainUserId(firebaseUid: string): string {
  return "brain_" + b64url(sha256(firebaseUid)).slice(0, 12);
}

// STUB:STORE — real flow ensures this dir is populated from the user's canonical
// store (brain-cloud bundle, or BYOS git/Drive). Base is configurable for tests.
export function resolveBrainDir(userId: string): string {
  const base = process.env.CONNECTOR_BRAIN_BASE || path.join(os.homedir(), ".brain-connector", "users");
  return path.join(base, userId, ".brain");
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
      grant_types_supported: ["authorization_code"],
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
    const clientId = "client_" + rand();
    clients.set(clientId, { redirectUris });
    res.status(201).json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    });
  });

  // Authorization endpoint (PKCE S256 + resource required)
  app.get("/authorize", (req: Request, res: Response) => {
    const issuer = issuerOf(req);
    const q = req.query as Record<string, string>;
    const client = clients.get(q.client_id);
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
    if (!isFirebaseConfigured()) {
      // STUB:FIREBASE — no Firebase configured: auto-approve a fixed user so the
      // handshake runs headlessly (dev/test). Set FIREBASE_* for real login.
      const userId = resolveBrainUserId("firebase-uid-TEST");
      const code = mintAuthCode({ ...params, userId });
      return res.redirect(302, callbackUrl(q.redirect_uri, issuer, { code }, q.state));
    }

    // Real login: stash the validated OAuth params, render the Firebase sign-in
    // page. /authorize/complete verifies the token and mints the code.
    const loginId = "login_" + rand();
    pendingLogins.set(loginId, { ...params, state: q.state, exp: Date.now() + LOGIN_TTL_MS });
    res.type("html").send(loginPageHtml({ action: "/authorize/complete", loginId, title: "Connect your brain" }));
  });

  // Completes a Firebase login: verify the ID token, resolve the brain user,
  // mint the auth code, and hand the client-callback URL back to the page.
  app.post("/authorize/complete", async (req: Request, res: Response) => {
    const issuer = issuerOf(req);
    const { login_id, id_token } = req.body ?? {};
    const login = pendingLogins.get(login_id);
    pendingLogins.delete(login_id); // single-use
    if (!login || login.exp < Date.now()) {
      res.status(400).json({ error: "invalid_request", error_description: "unknown or expired login" });
      return;
    }
    let identity;
    try {
      identity = await verifyFirebaseIdToken(id_token);
    } catch (e: any) {
      res.status(401).json({ error: "access_denied", error_description: `login failed: ${e.message}` });
      return;
    }
    const userId = resolveBrainUserId(identity.uid);
    const code = mintAuthCode({
      clientId: login.clientId, redirectUri: login.redirectUri, codeChallenge: login.codeChallenge,
      resource: login.resource, scope: login.scope, userId,
    });
    res.json({ redirect: callbackUrl(login.redirectUri, issuer, { code }, login.state) });
  });

  // Token endpoint (authorization_code + PKCE verify + audience binding)
  app.post("/token", (req: Request, res: Response) => {
    const b = req.body ?? {};
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
    });
    res.json({ access_token, token_type: "Bearer", expires_in: 3600, scope: entry.scope });
  });
}
