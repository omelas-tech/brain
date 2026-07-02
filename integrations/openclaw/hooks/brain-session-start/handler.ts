/**
 * brain-session-start hook handler.
 *
 * On `agent:bootstrap`, runs `brain session-start --project <project>` (the
 * budget-bounded deterministic aggregator) and appends the formatted block to
 * the session's bootstrap files, giving the agent ambient awareness of the
 * user's brain without reciting memory contents.
 *
 * This handler is deliberately self-contained (node builtins + the lib/ files
 * shipped inside this hook directory) so it survives copy-installation into
 * ~/.openclaw/hooks/ without needing OpenClaw internals or npm installs.
 */

import path from "node:path";
// Byte-identical copies of the plugin's pure modules (kept in sync by the
// integration test suite).
import { runSessionStart, shouldWarnUnavailable } from "./lib/brain-exec.mjs";
import { formatSessionStartBlock } from "./lib/session-format.mjs";

// Local structural types for the OpenClaw internal hook contract
// (src/hooks/internal-hook-types.ts + internal-hooks.ts AgentBootstrapHookContext).
// Hook packs cannot import OpenClaw modules, so we mirror the shape here.
type InternalHookEvent = {
  type: string;
  action: string;
  sessionKey: string;
  context: Record<string, unknown>;
  timestamp: Date;
  messages: string[];
};

type WorkspaceBootstrapFile = {
  name: string;
  path: string;
  content?: string;
  missing: boolean;
};

const HOOK_KEY = "brain-session-start";
/** Re-run the aggregator at most every 10 minutes per session. */
const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { at: number; block: string | null }>();

function resolveHookConfig(cfg: unknown): Record<string, unknown> {
  if (!cfg || typeof cfg !== "object") return {};
  const hooks = (cfg as Record<string, any>).hooks;
  const entry = hooks?.internal?.entries?.[HOOK_KEY];
  return entry && typeof entry === "object" ? entry : {};
}

const brainSessionStartHook = async (event: InternalHookEvent): Promise<void> => {
  if (event.type !== "agent" || event.action !== "bootstrap") return;

  const context = event.context ?? {};
  const bootstrapFiles = context.bootstrapFiles;
  const workspaceDir = typeof context.workspaceDir === "string" ? context.workspaceDir : "";
  if (!Array.isArray(bootstrapFiles)) return;

  const hookConfig = resolveHookConfig(context.cfg);
  if (hookConfig.enabled === false) return;
  const project =
    typeof hookConfig.project === "string" && hookConfig.project.trim()
      ? hookConfig.project.trim()
      : "openclaw";
  const brainBin =
    typeof hookConfig.brainBin === "string" && hookConfig.brainBin.trim()
      ? hookConfig.brainBin.trim()
      : "brain";
  const maxTokens = typeof hookConfig.maxTokens === "number" ? hookConfig.maxTokens : undefined;

  const cacheKey = event.sessionKey || "default";
  const cached = cache.get(cacheKey);
  let block: string | null;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    block = cached.block;
  } else {
    const result = await runSessionStart({ project, bin: brainBin });
    if (!result.ok) {
      if (result.code === "unavailable" && shouldWarnUnavailable(brainBin)) {
        console.warn(`[brain-session-start] ${result.error} — recall injection disabled.`);
      }
      cache.set(cacheKey, { at: Date.now(), block: null });
      return;
    }
    block = formatSessionStartBlock(result.value, { project, maxTokens });
    cache.set(cacheKey, { at: Date.now(), block });
  }
  if (!block) return;

  // VERIFY: WorkspaceBootstrapFileName is a closed union of known basenames
  // (AGENTS/SOUL/TOOLS/IDENTITY/USER/HEARTBEAT/BOOTSTRAP/MEMORY .md), so the
  // synthetic entry reuses "MEMORY.md" under a virtual sub-path to avoid
  // colliding with a real workspace MEMORY.md entry.
  const virtualPath = path.join(workspaceDir || ".", ".brain-session", "MEMORY.md");
  const alreadyInjected = (bootstrapFiles as WorkspaceBootstrapFile[]).some(
    (file) => file && file.path === virtualPath,
  );
  if (alreadyInjected) return;
  (bootstrapFiles as WorkspaceBootstrapFile[]).push({
    name: "MEMORY.md",
    path: virtualPath,
    content: block,
    missing: false,
  });
};

export default brainSessionStartHook;
