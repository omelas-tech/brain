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

const RECALL_BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "recall.js");
const cloudApi = () => (process.env.BRAIN_CLOUD_API_URL || "https://api.brainmemory.ai").replace(/\/$/, "");

export interface EnsureOpts {
  userId: string;
  brainDir: string;
  idToken?: string; // Firebase ID token — required for the brain-cloud provider
  refresh?: boolean; // force a fresh pull (e.g. at login) even if cached
}

function provider(opts: EnsureOpts): "brain-cloud" | "local" | "none" {
  if (process.env.CONNECTOR_STORE) return process.env.CONNECTOR_STORE as any;
  if (process.env.DEV_LOCAL_BRAIN) return "local";
  if (opts.idToken) return "brain-cloud";
  return "none";
}

export async function ensureUserBrain(opts: EnsureOpts): Promise<{ source: string; memoryCount: number; brainId?: string }> {
  const { brainDir } = opts;
  const kind = provider(opts);
  const hasBrain = () => fs.existsSync(path.join(brainDir, "index.json"));
  let source: string = kind;
  let brainId: string | undefined;

  try {
    if (kind === "local") {
      ensureLocalLink(brainDir, process.env.DEV_LOCAL_BRAIN!);
    } else if (kind === "brain-cloud" && opts.idToken && (opts.refresh || !hasBrain())) {
      brainId = await pullFromBrainCloud(brainDir, opts.idToken);
    }
  } catch (e) {
    source = `${kind} (failed: ${(e as Error).message})`;
  }

  if (!hasBrain()) {
    initEmptyBrain(brainDir);
    if (source === "none" || source === "brain-cloud") source += " → empty-init";
  }
  return { source, memoryCount: readMemoryCount(brainDir), brainId };
}

/**
 * Sync a user's brain back to brain-cloud after a write (Phase 2). Repacks the
 * working copy and PUTs it to `/api/brains/{brainId}/sync` with the user's
 * Firebase token — mirrors the CLI's `brain cloud push`. No-op (returns pushed:
 * false) for the local/none providers or when we lack a brainId/token; the local
 * write already persisted in those cases.
 */
export async function syncBack(opts: { brainDir: string; brainId?: string; idToken?: string }): Promise<{ pushed: boolean; error?: string }> {
  if (!opts.brainId || !opts.idToken) return { pushed: false };
  const tmp = path.join(os.tmpdir(), `brain-push-${opts.brainId}-${Date.now()}.tar.gz`);
  try {
    // Pack the brain (exclude any local-only sync/cloud state, like the CLI does).
    execFileSync("tar", ["czf", tmp, "--exclude=./.sync", "--exclude=./.cloud", "-C", opts.brainDir, "."]);
    const form = new FormData();
    form.append("brain", new Blob([fs.readFileSync(tmp)], { type: "application/gzip" }), "brain.tar.gz");
    const res = await fetch(`${cloudApi()}/api/brains/${opts.brainId}/sync`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${opts.idToken}` },
      body: form,
    });
    if (!res.ok) return { pushed: false, error: `sync upload ${res.status}` };
    return { pushed: true };
  } catch (e) {
    return { pushed: false, error: (e as Error).message };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function ensureLocalLink(brainDir: string, src: string) {
  if (fs.existsSync(path.join(brainDir, "index.json"))) return; // already present/linked
  fs.mkdirSync(path.dirname(brainDir), { recursive: true });
  if (fs.existsSync(brainDir)) fs.rmSync(brainDir, { recursive: true, force: true });
  fs.symlinkSync(path.resolve(src.replace(/^~(?=\/|$)/, os.homedir())), brainDir);
}

async function pullFromBrainCloud(brainDir: string, idToken: string): Promise<string> {
  const headers = { Authorization: `Bearer ${idToken}` };
  const listRes = await fetch(`${cloudApi()}/api/brains`, { headers });
  if (!listRes.ok) throw new Error(`brains list ${listRes.status}`);
  const brains = (await listRes.json()) as Array<{ id: string }>;
  if (!Array.isArray(brains) || brains.length === 0) throw new Error("no brain in cloud");
  const brainId = brains[0].id;

  const dl = await fetch(`${cloudApi()}/api/brains/${brainId}/sync`, { headers });
  if (!dl.ok) throw new Error(`sync download ${dl.status}`);
  const tmp = path.join(os.tmpdir(), `brain-pull-${brainId}-${Date.now()}.tar.gz`);
  fs.writeFileSync(tmp, Buffer.from(await dl.arrayBuffer()));
  fs.mkdirSync(brainDir, { recursive: true });
  execFileSync("tar", ["xzf", tmp, "-C", brainDir]);
  fs.rmSync(tmp, { force: true });
  return brainId;
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
