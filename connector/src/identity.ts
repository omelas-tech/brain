// Identity providers — who is logging in, and what the connector presents to the
// store on their behalf.
//
// The OAuth server in oauth.ts does not care how a user proves who they are. It
// needs three things from a provider: a login page, a way to verify what that
// page posts back, and a way to renew the store credential later with no user
// present. Everything provider-specific lives behind this interface.
//
//   firebase  Google sign-in through Firebase. The store credential is the
//             Firebase ID token, renewed from the Firebase refresh token. This is
//             what the hosted service uses, and the default when FIREBASE_* is set.
//   static    For a self-hosted brain-store. The user pastes the token their
//             store's operator issued; that token IS the store credential.
//   oidc      For a self-hosted brain-store that accepts an organisation's OpenID
//             Connect issuer. The browser is sent to the issuer and back; the ID
//             token is the store credential, renewed from the issuer's refresh token.
//
// Select with CONNECTOR_IDP. Unset, the provider is inferred: firebase when it is
// configured, otherwise none (and oauth.ts fails closed).

import {
  isFirebaseConfigured,
  verifyFirebaseIdToken,
  refreshFirebaseIdToken,
  FirebaseRefreshError,
  loginPageHtml,
} from "./firebase.js";
import { staticLoginPageHtml, verifyStoreToken, isStaticConfigured } from "./static-idp.js";
import { isOidcConfigured, startOidcLogin, finishOidcLogin, renewOidc, OidcLoginError } from "./oidc-idp.js";

export interface LoginPageOpts {
  action: string;
  loginId: string;
  title: string;
  clientName?: string;
  scope?: string;
  origin?: string;
}

export interface VerifiedLogin {
  /** Stable, unique id for this person at the provider. Hashed into the brain user id. */
  subject: string;
  /** Bearer token the connector presents to the store for this user. */
  storeToken: string;
  /** Long-lived secret kept (encrypted) with the refresh grant, used by renew(). */
  renewal?: string;
}

/**
 * A renewal failed. `permanent` means the credential itself was refused (revoked,
 * rotated, account disabled): the session is over. Anything else is an outage and
 * must not cost the user their login.
 */
export class RenewError extends Error {
  permanent: boolean;
  constructor(message: string, permanent: boolean) {
    super(message);
    this.permanent = permanent;
  }
}

export interface IdentityProvider {
  readonly name: "firebase" | "static" | "oidc";
  /**
   * How many times one /authorize may be completed unsuccessfully before the user
   * has to start over. Firebase is 1: a failed verification there means a forged
   * or broken token, never a typo.
   */
  readonly maxAttempts: number;
  loginPage(opts: LoginPageOpts): string;
  /** Verify what the login page posted. Throws when the login is not valid. */
  verifyLogin(body: Record<string, unknown>): Promise<VerifiedLogin>;
  /** Obtain a fresh store credential with no user present. Throws RenewError. */
  renew(renewal: string): Promise<{ storeToken: string; renewal: string }>;
  /**
   * Redirect-style providers only. Instead of rendering loginPage, /authorize sends
   * the browser to the URL startRedirect returns; the provider sends it back to
   * `callbackUrl`, and finishRedirect turns that request into a verified login.
   * `carry` is kept server-side between the two and never reaches the browser.
   */
  startRedirect?(ctx: { callbackUrl: string; state: string }): Promise<{ url: string; carry: Record<string, string> }>;
  finishRedirect?(ctx: { callbackUrl: string; code: string; carry: Record<string, string> }): Promise<VerifiedLogin>;
}

const firebaseProvider: IdentityProvider = {
  name: "firebase",
  maxAttempts: 1,
  loginPage: (opts) => loginPageHtml(opts),
  async verifyLogin(body) {
    const idToken = typeof body.id_token === "string" ? body.id_token : "";
    const identity = await verifyFirebaseIdToken(idToken);
    const refresh = typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : undefined;
    return { subject: identity.uid, storeToken: idToken, renewal: refresh };
  },
  async renew(renewal) {
    try {
      const renewed = await refreshFirebaseIdToken(renewal);
      return { storeToken: renewed.idToken, renewal: renewed.refreshToken };
    } catch (e) {
      if (e instanceof FirebaseRefreshError) throw new RenewError(e.message, e.permanent);
      // Anything else ended the session before this seam existed; keep it so.
      throw new RenewError((e as Error).message, true);
    }
  },
};

const staticProvider: IdentityProvider = {
  name: "static",
  maxAttempts: 3, // a pasted token can be mistyped or truncated
  loginPage: (opts) => staticLoginPageHtml(opts),
  async verifyLogin(body) {
    const token = typeof body.store_token === "string" ? body.store_token.trim() : "";
    const user = await verifyStoreToken(token);
    // Prefixed so a static subject can never collide with a Firebase uid.
    return { subject: `static:${user.id}`, storeToken: token, renewal: token };
  },
  async renew(renewal) {
    // Nothing to mint: the token does not expire. But ask the store whether it is
    // still good, so rotating or removing a user at the store ends their sessions.
    try {
      await verifyStoreToken(renewal);
    } catch (e) {
      throw new RenewError((e as Error).message, (e as { rejected?: boolean }).rejected === true);
    }
    return { storeToken: renewal, renewal };
  },
};

const oidcProvider: IdentityProvider = {
  name: "oidc",
  maxAttempts: 1,
  loginPage: () => { throw new Error("the oidc provider has no login page of its own"); },
  async verifyLogin() { throw new Error("the oidc provider completes at /oidc/callback"); },
  startRedirect: (ctx) => startOidcLogin(ctx),
  finishRedirect: (ctx) => finishOidcLogin(ctx),
  async renew(renewal) {
    try {
      return await renewOidc(renewal);
    } catch (e) {
      throw new RenewError((e as Error).message, e instanceof OidcLoginError && e.rejected);
    }
  },
};

/** The provider this connector logs people in with, or null when there is none. */
export function activeProvider(): IdentityProvider | null {
  const chosen = (process.env.CONNECTOR_IDP || "").toLowerCase();
  if (chosen === "static") return isStaticConfigured() ? staticProvider : null;
  if (chosen === "oidc") return isOidcConfigured() ? oidcProvider : null;
  if (chosen === "firebase") return isFirebaseConfigured() ? firebaseProvider : null;
  if (chosen) return null; // an unknown name must not silently fall back to something else
  return isFirebaseConfigured() ? firebaseProvider : null;
}

/** Why there is no provider, for the boot guard's message. */
export function providerProblem(): string {
  const chosen = (process.env.CONNECTOR_IDP || "").toLowerCase();
  if (chosen === "static") {
    return "CONNECTOR_IDP=static needs BRAIN_CLOUD_API_URL set to your store's address";
  }
  if (chosen === "oidc") {
    return "CONNECTOR_IDP=oidc needs OIDC_ISSUER, OIDC_CLIENT_ID and BRAIN_CLOUD_API_URL (your store's address)";
  }
  if (chosen && chosen !== "firebase") return `unknown CONNECTOR_IDP "${chosen}" (use "firebase", "static" or "oidc")`;
  return "Firebase is not configured (set FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID), " +
    "and CONNECTOR_IDP=static is not selected";
}
