/** Plugin configuration resolution for openclaw-brain-memory. */

export type BrainPluginConfig = {
  /** Path or name of the brain binary (from the brain-memory npm package). */
  brainBin: string;
  /** Project label recorded on encoding contexts and used for recall scoring. */
  project: string;
  /** Default number of results for memory_search / session recall. */
  topRecall: number;
  /** Automatically `brain reinforce` memories returned by memory_search. */
  autoReinforce: boolean;
  /** Pass --sync to `brain memorize` (push to Brain Cloud / git after store). */
  syncOnMemorize: boolean;
};

export const DEFAULT_CONFIG: BrainPluginConfig = {
  brainBin: "brain",
  project: "openclaw",
  topRecall: 6,
  autoReinforce: true,
  syncOnMemorize: false,
};

/**
 * Merge `plugins.entries.brain-memory.config` over the defaults. Unknown or
 * mistyped values fall back to defaults — config problems must never keep the
 * Gateway from starting.
 */
export function resolveBrainConfig(pluginConfig?: Record<string, unknown>): BrainPluginConfig {
  const raw = pluginConfig ?? {};
  return {
    brainBin: asNonEmptyString(raw.brainBin) ?? DEFAULT_CONFIG.brainBin,
    project: asNonEmptyString(raw.project) ?? DEFAULT_CONFIG.project,
    topRecall: asPositiveInt(raw.topRecall) ?? DEFAULT_CONFIG.topRecall,
    autoReinforce: asBoolean(raw.autoReinforce) ?? DEFAULT_CONFIG.autoReinforce,
    syncOnMemorize: asBoolean(raw.syncOnMemorize) ?? DEFAULT_CONFIG.syncOnMemorize,
  };
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
