/**
 * Local type shim for the OpenClaw plugin SDK.
 *
 * These declarations are transcribed from the openclaw/openclaw sources
 * (fetched 2026-07-02: src/plugin-sdk/plugin-entry.ts, src/plugins/types.ts,
 * src/plugins/tool-types.ts, src/plugins/memory-state.ts,
 * src/plugins/hook-types.ts + hook-before-agent-start.types.ts,
 * src/hooks/internal-hook-types.ts, src/agents/tools/common.ts) so that
 * `npm run typecheck` passes without installing the `openclaw` package.
 *
 * When building against a real OpenClaw checkout, delete this file and add
 * `openclaw` as a devDependency — the runtime import specifier
 * ("openclaw/plugin-sdk/plugin-entry") is identical.
 *
 * Only the surface this plugin uses is declared; optional members of the real
 * API that we do not touch are represented loosely or omitted.
 */

declare module "openclaw/plugin-sdk/plugin-entry" {
  // ---------------------------------------------------------------- logging
  export type PluginLogger = {
    debug?: (message: string) => void;
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };

  // ------------------------------------------------------------------ tools
  export type AgentToolResultContent = { type: "text"; text: string } | { type: string; [key: string]: unknown };

  export type AgentToolResult<TDetails = unknown> = {
    content: AgentToolResultContent[];
    details: TDetails;
  };

  export type AgentToolUpdateCallback = (update: unknown) => void;

  /** Erased agent tool contract (src/agents/tools/common.ts AnyAgentTool). */
  export type AnyAgentTool = {
    label?: string;
    name: string;
    description: string;
    /** JSON-Schema-compatible parameter schema (TypeBox TSchema upstream). */
    parameters?: Record<string, unknown>;
    execute: (
      toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ) => Promise<AgentToolResult<unknown>>;
  };

  /** src/plugins/tool-types.ts OpenClawPluginToolContext (subset). */
  export type OpenClawPluginToolContext = {
    config?: OpenClawConfig;
    runtimeConfig?: OpenClawConfig;
    getRuntimeConfig?: () => OpenClawConfig | undefined;
    workspaceDir?: string;
    agentDir?: string;
    agentId?: string;
    sessionKey?: string;
    sessionId?: string;
    messageChannel?: string;
    sandboxed?: boolean;
    oneShotCliRun?: boolean;
  };

  export type OpenClawPluginToolFactory = (
    ctx: OpenClawPluginToolContext,
  ) => AnyAgentTool | AnyAgentTool[] | null | undefined;

  export type OpenClawPluginToolOptions = {
    name?: string;
    names?: string[];
    optional?: boolean;
  };

  // ----------------------------------------------------------------- config
  /** Loose stand-in for src/config/types.openclaw.ts OpenClawConfig. */
  export type OpenClawConfig = {
    hooks?: {
      internal?: {
        enabled?: boolean;
        entries?: Record<string, Record<string, unknown> & { enabled?: boolean }>;
      };
    };
    plugins?: {
      slots?: { memory?: string; contextEngine?: string };
      entries?: Record<string, { enabled?: boolean; config?: Record<string, unknown> }>;
    };
    [key: string]: unknown;
  };

  export type PluginConfigValidation = { ok: true; value?: unknown } | { ok: false; errors: string[] };

  export type OpenClawPluginConfigSchema = {
    safeParse?: (value: unknown) => {
      success: boolean;
      data?: unknown;
      error?: { issues?: Array<{ path: Array<string | number>; message: string }> };
    };
    parse?: (value: unknown) => unknown;
    validate?: (value: unknown) => PluginConfigValidation;
    uiHints?: Record<string, unknown>;
    jsonSchema?: Record<string, unknown>;
  };

  // ------------------------------------------------- memory capability slot
  /** src/plugins/memory-state.ts MemoryPromptSectionBuilder. */
  export type MemoryPromptSectionBuilder = (params: {
    availableTools: Set<string>;
    citationsMode?: string;
  }) => string[];

  /** src/plugins/memory-state.ts MemoryFlushPlan. */
  export type MemoryFlushPlan = {
    softThresholdTokens: number;
    forceFlushTranscriptBytes: number;
    reserveTokensFloor: number;
    model?: string;
    prompt: string;
    systemPrompt: string;
    relativePath: string;
  };

  export type MemoryFlushPlanResolver = (params: {
    cfg?: OpenClawConfig;
    nowMs?: number;
  }) => MemoryFlushPlan | null;

  /**
   * src/plugins/memory-state.ts MemoryPluginCapability. `runtime` and
   * `publicArtifacts` are declared loosely — this plugin does not register a
   * MemorySearchManager-backed runtime (the brain CLI owns retrieval).
   */
  export type MemoryPluginCapability = {
    promptBuilder?: MemoryPromptSectionBuilder;
    flushPlanResolver?: MemoryFlushPlanResolver;
    runtime?: unknown;
    publicArtifacts?: unknown;
  };

  // ---------------------------------------------------- internal hook packs
  export type InternalHookEventType = "command" | "session" | "agent" | "gateway" | "message";

  /** src/hooks/internal-hook-types.ts InternalHookEvent. */
  export interface InternalHookEvent {
    type: InternalHookEventType;
    action: string;
    sessionKey: string;
    context: Record<string, unknown>;
    timestamp: Date;
    /** Hooks can push strings here to reply on replyable surfaces. */
    messages: string[];
  }

  export type InternalHookHandler = (event: InternalHookEvent) => Promise<void> | void;

  export type OpenClawPluginHookOptions = {
    entry?: unknown;
    name?: string;
    description?: string;
    register?: boolean;
  };

  // -------------------------------------------------------- lifecycle hooks
  /** src/plugins/hook-types.ts PluginHookAgentContext (subset). */
  export type PluginHookAgentContext = {
    runId?: string;
    agentId?: string;
    sessionKey?: string;
    sessionId?: string;
    workspaceDir?: string;
    messageProvider?: string;
    channel?: string;
    senderId?: string;
    contextTokenBudget?: number;
  };

  export type PluginHookBeforePromptBuildEvent = {
    prompt: string;
    messages: unknown[];
  };

  export type PluginHookBeforePromptBuildResult = {
    systemPrompt?: string;
    prependContext?: string;
    appendContext?: string;
    prependSystemContext?: string;
    appendSystemContext?: string;
  };

  export type PluginHookBeforeCompactionEvent = {
    messageCount: number;
    compactingCount?: number;
    tokenCount?: number;
    messages?: unknown[];
    sessionFile?: string;
  };

  export type PluginHookSessionContext = {
    agentId?: string;
    sessionId: string;
    sessionKey?: string;
  };

  export type PluginHookSessionStartEvent = {
    sessionId: string;
    sessionKey?: string;
    resumedFrom?: string;
  };

  export type PluginHookSessionEndEvent = {
    sessionId: string;
    sessionKey?: string;
    messageCount: number;
    durationMs?: number;
    reason?: string;
    sessionFile?: string;
  };

  export type PluginHookGatewayContext = {
    port?: number;
    config?: OpenClawConfig;
    workspaceDir?: string;
  };

  export type PluginHookGatewayStartEvent = { port: number };
  export type PluginHookGatewayStopEvent = { reason?: string };

  /** Typed subset of src/plugins/hook-types.ts PluginHookHandlerMap. */
  export type PluginHookHandlerMap = {
    before_prompt_build: (
      event: PluginHookBeforePromptBuildEvent,
      ctx: PluginHookAgentContext,
    ) => Promise<PluginHookBeforePromptBuildResult | void> | PluginHookBeforePromptBuildResult | void;
    before_compaction: (
      event: PluginHookBeforeCompactionEvent,
      ctx: PluginHookAgentContext,
    ) => Promise<void> | void;
    after_compaction: (event: unknown, ctx: PluginHookAgentContext) => Promise<void> | void;
    session_start: (
      event: PluginHookSessionStartEvent,
      ctx: PluginHookSessionContext,
    ) => Promise<void> | void;
    session_end: (
      event: PluginHookSessionEndEvent,
      ctx: PluginHookSessionContext,
    ) => Promise<void> | void;
    gateway_start: (
      event: PluginHookGatewayStartEvent,
      ctx: PluginHookGatewayContext,
    ) => Promise<void> | void;
    gateway_stop: (
      event: PluginHookGatewayStopEvent,
      ctx: PluginHookGatewayContext,
    ) => Promise<void> | void;
  };

  export type PluginHookName = keyof PluginHookHandlerMap;

  // ------------------------------------------------------------- plugin API
  /** src/plugins/types.ts OpenClawPluginApi (subset used by this plugin). */
  export type OpenClawPluginApi = {
    id: string;
    name: string;
    version?: string;
    description?: string;
    source: string;
    config: OpenClawConfig;
    pluginConfig?: Record<string, unknown>;
    logger: PluginLogger;
    registerTool: (
      tool: AnyAgentTool | OpenClawPluginToolFactory,
      opts?: OpenClawPluginToolOptions,
    ) => void;
    registerHook: (
      events: string | string[],
      handler: InternalHookHandler,
      opts?: OpenClawPluginHookOptions,
    ) => void;
    /** Register the active memory capability for this memory plugin (exclusive slot). */
    registerMemoryCapability: (capability: MemoryPluginCapability) => void;
    resolvePath: (input: string) => string;
    on: <K extends PluginHookName>(
      hookName: K,
      handler: PluginHookHandlerMap[K],
      opts?: { priority?: number; timeoutMs?: number },
    ) => void;
  };

  // ------------------------------------------------------------------ entry
  export type OpenClawPluginDefinitionKind = "memory" | (string & {});

  export type DefinePluginEntryOptions = {
    id: string;
    name: string;
    description: string;
    /** @deprecated declare `kind` in openclaw.plugin.json; kept as fallback. */
    kind?: OpenClawPluginDefinitionKind;
    configSchema?: OpenClawPluginConfigSchema | (() => OpenClawPluginConfigSchema);
    register: (api: OpenClawPluginApi) => void;
  };

  export type DefinedPluginEntry = {
    id: string;
    name: string;
    description: string;
    configSchema: OpenClawPluginConfigSchema;
    register: (api: OpenClawPluginApi) => void;
  };

  export function definePluginEntry(options: DefinePluginEntryOptions): DefinedPluginEntry;
}
