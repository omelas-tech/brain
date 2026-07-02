// Persistent OAuth state — the DCR client registry + refresh-token grants.
//
// Why this exists: everything else in the AS is in-memory on purpose (auth codes
// and pending logins live seconds; access tokens live an hour and a restart just
// triggers a silent refresh). But refresh grants ARE the login — if they die with
// the process, every deploy logs every user out and even invalidates claude.ai's
// registered client_id. So these two stores survive restarts on disk.
//
// Storage: one JSON file (atomic tmp+rename) under CONNECTOR_STATE_DIR. Our own
// refresh tokens are stored HASHED (SHA-256) — the client holds the only copy.
// The Firebase refresh token inside a grant is a live credential, so it is
// encrypted at rest (AES-256-GCM) with CONNECTOR_STATE_KEY (64 hex chars), or a
// key file auto-generated next to the data (0600) when the env key is unset.
// With no CONNECTOR_STATE_DIR at all, everything stays in-memory (dev/tests).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface RegisteredClient {
  redirectUris: string[];
  name?: string;
}

export interface RefreshGrant {
  familyId: string; // all rotations of one login share a family — revoked together
  clientId: string;
  userId: string;
  scope: string;
  aud: string; // RFC 8707 — refreshed access tokens keep the audience binding
  brainId?: string;
  identityNote?: string;
  fbRefreshToken?: string; // Firebase refresh token — decrypted in memory, encrypted at rest
  exp: number; // sliding window: each rotation issues a fresh full TTL
  createdAt: number;
  lastUsedAt: number;
  rotatedTo?: string; // hash of the successor token — presence means "already used"
  rotatedAt?: number; // when rotation happened — drives the burst-race grace window
  successorToken?: string; // successor kept (encrypted at rest) ONLY through the grace
  // window so a benign concurrent refresh gets the same answer, not a family kill
  revoked?: boolean;
}

const STATE_FILE = "oauth-state.json";
const KEY_FILE = "state.key";

let stateDir: string | null = null;
let stateKey: Buffer | null = null;
let loaded = false;

const clients = new Map<string, RegisteredClient>();
const grants = new Map<string, RefreshGrant>(); // key: hashToken(refresh token)

export const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("base64url");

// How long after a rotation the OLD token still answers with the SAME successor
// instead of a family kill. Real clients produce this benignly: two refreshes in
// flight at once, or a retry after the first response was lost on the network.
// Past the window, a replay is treated as theft (OAuth 2.1 reuse detection).
export const refreshGraceMs = () => Number(process.env.CONNECTOR_REFRESH_GRACE_MS ?? 60_000);

// ---- encryption at rest (Firebase refresh tokens only) ---------------------

function encryptSecret(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ct.toString("base64url")}`;
}

function decryptSecret(blob: string, key: Buffer): string {
  const [v, iv, tag, ct] = blob.split(":");
  if (v !== "v1") throw new Error("unknown secret format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf-8");
}

/** Env key if set (64 hex chars), else a key file in the state dir (created 0600). */
function resolveKey(dir: string, keyOverride?: string | null): Buffer {
  const raw = keyOverride ?? process.env.CONNECTOR_STATE_KEY;
  if (raw) {
    const b = Buffer.from(raw.trim(), "hex");
    if (b.length !== 32) throw new Error("CONNECTOR_STATE_KEY must be 64 hex chars (32 bytes)");
    return b;
  }
  const keyPath = path.join(dir, KEY_FILE);
  if (fs.existsSync(keyPath)) {
    const b = Buffer.from(fs.readFileSync(keyPath, "utf-8").trim(), "hex");
    if (b.length !== 32) throw new Error(`${keyPath} is corrupt (expected 64 hex chars)`);
    return b;
  }
  const k = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, k.toString("hex") + "\n", { mode: 0o600 });
  return k;
}

// ---- load / save ------------------------------------------------------------

/**
 * (Re)initialize the state store. Reads CONNECTOR_STATE_DIR / CONNECTOR_STATE_KEY
 * from env unless overridden; `dir: null` forces memory-only. Idempotent — calling
 * it again reloads from disk, which is exactly what a test uses to simulate a
 * process restart. Returns whether persistence is active (for the boot log).
 */
export function initOAuthState(opts?: { dir?: string | null; key?: string | null }): { persistent: boolean; dir: string | null } {
  clients.clear();
  grants.clear();
  loaded = true;
  stateDir = opts?.dir !== undefined ? opts.dir : process.env.CONNECTOR_STATE_DIR || null;
  stateKey = null;
  if (!stateDir) return { persistent: false, dir: null };

  try {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    stateKey = resolveKey(stateDir, opts?.key);
    const file = path.join(stateDir, STATE_FILE);
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
      for (const [id, c] of Object.entries(raw.clients ?? {})) clients.set(id, c as RegisteredClient);
      let dropped = 0;
      for (const [hash, g] of Object.entries<any>(raw.grants ?? {})) {
        const { fbRefreshTokenEnc, successorTokenEnc, ...rest } = g;
        const grant: RefreshGrant = rest;
        try {
          if (fbRefreshTokenEnc) grant.fbRefreshToken = decryptSecret(fbRefreshTokenEnc, stateKey);
          if (successorTokenEnc) grant.successorToken = decryptSecret(successorTokenEnc, stateKey);
        } catch {
          dropped++; // key changed — the grant can't renew identity; force re-login
          continue;
        }
        grants.set(hash, grant);
      }
      if (dropped) console.error(`[connector] dropped ${dropped} refresh grant(s) that no longer decrypt (state key changed?) — those users must reconnect`);
    }
    return { persistent: true, dir: stateDir };
  } catch (e) {
    console.error(`[connector] OAuth state persistence DISABLED (${(e as Error).message}) — sessions will not survive restarts`);
    stateDir = null;
    stateKey = null;
    return { persistent: false, dir: null };
  }
}

function ensureLoaded(): void {
  if (!loaded) initOAuthState();
}

/** Atomic write of the whole state file. Cheap at connector scale; never throws. */
function persistNow(): void {
  if (!stateDir) return;
  try {
    const out = {
      version: 1,
      clients: Object.fromEntries(clients),
      grants: Object.fromEntries(
        [...grants].map(([hash, g]) => {
          const { fbRefreshToken, successorToken, ...rest } = g;
          const enc: Record<string, string> = {};
          if (fbRefreshToken && stateKey) enc.fbRefreshTokenEnc = encryptSecret(fbRefreshToken, stateKey);
          if (successorToken && stateKey) enc.successorTokenEnc = encryptSecret(successorToken, stateKey);
          return [hash, { ...rest, ...enc }];
        }),
      ),
    };
    const file = path.join(stateDir, STATE_FILE);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(out), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error(`[connector] failed to persist OAuth state: ${(e as Error).message}`);
  }
}

// ---- client registry ---------------------------------------------------------

export function getClient(clientId: string): RegisteredClient | undefined {
  ensureLoaded();
  return clients.get(clientId);
}

export function putClient(clientId: string, client: RegisteredClient): void {
  ensureLoaded();
  clients.set(clientId, client);
  persistNow();
}

export function clientCount(): number {
  ensureLoaded();
  return clients.size;
}

// ---- refresh grants ------------------------------------------------------------

/** Mint a refresh token for a grant. Only the hash is kept. */
export function createRefreshGrant(grant: RefreshGrant): string {
  ensureLoaded();
  const token = "rt_" + crypto.randomBytes(32).toString("base64url");
  grants.set(hashToken(token), grant);
  persistNow();
  return token;
}

export function lookupGrant(token: string): { hash: string; grant: RefreshGrant } | null {
  ensureLoaded();
  const hash = hashToken(token);
  const grant = grants.get(hash);
  return grant ? { hash, grant } : null;
}

/**
 * Rotate: mint the successor token and mark the old grant as used (rotatedTo).
 * The used grant is kept until it expires — presenting it again inside the grace
 * window replays the same successor (burst race); after it, it's the OAuth 2.1
 * reuse signal that revokes the whole family. The successor's plaintext is held
 * on the old grant (encrypted at rest) only until the grace window closes.
 */
export function rotateGrant(oldHash: string, next: RefreshGrant): string {
  ensureLoaded();
  const token = "rt_" + crypto.randomBytes(32).toString("base64url");
  const newHash = hashToken(token);
  grants.set(newHash, next);
  const old = grants.get(oldHash);
  if (old) {
    grants.set(oldHash, {
      ...old,
      rotatedTo: newHash,
      rotatedAt: Date.now(),
      successorToken: token,
      fbRefreshToken: undefined,
    });
  }
  persistNow();
  return token;
}

/** Patch a grant in place (e.g. Google rotated the Firebase refresh token). */
export function updateGrant(hash: string, patch: Partial<RefreshGrant>): void {
  ensureLoaded();
  const g = grants.get(hash);
  if (!g) return;
  grants.set(hash, { ...g, ...patch });
  persistNow();
}

/** Revoke every grant in a family (token reuse, or identity-provider refusal). */
export function revokeFamily(familyId: string): number {
  ensureLoaded();
  let n = 0;
  for (const [hash, g] of grants) {
    if (g.familyId === familyId && !g.revoked) {
      grants.set(hash, { ...g, revoked: true, fbRefreshToken: undefined, successorToken: undefined });
      n++;
    }
  }
  if (n) persistNow();
  return n;
}

/**
 * Drop expired grants (revoked ones go when they expire too) and scrub successor
 * plaintext from rotated grants whose grace window has closed — past that point
 * the only legitimate holder of the successor is the client itself.
 */
export function sweepGrants(now = Date.now()): void {
  ensureLoaded();
  let n = 0;
  for (const [hash, g] of grants) {
    if (g.exp < now) {
      grants.delete(hash);
      n++;
    } else if (g.successorToken && g.rotatedAt != null && now - g.rotatedAt > refreshGraceMs()) {
      grants.set(hash, { ...g, successorToken: undefined });
      n++;
    }
  }
  if (n) persistNow();
}
