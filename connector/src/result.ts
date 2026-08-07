// Tool-result construction with MCP response-cache metadata.
//
// A memory response is inherently per-user: it must NEVER be shared across
// users through a client-side cache. The MCP 2026-07-28 response-caching model
// lets a server declare that per response via `cacheScope`. We attach it as
// namespaced `_meta` (which the SDK already serializes verbatim), so it is
// forward-compatible with the final spec and harmless on clients that ignore
// it. Every tool result carrying memory content MUST go through `memoryResult`.

/** Namespaced cache-scope key (SDK-agnostic; survives serialization as `_meta`). */
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
