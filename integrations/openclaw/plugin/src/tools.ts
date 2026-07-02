/**
 * Agent tool factories for the brain-memory plugin.
 *
 * memory_search / memory_get keep the names (and result conventions) of
 * OpenClaw's built-in memory-core plugin so agents and prompt guidance keep
 * working when the memory slot switches to brain-memory. brain_memorize is
 * the model-driven capture tool — the model decides WHAT to remember, the
 * brain CLI handles all file plumbing.
 *
 * All child-process work goes through the injectable brain-exec wrapper
 * (execFile, 15s timeout, no shell). When the brain CLI is missing, tools
 * return `{disabled: true, unavailable: true, error}` payloads — the same
 * convention memory-core uses — and the plugin logs a single warning.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentToolResult,
  AnyAgentTool,
  OpenClawPluginToolContext,
  PluginLogger,
} from "openclaw/plugin-sdk/plugin-entry";
import type { BrainPluginConfig } from "./config.js";
import type { SessionTracker } from "./session-tracker.js";
import {
  runMemorize,
  runRecall,
  runReinforce,
  shouldWarnUnavailable,
} from "./lib/brain-exec.mjs";
import { resolveBrainDir } from "./lib/contexts.mjs";
import { MEMORIZE_TOOL_SCHEMA, validateMemorizePayload } from "./lib/memorize-schema.mjs";
import { mapRecallResults } from "./lib/recall-map.mjs";

/** Local equivalent of the SDK's jsonResult helper (same output shape). */
function jsonResult(payload: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload };
}

function unavailableResult(error: string | undefined): AgentToolResult<unknown> {
  return jsonResult({
    disabled: true,
    unavailable: true,
    error: error ?? "brain memory unavailable",
  });
}

type ToolDeps = {
  config: BrainPluginConfig;
  tracker: SessionTracker;
  logger: PluginLogger;
};

function warnUnavailableOnce(deps: ToolDeps, error: string | undefined): void {
  if (shouldWarnUnavailable(deps.config.brainBin)) {
    deps.logger.warn(
      `[brain-memory] ${error ?? "brain CLI unavailable"} — memory tools are disabled until it is installed.`,
    );
  }
}

const MEMORY_SEARCH_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string" },
    maxResults: { type: "integer", minimum: 1 },
    minScore: { type: "number" },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

const MEMORY_GET_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string" },
    from: { type: "integer", minimum: 1 },
    lines: { type: "integer", minimum: 1 },
  },
  required: ["path"],
  additionalProperties: false,
} as const;

function paramsRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

// --------------------------------------------------------------------------
// memory_search — backed by the deterministic `brain recall` engine
// --------------------------------------------------------------------------

export function createMemorySearchTool(
  deps: ToolDeps,
  ctx: OpenClawPluginToolContext,
): AnyAgentTool {
  return {
    label: "Memory Search (Brain)",
    name: "memory_search",
    description:
      "Mandatory recall step: search the user's persistent brain (~/.brain) before answering questions about prior conversations, decisions, dates, people, preferences, routines, or todos. Deterministic scoring (TF-IDF relevance + decayed strength + spreading activation + context match + salience). Returned memories are reinforced automatically. If the response has disabled=true, memory retrieval is unavailable — surface that to the user.",
    parameters: MEMORY_SEARCH_SCHEMA as unknown as Record<string, unknown>,
    execute: async (_toolCallId, params) => {
      const record = paramsRecord(params);
      const query = typeof record.query === "string" ? record.query.trim() : "";
      if (!query) return jsonResult({ results: [], error: "query is required" });
      const maxResults =
        typeof record.maxResults === "number" && record.maxResults >= 1
          ? Math.floor(record.maxResults)
          : deps.config.topRecall;
      const minScore = typeof record.minScore === "number" ? record.minScore : undefined;

      const recall = await runRecall({
        query,
        project: deps.config.project,
        top: maxResults,
        bin: deps.config.brainBin,
      });
      if (!recall.ok) {
        if (recall.code === "unavailable") {
          warnUnavailableOnce(deps, recall.error);
          return unavailableResult(recall.error);
        }
        return jsonResult({ results: [], error: recall.error });
      }

      const mapped = mapRecallResults(recall.value, { minScore, maxResults });
      deps.tracker.noteRecall(ctx.sessionKey, mapped.ids, query);

      let reinforced = false;
      if (deps.config.autoReinforce && mapped.ids.length > 0) {
        // Spaced reinforcement + Hebbian co-retrieval; never blocks a search.
        const result = await runReinforce({ ids: mapped.ids, bin: deps.config.brainBin });
        reinforced = result.ok;
        if (!result.ok && result.code !== "unavailable") {
          deps.logger.debug?.(`[brain-memory] reinforce failed: ${result.error}`);
        }
      }

      return jsonResult({
        results: mapped.results,
        reinforced,
        ...(mapped.lowConfidenceIds.length > 0
          ? {
              note: `${mapped.lowConfidenceIds.length} result(s) have low confidence (<0.5) — verify before relying on them.`,
            }
          : {}),
      });
    },
  };
}

// --------------------------------------------------------------------------
// memory_get — safe excerpt read from ~/.brain/<path>
// --------------------------------------------------------------------------

const DEFAULT_GET_LINES = 200;

export function createMemoryGetTool(deps: ToolDeps): AnyAgentTool {
  return {
    label: "Memory Get (Brain)",
    name: "memory_get",
    description:
      "Read a memory file from the user's brain by the relative path returned by memory_search (e.g. personal/routines/morning.md). Returns a bounded excerpt with truncation info; pass from/lines for more.",
    parameters: MEMORY_GET_SCHEMA as unknown as Record<string, unknown>,
    execute: async (_toolCallId, params) => {
      const record = paramsRecord(params);
      const relPath = typeof record.path === "string" ? record.path.trim() : "";
      if (!relPath) return jsonResult({ error: "path is required" });

      const brainDir = resolveBrainDir();
      const resolved = path.resolve(brainDir, relPath);
      // Path-traversal guard: the resolved file must stay inside ~/.brain.
      if (resolved !== brainDir && !resolved.startsWith(brainDir + path.sep)) {
        return jsonResult({ error: "path must be relative to the brain directory" });
      }

      let content: string;
      try {
        content = await fs.readFile(resolved, "utf8");
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          return jsonResult({
            error: `memory not found: ${relPath}. It may be archived — try memory_search again or check _archived/.`,
          });
        }
        return jsonResult({ error: `failed to read memory: ${String(err).slice(0, 200)}` });
      }

      const allLines = content.split("\n");
      const from = typeof record.from === "number" && record.from >= 1 ? Math.floor(record.from) : 1;
      const lineCount =
        typeof record.lines === "number" && record.lines >= 1
          ? Math.floor(record.lines)
          : DEFAULT_GET_LINES;
      const slice = allLines.slice(from - 1, from - 1 + lineCount);
      const truncated = from - 1 + lineCount < allLines.length;
      return jsonResult({
        path: relPath,
        content: slice.join("\n"),
        fromLine: from,
        lineCount: slice.length,
        totalLines: allLines.length,
        truncated,
        ...(truncated ? { next: { from: from + slice.length } } : {}),
      });
    },
  };
}

// --------------------------------------------------------------------------
// brain_memorize — model-driven capture via `brain memorize` (stdin JSON)
// --------------------------------------------------------------------------

export function createBrainMemorizeTool(
  deps: ToolDeps,
  ctx: OpenClawPluginToolContext,
): AnyAgentTool {
  return {
    label: "Brain Memorize",
    name: "brain_memorize",
    description:
      "Store one or more classified memories in the user's persistent brain. Use when durable decisions, learnings, insights, experiences, goals, relationships, or preferences emerge — across all life domains (personal/, family/, social/, professional/). You decide what to remember and how to classify it; the brain CLI handles IDs, strength/decay, associations, and indexing. Do not store secrets or trivia.",
    parameters: MEMORIZE_TOOL_SCHEMA as unknown as Record<string, unknown>,
    execute: async (_toolCallId, params) => {
      const validation = validateMemorizePayload(paramsRecord(params));
      if (!validation.ok) {
        return jsonResult({ stored: [], errors: validation.errors });
      }

      // Fill encoding context defaults so recall's context matching works
      // even when the model omits it.
      const memories = (validation.payload.memories as Record<string, unknown>[]).map((memory) => {
        const encoding =
          memory.encoding_context && typeof memory.encoding_context === "object"
            ? (memory.encoding_context as Record<string, unknown>)
            : {};
        return {
          ...memory,
          encoding_context: {
            project: encoding.project ?? deps.config.project,
            topics: Array.isArray(encoding.topics) ? encoding.topics : [],
            task_type: encoding.task_type ?? "conversation",
          },
          source: memory.source ?? `OpenClaw session ${ctx.sessionKey ?? ""}`.trim(),
        };
      });

      const result = await runMemorize({
        payload: { memories },
        sync: deps.config.syncOnMemorize,
        bin: deps.config.brainBin,
      });
      if (!result.ok) {
        if (result.code === "unavailable") {
          warnUnavailableOnce(deps, result.error);
          return unavailableResult(result.error);
        }
        return jsonResult({ stored: [], error: result.error });
      }

      const storedIds = extractStoredIds(result.value);
      deps.tracker.noteCreated(ctx.sessionKey, storedIds);
      return jsonResult(
        result.value && typeof result.value === "object"
          ? result.value
          : { stored: storedIds, raw: result.raw },
      );
    },
  };
}

/** Pull memory ids out of the `brain memorize` CLI response, defensively. */
function extractStoredIds(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const candidates = [record.stored, record.memories, record.results];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((item) =>
          item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string"
            ? ((item as Record<string, unknown>).id as string)
            : undefined,
        )
        .filter((id): id is string => Boolean(id));
    }
  }
  return [];
}
