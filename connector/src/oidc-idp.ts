// The "oidc" identity provider: sign in through any OpenID Connect issuer — Google
// Workspace, Microsoft Entra, Keycloak, Okta — for a self-hosted brain-store that
// is configured to accept that issuer's ID tokens.
//
// Unlike the other providers there is no login page of ours: /authorize sends the
// browser to the issuer (authorization-code flow with PKCE), and the issuer sends it
// back to /oidc/callback. The ID token that comes out is the store credential; the
// issuer's refresh token renews it.
//
// Token verification is NOT reimplemented here. It is the store's verifier
// (store/lib/oidc.js), so the connector and the store can never disagree about
// what a valid token is.

import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface Verifier {
  verify: (token: string, expect?: { nonce?: string }) => Promise<Record<string, any>>;
  discovery: () => Promise<Record<string, any>>;
}

// Loaded on first use, not at import time: a deployment that does not use OIDC
// (the hosted service signs in with Firebase) must start even when store/ is not
// on the box.
function loadCreateVerifier(): (opts: Record<string, unknown>) => Verifier {
  return (require("../../store/lib/oidc.js") as { createVerifier: (opts: Record<string, unknown>) => Verifier }).createVerifier;
}

const env = (k: string) => (process.env[k] || "").trim();
const b64url = (b: Buffer) => b.toString("base64url");

/**
 * Usable only with an explicit store address (as for the static provider: an ID
 * token must never be sent to the hosted default by accident).
 */
export const isOidcConfigured = () =>
  env("OIDC_ISSUER") !== "" && env("OIDC_CLIENT_ID") !== "" && env("BRAIN_CLOUD_API_URL") !== "";

let cached: { key: string; verifier: Verifier } | null = null;
function verifier(): Verifier {
  const key = `${env("OIDC_ISSUER")}|${env("OIDC_CLIENT_ID")}|${env("OIDC_ALLOWED_DOMAINS")}|${env("OIDC_ALLOWED_EMAILS")}`;
  if (!cached || cached.key !== key) {
    cached = {
      key,
      verifier: loadCreateVerifier()({
        issuer: env("OIDC_ISSUER"),
        audience: env("OIDC_CLIENT_ID"),
        allowedDomains: env("OIDC_ALLOWED_DOMAINS"),
        allowedEmails: env("OIDC_ALLOWED_EMAILS"),
      }),
    };
  }
  return cached.verifier;
}

/** `rejected` = the issuer refused the credential (as opposed to being unreachable). */
export class OidcLoginError extends Error {
  rejected: boolean;
  constructor(message: string, rejected: boolean) {
    super(message);
    this.rejected = rejected;
  }
}

async function tokenRequest(params: Record<string, string>): Promise<Record<string, any>> {
  const doc = await verifier().discovery();
  const body = new URLSearchParams({ client_id: env("OIDC_CLIENT_ID"), ...params });
  if (env("OIDC_CLIENT_SECRET")) body.set("client_secret", env("OIDC_CLIENT_SECRET"));
  let res: Response;
  try {
    res = await fetch(doc.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
    });
  } catch (e) {
    throw new OidcLoginError(`issuer unreachable: ${(e as Error).message}`, false);
  }
  if (!res.ok) {
    // 4xx: the issuer looked at the credential and said no. 5xx: it is having a moment.
    throw new OidcLoginError(`issuer answered ${res.status}`, res.status >= 400 && res.status < 500);
  }
  return (await res.json()) as Record<string, any>;
}

/** Where to send the browser, and what to remember until it comes back. */
export async function startOidcLogin(ctx: { callbackUrl: string; state: string }): Promise<{ url: string; carry: Record<string, string> }> {
  const doc = await verifier().discovery();
  const codeVerifier = b64url(crypto.randomBytes(32));
  const nonce = b64url(crypto.randomBytes(16));
  const url = new URL(doc.authorization_endpoint);
  // Extra parameters first, so they can never override the ones that matter.
  for (const [k, v] of new URLSearchParams(env("OIDC_AUTH_PARAMS"))) url.searchParams.set(k, v);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env("OIDC_CLIENT_ID"));
  url.searchParams.set("redirect_uri", ctx.callbackUrl);
  url.searchParams.set("scope", env("OIDC_SCOPES") || "openid email profile offline_access");
  url.searchParams.set("state", ctx.state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", b64url(crypto.createHash("sha256").update(codeVerifier).digest()));
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), carry: { codeVerifier, nonce } };
}

/** Exchange the code, verify the ID token (signature, claims, nonce). */
export async function finishOidcLogin(ctx: {
  callbackUrl: string; code: string; carry: Record<string, string>;
}): Promise<{ subject: string; storeToken: string; renewal?: string }> {
  const tokens = await tokenRequest({
    grant_type: "authorization_code", code: ctx.code, redirect_uri: ctx.callbackUrl, code_verifier: ctx.carry.codeVerifier,
  });
  if (typeof tokens.id_token !== "string") throw new OidcLoginError("issuer returned no ID token", true);
  let claims;
  try {
    claims = await verifier().verify(tokens.id_token, { nonce: ctx.carry.nonce });
  } catch (e) {
    throw new OidcLoginError((e as Error).message, true);
  }
  return {
    // Prefixed and issuer-qualified: cannot collide with another provider's subjects.
    subject: `oidc:${claims.iss}|${claims.sub}`,
    storeToken: tokens.id_token,
    renewal: typeof tokens.refresh_token === "string" && tokens.refresh_token ? tokens.refresh_token : undefined,
  };
}

/** A fresh ID token from the issuer's refresh token, with no user present. */
export async function renewOidc(refreshToken: string): Promise<{ storeToken: string; renewal: string }> {
  const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  if (typeof tokens.id_token !== "string") {
    throw new OidcLoginError("issuer did not return an ID token on refresh", true);
  }
  try {
    await verifier().verify(tokens.id_token);
  } catch (e) {
    throw new OidcLoginError((e as Error).message, true);
  }
  return {
    storeToken: tokens.id_token,
    renewal: typeof tokens.refresh_token === "string" && tokens.refresh_token ? tokens.refresh_token : refreshToken,
  };
}
