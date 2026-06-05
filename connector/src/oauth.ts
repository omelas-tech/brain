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
const clients = new Map<string, Client>();
const authCodes = new Map<string, AuthCode>();

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
    const redirect = (params: Record<string, string>) => {
      const u = new URL(q.redirect_uri);
      for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
      if (q.state) u.searchParams.set("state", q.state);
      u.searchParams.set("iss", issuer); // RFC 9207, even on errors
      res.redirect(302, u.toString());
    };
    if (q.response_type !== "code") return redirect({ error: "unsupported_response_type" });
    if (q.code_challenge_method !== "S256") return redirect({ error: "invalid_request", error_description: "PKCE S256 required" });
    if (!q.code_challenge) return redirect({ error: "invalid_request", error_description: "code_challenge required" });
    if (q.resource !== mcpResource(issuer)) return redirect({ error: "invalid_target", error_description: "resource must be this MCP server" });

    // STUB:FIREBASE — auto-approve a fixed user instead of a login bounce.
    const userId = resolveBrainUserId("firebase-uid-TEST");

    const code = "code_" + rand();
    authCodes.set(code, {
      clientId: q.client_id, redirectUri: q.redirect_uri, codeChallenge: q.code_challenge,
      resource: q.resource, userId, scope: q.scope || SCOPES.join(" "), exp: Date.now() + CODE_TTL_MS,
    });
    redirect({ code });
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
