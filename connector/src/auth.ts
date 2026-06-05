// Auth layer for the connector (OAuth 2.1 resource server).
//
// Phase 1 scope: the *guard* + session model + RFC 9728 metadata. Token
// ISSUANCE (authorize/token/register/PKCE) is already proven in
// brain-cloud/connector-spike — port it here as the AS. `issueToken` below is
// the seam where that lands; for dogf/test it mints a session directly.

import crypto from "node:crypto";

export interface Session {
  userId: string;
  brainDir: string; // the user's brain working copy (BRAIN_DIR for the engine)
  scope: string;
  exp: number;
}

const tokens = new Map<string, Session>();
const TOKEN_TTL_MS = 3600_000;

/** Mint an access token bound to a user + their brain dir. (Stand-in for the
 *  OAuth token endpoint — see connector-spike for the full PKCE/DCR flow.) */
export function issueToken(userId: string, brainDir: string, scope = "brain.read"): string {
  const token = "at_" + crypto.randomBytes(24).toString("base64url");
  tokens.set(token, { userId, brainDir, scope, exp: Date.now() + TOKEN_TTL_MS });
  return token;
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
