/**
 * Brain Memory plugin for Kilo (v7+, OpenCode-based runtime).
 *
 * Drop this single file into a Kilo plugin directory and it auto-registers:
 *   - project:  .kilo/plugin/brain-memory.js
 *   - global:   ~/.config/kilo/plugin/brain-memory.js
 *
 * What it does:
 *   - `chat.message`  — on the first message of each session, runs the
 *     budget-bounded `brain session-start` aggregator and appends the
 *     rendered context block (pinned facts, relevant memories, skills index)
 *     to the user message parts. One injection per session; subagent
 *     sessions are skipped.
 *   - `event`         — on `session.idle` / `session.deleted`, upserts one
 *     session-boundary entry per session into `~/.brain/contexts.json`
 *     (newest 20 kept), feeding context-dependent recall in future sessions.
 *   - `shell.env`     — sets BRAIN_AGENT=kilo for every shell command the
 *     agent runs, so `brain` CLI calls made by commands/skills record their
 *     host agent without needing env prefixes.
 *
 * Design constraints:
 *   - Single file, dependency-free, node: builtins only (runs under Kilo's
 *     Bun runtime and under Node for tests).
 *   - Child processes via execFile argv arrays only — never a shell string.
 *   - Fail-soft everywhere: a missing `brain` binary logs one warning and
 *     every failure path is swallowed. Brain must never break a session.
 *   - The module's ONLY export is the documented Kilo plugin descriptor
 *     `export default { id, server }` (PluginModule). No named function
 *     exports — loaders that iterate function exports must find nothing else.
 *   - Test seams are passed through the documented plugin options channel:
 *     `"plugin": [["./brain-memory.js", { ...options }]]` — tests inject
 *     execFileImpl / fsImpl / homedir / env / now / warn the same way.
 *
 * // VERIFY: the synthetic text part appended in `chat.message` mirrors the
 * // OpenCode Part shape ({id, sessionID, messageID, type: "text", text,
 * // synthetic: true}). The hooks contract documents that `output.parts` is
 * // mutable, but the minimum accepted part shape is not spelled out —
 * // validated against @opencode-ai/plugin types (Hooks["chat.message"]).
 */

import { execFile as nodeExecFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;
const DEFAULT_MAX_INJECTION_TOKENS = 1200;
const MAX_CONTEXT_ENTRIES = 20;

/* ------------------------------------------------------------------ *
 * small utilities
 * ------------------------------------------------------------------ */

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

function resolveBrainDir(env, homedir) {
  const raw = env.BRAIN_DIR && env.BRAIN_DIR.trim();
  if (raw) {
    const expanded = raw === "~" || raw.startsWith("~/") ? path.join(homedir, raw.slice(1)) : raw;
    return path.resolve(expanded);
  }
  return path.join(homedir, ".brain");
}

function projectFromInput(input, fallbackCwd) {
  const record = isRecord(input) ? input : {};
  const cwd =
    (typeof record.worktree === "string" && record.worktree.trim() && record.worktree) ||
    (typeof record.directory === "string" && record.directory.trim() && record.directory) ||
    fallbackCwd;
  const base = path.basename(String(cwd || "").replace(/[\\/]+$/, ""));
  return base || "unknown";
}

/* ------------------------------------------------------------------ *
 * brain CLI wrapper (argv arrays, hard timeout, never throws)
 * ------------------------------------------------------------------ */

function runBrain(args, { bin, env, execFileImpl, timeoutMs }) {
  return new Promise((resolve) => {
    try {
      execFileImpl(
        bin,
        args,
        {
          timeout: timeoutMs,
          maxBuffer: DEFAULT_MAX_BUFFER,
          env: { ...process.env, ...env, BRAIN_AGENT: env.BRAIN_AGENT || "kilo" },
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error) {
            if (error.code === "ENOENT") {
              resolve({
                ok: false,
                code: "unavailable",
                error: `brain CLI not found (looked for "${bin}"). Install with: npm install -g brain-memory`,
              });
              return;
            }
            if (error.killed || error.signal === "SIGTERM") {
              resolve({ ok: false, code: "timeout", error: `brain ${args[0]} timed out after ${timeoutMs}ms` });
              return;
            }
            const detail = String(stderr || error.message || error).trim().slice(0, 500);
            resolve({ ok: false, code: "exec-error", error: `brain ${args[0]} failed: ${detail}` });
            return;
          }
          try {
            resolve({ ok: true, value: JSON.parse(String(stdout ?? "")) });
          } catch {
            resolve({ ok: false, code: "bad-json", error: `brain ${args[0]} returned non-JSON output` });
          }
        },
      );
    } catch (err) {
      resolve({ ok: false, code: "exec-error", error: String(err).slice(0, 500) });
    }
  });
}

/* ------------------------------------------------------------------ *
 * session-start payload → markdown block (budget-bounded)
 * ------------------------------------------------------------------ */

function resolveInjectionBudget(payload) {
  const budget = isRecord(payload?.budget) ? payload.budget : {};
  for (const candidate of [budget.max_injection_tokens, budget.working_memory_tokens, budget.max_tokens]) {
    if (typeof candidate === "number" && candidate > 0) return candidate;
  }
  return DEFAULT_MAX_INJECTION_TOKENS;
}

function formatSessionStartBlock(rawPayload, { project } = {}) {
  if (!isRecord(rawPayload)) return null;
  const payload = rawPayload;
  const memoryCount = typeof payload.memory_count === "number" ? payload.memory_count : 0;
  const pinned = asArray(payload.pinned);
  const skills = asArray(payload.skills_index);
  const recall = asArray(payload.context_recall);
  if (memoryCount === 0 && pinned.length === 0 && recall.length === 0 && skills.length === 0) {
    return null;
  }

  const maxTokens = resolveInjectionBudget(payload);
  const projectLabel = project ? ` — project: ${project}` : "";
  const chunks = [];

  chunks.push({
    priority: 0,
    lines: [
      "## Brain memory — session context" + projectLabel,
      `Brain active: ${memoryCount} memories, ${recall.length} relevant to this context. ` +
        "Internalize the facts below silently — do not recite them to the user.",
      "",
    ],
  });

  if (pinned.length > 0) {
    const lines = ["### Pinned (always apply)"];
    for (const pin of pinned) {
      if (!isRecord(pin)) continue;
      const title = String(pin.title || pin.id || "pinned memory");
      const content = typeof pin.content === "string" ? pin.content.trim() : "";
      lines.push(content ? `- **${title}**: ${content}` : `- **${title}**`);
    }
    lines.push("");
    chunks.push({ priority: 1, lines, listStart: 1 });
  }

  if (recall.length > 0) {
    const lines = ["### Relevant memories (read the file at ~/.brain/<path> when needed)"];
    for (const mem of recall) {
      if (!isRecord(mem)) continue;
      const title = String(mem.title || mem.id || "memory");
      const type = mem.type ? String(mem.type) : "memory";
      const score = typeof mem.score === "number" ? mem.score.toFixed(2) : undefined;
      const memPath = mem.path ? String(mem.path) : undefined;
      lines.push(`- ${title} (${type}${score ? `, score ${score}` : ""})${memPath ? ` — ${memPath}` : ""}`);
    }
    lines.push("");
    chunks.push({ priority: 2, lines, listStart: 1 });
  }

  if (skills.length > 0) {
    const lines = ["### Procedural skills on file (recall the skill before matching tasks)"];
    for (const skill of skills) {
      if (!isRecord(skill)) continue;
      const name = String(skill.name || "skill");
      const description = skill.description ? String(skill.description) : "";
      lines.push(description ? `- ${name} — ${description}` : `- ${name}`);
    }
    lines.push("");
    chunks.push({ priority: 3, lines, listStart: 1 });
  }

  const alerts = [];
  if (typeof payload.due_for_review === "number" && payload.due_for_review > 0) {
    alerts.push(`- ${payload.due_for_review} memories due for review (reinforced during brain sleep).`);
  }
  const lowConfidence = asArray(payload.low_confidence_alerts);
  if (lowConfidence.length > 0) {
    alerts.push(
      `- ${lowConfidence.length} frequently-used low-confidence memories — verify before relying on them.`,
    );
  }
  if (alerts.length > 0) {
    chunks.push({ priority: 4, lines: ["### Alerts", ...alerts, ""] });
  }

  const assemble = () => chunks.map((chunk) => chunk.lines.join("\n")).join("\n").trimEnd();
  let text = assemble();
  if (estimateTokens(text) > maxTokens) {
    const trimmable = [...chunks]
      .filter((chunk) => chunk.listStart !== undefined)
      .sort((a, b) => b.priority - a.priority);
    for (const chunk of trimmable) {
      while (estimateTokens(assemble()) > maxTokens && chunk.lines.length > (chunk.listStart ?? 1) + 1) {
        chunk.lines.splice(chunk.lines.length - 2, 1);
      }
      if (estimateTokens(assemble()) <= maxTokens) break;
    }
    text = assemble();
    const maxChars = maxTokens * 4;
    if (text.length > maxChars) text = text.slice(0, maxChars);
  }
  return text;
}

/* ------------------------------------------------------------------ *
 * contexts.json upsert (one entry per session, newest 20 kept)
 * ------------------------------------------------------------------ */

function upsertContextsContent(existingContent, entry, max = MAX_CONTEXT_ENTRIES) {
  let parsed;
  try {
    parsed = existingContent ? JSON.parse(existingContent) : [];
  } catch {
    parsed = [];
  }
  let wrapped = false;
  let sessions;
  if (Array.isArray(parsed)) {
    sessions = parsed;
  } else if (isRecord(parsed) && Array.isArray(parsed.sessions)) {
    wrapped = true;
    sessions = parsed.sessions;
  } else {
    sessions = [];
  }
  const index = sessions.findIndex((item) => isRecord(item) && item.session_id === entry.session_id);
  if (index >= 0) {
    sessions[index] = entry;
  } else {
    sessions.push(entry);
  }
  if (sessions.length > max) sessions = sessions.slice(sessions.length - max);
  const output = wrapped ? { ...parsed, sessions } : sessions;
  return JSON.stringify(output, null, 2) + "\n";
}

/* ------------------------------------------------------------------ *
 * plugin server
 * ------------------------------------------------------------------ */

/**
 * @param {object} input   Kilo PluginInput ({project, client, $, directory, worktree, ...}).
 * @param {object} [options] Plugin options from kilo.jsonc; also the test seam
 *   (execFileImpl, fsImpl, homedir, env, now, warn, timeoutMs, project).
 */
const server = async (input = {}, options = {}) => {
  const execFileImpl = options.execFileImpl || nodeExecFile;
  const fsImpl = options.fsImpl || fs;
  const homedir = options.homedir || os.homedir();
  const env = options.env || process.env;
  const warn = options.warn || ((message) => console.error(message));
  const now = options.now || (() => new Date());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const bin = options.bin || env.BRAIN_BIN || "brain";
  const project = options.project || projectFromInput(input, process.cwd());
  const agentLabel = env.BRAIN_AGENT || "kilo";

  const brainDir = resolveBrainDir(env, homedir);
  /** Sessions already injected (or excluded, e.g. subagents). */
  const injected = new Set();
  /** sessionID → {session_id, started} so upserts keep a stable identity. */
  const tracked = new Map();
  let warnedUnavailable = false;

  const hasBrainIndex = () => {
    try {
      return fsImpl.existsSync(path.join(brainDir, "index.json"));
    } catch {
      return false;
    }
  };

  const buildSessionStartBlock = async () => {
    if (!hasBrainIndex()) return null;
    const result = await runBrain(["session-start", "--project", project], {
      bin,
      env,
      execFileImpl,
      timeoutMs,
    });
    if (!result.ok) {
      if (result.code === "unavailable") {
        if (!warnedUnavailable) {
          warnedUnavailable = true;
          warn(`brain-memory: ${result.error}`);
        }
      } else {
        warn(`brain-memory: session-start skipped (${result.code}): ${result.error}`);
      }
      return null;
    }
    return formatSessionStartBlock(result.value, { project });
  };

  const saveSessionBoundary = (sessionID) => {
    try {
      if (!fsImpl.existsSync(brainDir)) return;
      const ended = now().toISOString();
      let identity = tracked.get(sessionID);
      if (!identity) {
        identity = {
          session_id: `${ended.replace(/[-:.TZ]/g, "").slice(0, 14)}-${String(sessionID).replace(/[^\w.-]+/g, "_")}`,
          started: ended,
        };
        tracked.set(sessionID, identity);
      }
      const entry = {
        session_id: identity.session_id,
        started: identity.started,
        ended,
        project,
        topics: [],
        task_type: "unknown",
        memories_created: [],
        memories_recalled: [],
        notable_unsaved: [],
      };
      const filePath = path.join(brainDir, "contexts.json");
      let existing = null;
      try {
        existing = fsImpl.readFileSync(filePath, "utf8");
      } catch {
        existing = null;
      }
      const next = upsertContextsContent(existing, entry);
      const tmpPath = `${filePath}.${process.pid}.tmp`;
      fsImpl.writeFileSync(tmpPath, next, "utf8");
      fsImpl.renameSync(tmpPath, filePath);
    } catch (err) {
      warn(`brain-memory: context save failed: ${String(err).slice(0, 300)}`);
    }
  };

  return {
    /** Every agent-run shell command records kilo as the host agent. */
    "shell.env": async (_hookInput, output) => {
      try {
        if (output && output.env && !output.env.BRAIN_AGENT) output.env.BRAIN_AGENT = agentLabel;
      } catch {
        /* fail-soft */
      }
    },

    /** First message of a session → inject the brain session-start block. */
    "chat.message": async (hookInput, output) => {
      try {
        const sessionID =
          (hookInput && hookInput.sessionID) || (output && output.message && output.message.sessionID);
        if (!sessionID || injected.has(sessionID)) return;
        injected.add(sessionID);
        const block = await buildSessionStartBlock();
        if (!block || !output || !Array.isArray(output.parts)) return;
        output.parts.push({
          id: `prt_brain${crypto.randomBytes(8).toString("hex")}`,
          sessionID,
          messageID: output.message && output.message.id,
          type: "text",
          text: block,
          synthetic: true,
        });
      } catch (err) {
        warn(`brain-memory: injection failed: ${String(err).slice(0, 300)}`);
      }
    },

    /** Session lifecycle: skip subagents, record session boundaries. */
    event: async ({ event } = {}) => {
      try {
        if (!event || typeof event.type !== "string") return;
        const properties = isRecord(event.properties) ? event.properties : {};
        if (event.type === "session.created") {
          const info = isRecord(properties.info) ? properties.info : {};
          // Subagent sessions inherit their parent's context — don't re-inject.
          if (info.parentID && info.id) injected.add(info.id);
          return;
        }
        if (event.type === "session.idle" || event.type === "session.deleted") {
          const info = isRecord(properties.info) ? properties.info : {};
          const sessionID = properties.sessionID || info.id;
          if (!sessionID) return;
          if (info.parentID) return; // don't track subagent sessions
          saveSessionBoundary(sessionID);
        }
      } catch (err) {
        warn(`brain-memory: event handling failed: ${String(err).slice(0, 300)}`);
      }
    },
  };
};

export default { id: "brain-memory", server };
