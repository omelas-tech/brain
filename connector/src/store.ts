// Per-user brain store — resolves & populates a user's brain working copy.
//
// This is the real STUB:STORE. A hosted connector can't read the user's laptop,
// so it pulls their brain from their canonical store into `brainDir`, then the
// engine recalls over it. Providers (selected by CONNECTOR_STORE, else inferred):
//   • brain-cloud  — pull the user's {brainID}.tar.gz via their Firebase ID token
//                    (brain-cloud's middleware accepts Firebase tokens directly).
//   • local        — DEV: symlink brainDir → $DEV_LOCAL_BRAIN (your live ~/.brain).
//   • none         — assume brainDir is already provisioned (tests).
// Whatever happens, we never leave an unreadable brain: empty-init as a fallback.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as tar from "tar";

const RECALL_BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "recall.js");
const cloudApi = () => (process.env.BRAIN_CLOUD_API_URL || "https://api.brainmemory.ai").replace(/\/$/, "");

export interface EnsureOpts {
  userId: string;
  brainDir: string;
  idToken?: string; // Firebase ID token — required for the brain-cloud provider
  refresh?: boolean; // force a fresh pull (e.g. at login) even if cached
  ttlMs?: number; // if set, re-pull from brain-cloud when the cached copy is older
                  // than this — but only when the cloud checksum actually changed,
                  // and never over an unsynced local write (see pullState/dirty).
}

// Per-brainDir freshness state for the TTL re-pull (sync-back freshness).
// `checksum` is the canonical brain's brain-cloud checksum as of our last pull/push;
// `dirty` means a local write hasn't synced back yet, so a re-pull MUST NOT run or it
// would overwrite that write. This keeps the TTL feature "freshness, not correctness".
interface PullState { at: number; checksum: string | null; dirty: boolean }
const pullState = new Map<string, PullState>();

/** Mark a brain as having an unsynced local write (a failed sync-back). */
function markDirty(brainDir: string): void {
  const s = pullState.get(brainDir) ?? { at: 0, checksum: null, dirty: false };
  s.dirty = true;
  pullState.set(brainDir, s);
}

/** Mark a brain as in sync with the cloud at `checksum` (fresh pull or successful push). */
function markSynced(brainDir: string, checksum: string | null, now = Date.now()): void {
  pullState.set(brainDir, { at: now, checksum, dirty: false });
}

// ---- Working-copy lifecycle / idle purge ---------------------------------
//
// A hosted connector keeps each connected user's brain as a PLAINTEXT working copy
// on the host (re-pulled from brain-cloud). Left forever, a live-host compromise
// would expose the cleartext memories of every user who ever connected. We bound
// that exposure: track per-brainDir activity and reap copies that have been idle
// past a TTL (and on session end — see auth.sweepExpiredTokens + server.ts). A
// returning user is re-provisioned transparently by ensureUserBrain (a missing
// brain forces a fresh pull), so purging is safe — it only costs a re-pull.
const lastActivity = new Map<string, number>();

/** Record that a brain working copy was just used (recall/write/login). */
export function recordBrainActivity(brainDir: string, now = Date.now()): void {
  lastActivity.set(brainDir, now);
}

/** Drop all in-memory state we hold for a brainDir (freshness + activity). */
function clearBrainState(brainDir: string): void {
  pullState.delete(brainDir);
  lastActivity.delete(brainDir);
}

/**
 * Remove a user's plaintext working copy from the host and forget our state for it.
 * Symlink-safe: the `local` dev provider symlinks brainDir → the user's real
 * ~/.brain, so we unlink the LINK only and never touch its target. Best-effort:
 * never throws (a background reaper must not crash the server), but logs an
 * unexpected failure since a copy that won't delete is a security concern.
 */
export function purgeBrain(brainDir: string): boolean {
  let removed = false;
  try {
    const st = fs.lstatSync(brainDir);
    if (st.isSymbolicLink()) fs.unlinkSync(brainDir); // remove the dev link, not its target
    else fs.rmSync(brainDir, { recursive: true, force: true });
    removed = true;
  } catch (e: any) {
    if (e?.code !== "ENOENT") {
      console.error(`[connector] failed to purge working copy ${brainDir}: ${e?.message ?? e}`);
    }
  }
  clearBrainState(brainDir);
  // Drop the now-empty per-user parent (<base>/<userId>); harmless if non-empty/gone.
  try { fs.rmdirSync(path.dirname(brainDir)); } catch { /* non-empty or already gone */ }
  return removed;
}

/**
 * Purge every working copy idle longer than `idleMs`. `keepAlive(brainDir)` may
 * veto a purge (e.g. a still-live session). Returns the dirs actually removed.
 */
export function purgeIdleBrains(opts: {
  idleMs: number;
  now?: number;
  keepAlive?: (brainDir: string) => boolean;
}): string[] {
  const now = opts.now ?? Date.now();
  const purged: string[] = [];
  // Snapshot first — purgeBrain mutates lastActivity as we go.
  for (const [brainDir, at] of [...lastActivity]) {
    if (now - at < opts.idleMs) continue;
    if (opts.keepAlive?.(brainDir)) continue;
    if (purgeBrain(brainDir)) purged.push(brainDir);
  }
  return purged;
}

/**
 * Start the background idle reaper. Returns the timer (unref'd, so it never holds
 * the process open) or null when disabled (idleMs <= 0).
 */
export function startBrainReaper(opts: {
  idleMs: number;
  intervalMs?: number;
  keepAlive?: (brainDir: string) => boolean;
}): ReturnType<typeof setInterval> | null {
  if (!opts.idleMs || opts.idleMs <= 0) return null;
  const intervalMs = opts.intervalMs && opts.intervalMs > 0 ? opts.intervalMs : 60_000;
  const timer = setInterval(() => {
    try {
      const purged = purgeIdleBrains({ idleMs: opts.idleMs, keepAlive: opts.keepAlive });
      if (purged.length) {
        console.log(`[connector] reaped ${purged.length} idle brain working ${purged.length === 1 ? "copy" : "copies"}`);
      }
    } catch (e) {
      console.error("[connector] brain reaper error:", (e as Error).message);
    }
  }, intervalMs);
  timer.unref();
  return timer;
}

// One brain ↔ one Google account. The connector serves the brain of whichever
// Firebase (Google) identity signs in, so a hygiene signal tells the user when the
// signed-in account doesn't map to the brain they expect:
//   • no-cloud-brain  — this account has no brain in Brain Cloud (a brand-new user,
//                       OR — more importantly — they signed in with the WRONG Google
//                       account and would otherwise silently start a phantom brain).
//   • multiple-brains — a pro account holds several brains; we serve the canonical
//                       (oldest) one. Letting the user choose is account-linking,
//                       deferred (account-linking is future work).
//   • ok              — exactly one brain; unambiguous.
export type IdentityStatus = "ok" | "no-cloud-brain" | "multiple-brains";
export interface IdentityInfo {
  status: IdentityStatus;
  brainCount: number;
  note?: string; // user-facing one-liner, surfaced by the connector's tools
}

/** Shape of a brain as listed by brain-cloud's `GET /api/brains`. */
interface CloudBrain {
  id: string;
  created_at?: string;
  checksum?: string | null;
  last_synced_at?: string | null;
}

/**
 * The canonical brain for an account = the OLDEST. brain-cloud already lists
 * `ORDER BY created_at`, but we sort defensively so a given account always maps to
 * the SAME brain regardless of API ordering (id breaks ties). This is the
 * "one-canonical-account" rule; account-linking (choosing among several) is future.
 */
function canonicalBrain(brains: CloudBrain[]): CloudBrain {
  return [...brains].sort((a, b) =>
    (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id),
  )[0];
}

/** Map a cloud brain count to the user-facing identity-hygiene signal. */
function describeIdentity(brainCount: number): IdentityInfo {
  if (brainCount === 0) {
    return {
      status: "no-cloud-brain",
      brainCount,
      note:
        "This Google account has no brain in Brain Cloud yet. If your memories live " +
        "under a different Google account, disconnect and reconnect with that one — " +
        "otherwise new memories will start a fresh brain under this account.",
    };
  }
  if (brainCount > 1) {
    return {
      status: "multiple-brains",
      brainCount,
      note:
        `This account has ${brainCount} brains in Brain Cloud; the connector serves ` +
        "your original (oldest) one. Choosing among multiple brains isn't supported yet.",
    };
  }
  return { status: "ok", brainCount };
}

function provider(opts: EnsureOpts): "brain-cloud" | "local" | "none" {
  if (process.env.CONNECTOR_STORE) return process.env.CONNECTOR_STORE as any;
  if (process.env.DEV_LOCAL_BRAIN) return "local";
  if (opts.idToken) return "brain-cloud";
  return "none";
}

export async function ensureUserBrain(opts: EnsureOpts): Promise<{ source: string; memoryCount: number; brainId?: string; identity?: IdentityInfo }> {
  const { brainDir } = opts;
  recordBrainActivity(brainDir); // touch so the idle reaper keeps an in-use copy
  const kind = provider(opts);
  const hasBrain = () => fs.existsSync(path.join(brainDir, "index.json"));
  let source: string = kind;
  let brainId: string | undefined;
  let identity: IdentityInfo | undefined;

  try {
    if (kind === "local") {
      ensureLocalLink(brainDir, process.env.DEV_LOCAL_BRAIN!);
    } else if (kind === "brain-cloud" && opts.idToken) {
      const st = pullState.get(brainDir);
      const have = hasBrain();
      const forced = opts.refresh || !have; // login, or no brain yet → must pull
      const stale = !forced && opts.ttlMs != null && st != null && Date.now() - st.at > opts.ttlMs;
      // Correctness guard: a TTL re-pull must never overwrite an unsynced local write.
      // If the last sync-back failed (dirty), keep serving the local copy and skip the
      // re-pull. A forced pull (login / missing brain) is exempt — there's nothing to lose.
      const blockedByDirty = stale && st?.dirty === true;
      if ((forced || stale) && !blockedByDirty) {
        // On a stale re-pull, pass the last-known checksum so the pull skips the
        // download when the cloud brain is unchanged (cheap: just the list call).
        const skipIfChecksum = stale ? st?.checksum ?? null : undefined;
        const pulled = await pullFromBrainCloud(brainDir, opts.idToken, skipIfChecksum);
        brainId = pulled.brainId ?? undefined;
        identity = describeIdentity(pulled.brainCount);
        markSynced(brainDir, pulled.checksum);
      }
    }
  } catch (e) {
    source = `${kind} (failed: ${(e as Error).message})`;
  }

  if (!hasBrain()) {
    initEmptyBrain(brainDir);
    if (source === "none" || source === "brain-cloud") source += " → empty-init";
  }
  return { source, memoryCount: readMemoryCount(brainDir), brainId, identity };
}

/**
 * Sync a user's brain back to brain-cloud after a write (Phase 2). Repacks the
 * working copy and PUTs it to `/api/brains/{brainId}/sync` with the user's
 * Firebase token — mirrors the CLI's `brain cloud push`. No-op (returns pushed:
 * false) for the local/none providers or when we lack a brainId/token; the local
 * write already persisted in those cases.
 */
export async function syncBack(opts: { brainDir: string; brainId?: string; idToken?: string }): Promise<{ pushed: boolean; error?: string }> {
  recordBrainActivity(opts.brainDir); // a write is activity — keep the copy alive
  if (!opts.brainId || !opts.idToken) return { pushed: false };
  // Pack into a private random temp dir (not a predictable /tmp name — defeats a
  // pre-planted-symlink swap on a shared host).
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brain-push-"));
  const tmp = path.join(work, "brain.tar.gz");
  try {
    // Pack the brain (exclude any local-only sync/cloud state, like the CLI does).
    await tar.c(
      { gzip: true, file: tmp, cwd: opts.brainDir, portable: true, filter: notLocalState },
      ["."],
    );
    const form = new FormData();
    form.append("brain", new Blob([fs.readFileSync(tmp)], { type: "application/gzip" }), "brain.tar.gz");
    const res = await fetch(`${cloudApi()}/api/brains/${opts.brainId}/sync`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${opts.idToken}` },
      body: form,
    });
    if (!res.ok) {
      // The write is in the local working copy but not the cloud — mark dirty so a
      // TTL re-pull won't clobber it before the next successful push / login.
      markDirty(opts.brainDir);
      return { pushed: false, error: `sync upload ${res.status}` };
    }
    // The working copy now matches the cloud; record the new checksum so a TTL
    // re-pull right after a write sees "unchanged" and skips the download.
    let checksum: string | null = null;
    try { checksum = ((await res.json()) as { checksum?: string }).checksum ?? null; } catch { /* body optional */ }
    markSynced(opts.brainDir, checksum);
    return { pushed: true };
  } catch (e) {
    markDirty(opts.brainDir);
    return { pushed: false, error: (e as Error).message };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** tar create filter: drop local-only sync/cloud state from the pushed bundle. */
function notLocalState(p: string): boolean {
  const top = p.replace(/^\.\//, "").split("/")[0];
  return top !== ".sync" && top !== ".cloud";
}

/**
 * Extract a brain bundle SAFELY. The bundle is user-supplied — it round-trips
 * through brain-cloud as an opaque blob — so a malicious archive could try to
 * escape `dest` via absolute paths, `..` traversal, or symlink members whose
 * target points outside the tree (the connector runs co-located with brain-cloud,
 * so an escape = cross-user tampering or reading the cloud's secrets). Defense in
 * depth:
 *   • node-tar sanitizes paths (strips leading "/", refuses ".." segments) and
 *     refuses to write THROUGH a symlink (post-CVE-2021-32803/4 hardening);
 *   • we additionally DROP every entry that isn't a plain file or directory —
 *     a brain is only Markdown + JSON, so symlinks/hardlinks/devices are never
 *     legitimate and dropping them removes the symlink-traversal class entirely;
 *   • archived mode bits are ignored, so no setuid/setgid is ever restored.
 */
export async function extractBrainTar(file: string, dest: string): Promise<void> {
  await tar.x({
    file,
    cwd: dest,
    preservePaths: false, // sanitize: no absolute paths, no ".."
    noChmod: true,        // ignore archived permission bits (drops setuid/setgid)
    filter: (_p, entry) => "type" in entry && (entry.type === "File" || entry.type === "Directory"),
  });
}

function ensureLocalLink(brainDir: string, src: string) {
  if (fs.existsSync(path.join(brainDir, "index.json"))) return; // already present/linked
  fs.mkdirSync(path.dirname(brainDir), { recursive: true });
  if (fs.existsSync(brainDir)) fs.rmSync(brainDir, { recursive: true, force: true });
  fs.symlinkSync(path.resolve(src.replace(/^~(?=\/|$)/, os.homedir())), brainDir);
}

/**
 * Pull the account's canonical brain into `brainDir`. Returns the brain id plus
 * the total brain count and the canonical brain's checksum (the count drives the
 * identity-hygiene signal; the checksum drives cheap freshness checks). An account
 * with NO brain is a normal state (new user, or wrong account signed in) — we
 * return `{ brainId: null, brainCount: 0 }` rather than throwing, so the caller can
 * empty-init and tell the user, instead of treating it as a hard failure.
 *
 * If `skipIfChecksum` is provided and matches the canonical brain's current cloud
 * checksum, the (potentially large) download is skipped — the local copy is already
 * up to date. This is what makes the TTL re-pull cheap: the common case is one list
 * call and no download.
 */
async function pullFromBrainCloud(
  brainDir: string,
  idToken: string,
  skipIfChecksum?: string | null,
): Promise<{ brainId: string | null; brainCount: number; checksum: string | null; downloaded: boolean }> {
  const headers = { Authorization: `Bearer ${idToken}` };
  const listRes = await fetch(`${cloudApi()}/api/brains`, { headers });
  if (!listRes.ok) throw new Error(`brains list ${listRes.status}`);
  const raw = await listRes.json();
  const brains = (Array.isArray(raw) ? raw : []) as CloudBrain[];
  if (brains.length === 0) return { brainId: null, brainCount: 0, checksum: null, downloaded: false };
  const canonical = canonicalBrain(brains);
  const brainId = canonical.id;
  const checksum = canonical.checksum ?? null;

  // Unchanged since our last pull/push → nothing to download (cheap freshness check).
  if (skipIfChecksum != null && checksum != null && skipIfChecksum === checksum) {
    return { brainId, brainCount: brains.length, checksum, downloaded: false };
  }

  const dl = await fetch(`${cloudApi()}/api/brains/${brainId}/sync`, { headers });
  if (!dl.ok) throw new Error(`sync download ${dl.status}`);
  // Stage the download in a private random temp dir, then extract through the
  // hardened extractor (see extractBrainTar) into the user's brain dir.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brain-pull-"));
  const tmp = path.join(work, "brain.tar.gz");
  try {
    fs.writeFileSync(tmp, Buffer.from(await dl.arrayBuffer()));
    fs.mkdirSync(brainDir, { recursive: true });
    await extractBrainTar(tmp, brainDir);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return { brainId, brainCount: brains.length, checksum, downloaded: true };
}

function initEmptyBrain(brainDir: string) {
  const now = new Date().toISOString();
  fs.mkdirSync(brainDir, { recursive: true });
  for (const c of ["professional", "personal", "social", "family", "_consolidated"]) {
    fs.mkdirSync(path.join(brainDir, c), { recursive: true });
    fs.writeFileSync(path.join(brainDir, c, "_meta.json"), JSON.stringify({ category: c, created: now, memory_count: 0, subcategories: [] }));
  }
  fs.mkdirSync(path.join(brainDir, "_archived"), { recursive: true });
  fs.writeFileSync(path.join(brainDir, "index.json"), JSON.stringify({
    version: 2, created: now, last_updated: now, memory_count: 0, memories: {},
    config: { max_depth: 6, consolidation_threshold: 0.3, association_config: { spreading_activation_depth: 2, spreading_activation_decay: 0.5 } },
  }));
  fs.writeFileSync(path.join(brainDir, "associations.json"), '{"version":1,"edges":{}}');
  fs.writeFileSync(path.join(brainDir, "contexts.json"), '{"version":1,"sessions":[]}');
  fs.writeFileSync(path.join(brainDir, "review-queue.json"), '{"version":1,"items":[]}');
  fs.writeFileSync(path.join(brainDir, "_archived", "index.json"), '{"version":1,"archived_count":0,"memories":{}}');
  // Build a valid (empty) search index via the real engine so recall never errors.
  try { execFileSync(process.execPath, [RECALL_BIN, "--reindex"], { env: { ...process.env, BRAIN_DIR: brainDir } }); } catch { /* best-effort */ }
}

function readMemoryCount(brainDir: string): number {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(brainDir, "index.json"), "utf-8"));
    return idx.memory_count ?? Object.keys(idx.memories ?? {}).length;
  } catch { return 0; }
}
