/**
 * brain-exec — thin, injectable wrapper around the `brain` CLI for the
 * GitHub Copilot CLI hook pack.
 *
 * Every child-process call goes through `execFile` (argv arrays, never a
 * shell), with a hard timeout and bounded output. When the `brain` binary is
 * missing the wrapper degrades gracefully: it reports `{ ok: false, code:
 * "unavailable" }` and remembers the failure so callers can log a single
 * warning instead of spamming stderr — a hook must never break the Copilot
 * session because brain-memory is not installed.
 *
 * Dependency-free ESM JavaScript (JSDoc typed) so hook scripts run on the
 * user's existing Node and the logic is unit-testable with plain `node --test`.
 */

import { execFile as nodeExecFile } from "node:child_process";

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;

/**
 * Host agent label recorded on each memory's encoding context.
 * An explicit BRAIN_AGENT always wins; otherwise "copilot-cli".
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function detectAgent(env = process.env) {
  if (env.BRAIN_AGENT) return env.BRAIN_AGENT;
  return "copilot-cli";
}

/**
 * @typedef {Object} BrainExecResult
 * @property {boolean} ok
 * @property {unknown} [value]      Parsed JSON payload on success.
 * @property {string} [raw]         Raw stdout on success (when not JSON).
 * @property {"unavailable"|"timeout"|"exec-error"|"bad-json"} [code]
 * @property {string} [error]       Human-readable failure description.
 */

/**
 * @typedef {Object} BrainExecOptions
 * @property {string} [bin]           Path/name of the brain binary (default "brain", or BRAIN_BIN).
 * @property {number} [timeoutMs]
 * @property {string} [stdin]         Data piped to the child's stdin.
 * @property {Record<string, string|undefined>} [env]
 * @property {typeof nodeExecFile} [execFileImpl]  Injectable for tests.
 * @property {boolean} [json]         Parse stdout as JSON (default true).
 */

/** Tracks binaries already reported missing, so we warn once per process. */
const unavailableBins = new Set();

/**
 * True the first time a given binary is reported unavailable; false after.
 * Callers use this to emit exactly one warning per process.
 *
 * @param {string} bin
 * @returns {boolean}
 */
export function shouldWarnUnavailable(bin) {
  if (unavailableBins.has(bin)) return false;
  unavailableBins.add(bin);
  return true;
}

/** Test hook: reset the warn-once registry. */
export function resetUnavailableWarnings() {
  unavailableBins.clear();
}

/**
 * Run the brain CLI with an argv array. Never throws.
 *
 * @param {string[]} args
 * @param {BrainExecOptions} [options]
 * @returns {Promise<BrainExecResult>}
 */
export function runBrain(args, options = {}) {
  const bin = options.bin || (options.env || process.env).BRAIN_BIN || "brain";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const execFileImpl = options.execFileImpl || nodeExecFile;
  const parseJson = options.json !== false;
  const env = {
    ...process.env,
    ...(options.env || {}),
  };
  if (!env.BRAIN_AGENT) env.BRAIN_AGENT = detectAgent(env);

  return new Promise((resolve) => {
    let child;
    try {
      child = execFileImpl(
        bin,
        args,
        { timeout: timeoutMs, maxBuffer: DEFAULT_MAX_BUFFER, env, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
            /** @type {NodeJS.ErrnoException & {killed?: boolean}} */
            const err = /** @type {any} */ (error);
            if (err.code === "ENOENT") {
              resolve({
                ok: false,
                code: "unavailable",
                error: `brain CLI not found (looked for "${bin}"). Install with: npm install -g brain-memory`,
              });
              return;
            }
            if (err.killed || err.signal === "SIGTERM") {
              resolve({ ok: false, code: "timeout", error: `brain ${args[0]} timed out after ${timeoutMs}ms` });
              return;
            }
            const detail = String(stderr || err.message || err).trim().slice(0, 500);
            resolve({ ok: false, code: "exec-error", error: `brain ${args[0]} failed: ${detail}` });
            return;
          }
          const raw = String(stdout ?? "");
          if (!parseJson) {
            resolve({ ok: true, raw });
            return;
          }
          try {
            resolve({ ok: true, value: JSON.parse(raw), raw });
          } catch {
            resolve({
              ok: false,
              code: "bad-json",
              error: `brain ${args[0]} returned non-JSON output`,
              raw,
            });
          }
        },
      );
    } catch (err) {
      resolve({ ok: false, code: "exec-error", error: String(err).slice(0, 500) });
      return;
    }
    if (options.stdin != null && child && child.stdin) {
      child.stdin.on("error", () => {
        /* EPIPE when the binary is missing — the callback path reports it. */
      });
      child.stdin.write(options.stdin);
      child.stdin.end();
    }
  });
}

/**
 * `brain session-start --project <project>` → aggregator payload (or error).
 *
 * @param {{project: string} & BrainExecOptions} options
 * @returns {Promise<BrainExecResult>}
 */
export function runSessionStart(options) {
  return runBrain(["session-start", "--project", options.project], options);
}
