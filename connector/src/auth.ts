// Resource-server side of the connector's auth (OAuth 2.1).
//
// Holds the issued-token store + the Bearer guard + RFC 9728 metadata. The
// authorization SERVER (authorize/token/register/PKCE/DCR) lives in oauth.ts and
// mints tokens into this store via `issueToken`.

import crypto from "node:crypto";

export interface Session {
  userId: string;
  brainDir: string; // the user's brain working copy (BRAIN_DIR for the engine)
  scope: string;
  aud: string; // RFC 8707 audience — the MCP resource this token is bound to
  exp: number;
  brainId?: string; // brain-cloud brain id — for sync-back after writes (Phase 2)
  idToken?: string; // Firebase ID token from login — auths the sync-back push
  identityNote?: string; // hygiene hint computed at login (e.g. wrong/empty account)
}

const tokens = new Map<string, Session>();
export const TOKEN_TTL_MS = 3600_000;

/** Mint an access token bound to a user, their brain dir, and an audience. */
export function issueToken(
  userId: string,
  brainDir: string,
  opts: { scope?: string; aud: string; brainId?: string; idToken?: string; identityNote?: string },
): string {
  const token = "at_" + crypto.randomBytes(24).toString("base64url");
  tokens.set(token, {
    userId,
    brainDir,
    scope: opts.scope ?? "brain.read",
    aud: opts.aud,
    exp: Date.now() + TOKEN_TTL_MS,
    brainId: opts.brainId,
    idToken: opts.idToken,
    identityNote: opts.identityNote,
  });
  return token;
}

/**
 * Drop expired tokens (otherwise only checked lazily on use) and report the brain
 * working copies whose session has fully ended — i.e. dirs an expired token pointed
 * at that NO surviving live token still references (a user may hold several tokens
 * or have reconnected mid-session). The caller purges those plaintext copies from
 * the host (see server.ts), bounding "session end" exposure.
 */
export function sweepExpiredTokens(now = Date.now()): string[] {
  const candidates = new Set<string>();
  for (const [k, v] of tokens) {
    if (v.exp < now) {
      candidates.add(v.brainDir);
      tokens.delete(k);
    }
  }
  const orphaned: string[] = [];
  for (const dir of candidates) {
    let stillLive = false;
    for (const v of tokens.values()) {
      if (v.brainDir === dir && v.exp >= now) { stillLive = true; break; }
    }
    if (!stillLive) orphaned.push(dir);
  }
  return orphaned;
}

/** Resolve a Bearer token to a live session, or null. */
export function authenticate(authHeader: string | undefined): Session | null {
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  const s = tokens.get(token);
  if (!s || s.exp < Date.now()) return null;
  return s;
}

/** RFC 9728 Protected Resource Metadata document. */
export function protectedResourceMetadata(issuer: string) {
  return {
    resource: `${issuer}/mcp`,
    authorization_servers: [issuer],
    scopes_supported: ["brain.read", "brain.write"],
    bearer_methods_supported: ["header"],
  };
}

/** The WWW-Authenticate value for a 401 (points clients at the PRM, RFC 9728). */
export function wwwAuthenticate(issuer: string, error?: string): string {
  const prm = `${issuer}/.well-known/oauth-protected-resource`;
  return `Bearer resource_metadata="${prm}"${error ? `, error_description="${error}"` : ""}`;
}
