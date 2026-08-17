// Tool-result construction with a defensive per-user cache marker.
//
// A memory response is inherently per-user: it must NEVER be shared across
// users through a client-side or intermediary cache. Every tool result carrying
// memory content MUST go through `memoryResult`.
//
// Standards note (verified against the final 2026-07-28 spec, SEP-2549): the
// spec's `cacheScope`/`ttlMs` live as TOP-LEVEL fields on `CacheableResult` —
// the results of tools/list, prompts/list, resources/list, resources/read, and
// resources/templates/list. `tools/call` results are NOT cacheable results and
// carry no cacheScope at all, so what we stamp below is a namespaced `_meta`
// hint, not a spec field. It is deliberate defense-in-depth against an
// intermediary that caches tool output heuristically — keep it — but do not
// describe it as spec conformance. The genuine spec obligation is on
// tools/list; see docs/mcp-2026-07-28-conformance.md for why that is blocked.

/** Namespaced cache-scope hint (SDK-agnostic; survives serialization as `_meta`). */
export const CACHE_SCOPE_KEY = "modelcontextprotocol.io/cacheScope";

export interface ToolResult {
  // Index signature matches the SDK's CallToolResult so these objects are
  // assignable to a tool handler's return type.
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * A tool result that must never be cached across users. Stamps
 * `_meta.cacheScope = "private"` on every memory-bearing response.
 */
export function memoryResult(
  text: string,
  structuredContent?: Record<string, unknown>,
  extraMeta?: Record<string, unknown>,
): ToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structuredContent ? { structuredContent } : {}),
    _meta: { [CACHE_SCOPE_KEY]: "private", ...extraMeta },
  };
}

/** True iff a result declares private cache scope (used by conformance tests). */
export function isPrivateScoped(result: { _meta?: Record<string, unknown> }): boolean {
  return result?._meta?.[CACHE_SCOPE_KEY] === "private";
}
