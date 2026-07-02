/**
 * openclaw-brain-memory — Brain Memory as OpenClaw's memory slot.
 *
 * Design (matches the brain plugin's philosophy): the MODEL decides what to
 * remember; this plugin handles plumbing deterministically.
 *
 * - Recall injection is deterministic: the budget-bounded `brain
 *   session-start` payload is appended to the system prompt once per session
 *   at before_prompt_build (cache-friendly), alongside a compact instruction
 *   block ported from the brain ambient prompt.
 * - Capture is model-driven: a `brain_memorize` tool plus prompt guidance —
 *   no mechanical transcript dumping.
 * - memory_search / memory_get replace memory-core's tools (same names, same
 *   disabled/unavailable conventions) backed by `brain recall` and direct
 *   ~/.brain file reads.
 * - Pre-compaction flush: the memory capability's flushPlanResolver asks the
 *   host to run a silent brain_memorize pass before compaction.
 * - Session boundaries (/new, /reset) append an entry to ~/.brain/contexts.json
 *   (last 20 kept), porting the brain session-end contract.
 *
 * Known upstream bug: tools registered via the api.registerTool() factory
 * sometimes fail to appear in the agent runtime tool list
 * (openclaw/openclaw#50328). We therefore (a) declare all tools in
 * openclaw.plugin.json `contracts.tools` for lazy discovery, and (b) keep the
 * session-start payload + guidance on the hook path (before_prompt_build +
 * memory prompt section), which does not depend on tool registration.
 *
 * Everything degrades gracefully: if the `brain` CLI is missing we log one
 * warning and no-op — the Gateway must never crash because of this plugin.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  MemoryFlushPlan,
  OpenClawPluginApi,
  PluginHookBeforePromptBuildResult,
} from "openclaw/plugin-sdk/plugin-entry";
import { resolveBrainConfig } from "./src/config.js";
import { SessionTracker } from "./src/session-tracker.js";
import {
  createBrainMemorizeTool,
  createMemoryGetTool,
  createMemorySearchTool,
} from "./src/tools.js";
import { runSessionStart, shouldWarnUnavailable } from "./src/lib/brain-exec.mjs";
import { appendContextEntryToFile, buildContextEntry } from "./src/lib/contexts.mjs";
import { formatSessionStartBlock } from "./src/lib/session-format.mjs";
import {
  buildBrainPromptSection,
  buildFlushPrompt,
  buildFlushSystemPrompt,
} from "./src/lib/prompt-guidance.mjs";

const FLUSH_SOFT_THRESHOLD_TOKENS = 4_000;
const FLUSH_FORCE_TRANSCRIPT_BYTES = 2 * 1024 * 1024;
// Mirrors openclaw's DEFAULT_AGENT_COMPACTION_RESERVE_TOKENS_FLOOR (src/agents/agent-settings.ts).
const FLUSH_RESERVE_TOKENS_FLOOR = 20_000;

export default definePluginEntry({
  id: "brain-memory",
  name: "Memory (Brain)",
  description:
    "Neuroscience-inspired persistent memory backed by the brain-memory CLI (~/.brain): deterministic recall, spreading activation, spaced reinforcement, and model-driven capture.",
  register(api: OpenClawPluginApi) {
    const config = resolveBrainConfig(api.pluginConfig);
    const tracker = new SessionTracker();
    const deps = { config, tracker, logger: api.logger };

    // ------------------------------------------------------------- memory slot
    api.registerMemoryCapability({
      promptBuilder: buildBrainPromptSection,
      flushPlanResolver: (): MemoryFlushPlan => ({
        softThresholdTokens: FLUSH_SOFT_THRESHOLD_TOKENS,
        forceFlushTranscriptBytes: FLUSH_FORCE_TRANSCRIPT_BYTES,
        reserveTokensFloor: FLUSH_RESERVE_TOKENS_FLOOR,
        prompt: buildFlushPrompt(),
        systemPrompt: buildFlushSystemPrompt(),
        // VERIFY: relativePath is the workspace-relative flush target used by
        // memory-core's file-append flush. Brain stores via the brain_memorize
        // tool instead; this conventional dated path is provided as a benign
        // fallback in case the host requires the file to exist.
        relativePath: `memory/${new Date().toISOString().slice(0, 10)}.md`,
      }),
    });

    // ------------------------------------------------------------------ tools
    api.registerTool((ctx) => createMemorySearchTool(deps, ctx), { names: ["memory_search"] });
    api.registerTool(() => createMemoryGetTool(deps), { names: ["memory_get"] });
    api.registerTool((ctx) => createBrainMemorizeTool(deps, ctx), { names: ["brain_memorize"] });

    // -------------------------------------------- session-start recall inject
    // One deterministic aggregator call per session; the formatted block is
    // cached and re-appended each turn so provider prompt caching stays warm.
    const sessionBlocks = new Map<string, Promise<string | null>>();
    const MAX_CACHED_SESSIONS = 200;

    const loadSessionBlock = (sessionKey: string): Promise<string | null> => {
      let pending = sessionBlocks.get(sessionKey);
      if (!pending) {
        pending = (async () => {
          const result = await runSessionStart({ project: config.project, bin: config.brainBin });
          if (!result.ok) {
            if (result.code === "unavailable" && shouldWarnUnavailable(config.brainBin)) {
              api.logger.warn(
                `[brain-memory] ${result.error} — session recall injection disabled.`,
              );
            } else if (result.code !== "unavailable") {
              api.logger.debug?.(`[brain-memory] session-start failed: ${result.error}`);
            }
            return null;
          }
          return formatSessionStartBlock(result.value, { project: config.project });
        })();
        sessionBlocks.set(sessionKey, pending);
        if (sessionBlocks.size > MAX_CACHED_SESSIONS) {
          const oldest = sessionBlocks.keys().next().value;
          if (oldest !== undefined) sessionBlocks.delete(oldest);
        }
      }
      return pending;
    };

    api.on("before_prompt_build", async (_event, ctx): Promise<PluginHookBeforePromptBuildResult | void> => {
      try {
        const sessionKey = ctx.sessionKey || ctx.sessionId || "default";
        const block = await loadSessionBlock(sessionKey);
        if (!block) return;
        // appendSystemContext (not systemPrompt) so we never clobber other
        // plugins' contributions, and the block rides prompt caching.
        return { appendSystemContext: block };
      } catch (err) {
        api.logger.warn(`[brain-memory] prompt injection failed: ${String(err).slice(0, 200)}`);
        return;
      }
    });

    // ------------------------------------------- session boundaries → contexts
    api.registerHook(
      ["command:new", "command:reset"],
      (event) => {
        try {
          const sessionKey = event.sessionKey;
          sessionBlocks.delete(sessionKey || "default");
          const drained = tracker.drain(sessionKey);
          const entry = buildContextEntry({
            sessionKey,
            started: drained.started,
            ended:
              event.timestamp instanceof Date
                ? event.timestamp.toISOString()
                : new Date().toISOString(),
            project: config.project,
            topics: drained.topics,
            taskType: "conversation",
            memoriesCreated: drained.created,
            memoriesRecalled: drained.recalled,
          });
          const result = appendContextEntryToFile(entry);
          if (!result.ok && !result.skipped) {
            api.logger.debug?.(`[brain-memory] contexts.json append failed: ${result.error}`);
          }
        } catch (err) {
          api.logger.debug?.(`[brain-memory] session boundary handling failed: ${String(err)}`);
        }
      },
      { name: "brain-contexts", description: "Append brain session context on /new and /reset" },
    );
  },
});
