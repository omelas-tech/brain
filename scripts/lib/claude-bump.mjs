// Agentic changelog classifier for brain-memory.
//
// Feeds the git delta since the last release (commit subjects + diffstat) to the
// headless `claude -p` CLI and gets back a structured, Keep-a-Changelog-shaped
// proposal: { summary, changes: { Added|Changed|Fixed|Security|Removed|Deprecated: [...] } }.
// Pure child_process + JSON parse — zero npm dependencies. Every failure path
// falls back to manual entry so a missing/broken model never blocks a release.

import { spawnSync } from "child_process";

export const CATEGORIES = [
  "Added",
  "Changed",
  "Deprecated",
  "Removed",
  "Fixed",
  "Security",
];

const SYSTEM =
  "You are a release-notes writer for brain-memory, a developer CLI/plugin (a file-system memory system for AI coding agents). Output ONLY valid JSON matching the requested schema. No prose, no markdown fences.";

/** Build the classification prompt from the delta. */
export function buildPrompt({ currentVersion, nextVersion, prevTag, commits, diffstat }) {
  return `Current version: ${currentVersion}
Next version: ${nextVersion}
Commits since ${prevTag || "the beginning"}:
${commits || "(none)"}

Diffstat: ${diffstat || "(none)"}

Write the CHANGELOG entry for the next version. Rules:
- Group changes under Keep a Changelog categories: Added, Changed, Deprecated, Removed, Fixed, Security. Omit any category with no items.
- Audience is developers using the tool. It is fine — expected — to name brain's own commands, flags, files, and CLI subcommands (e.g. \`brain recall\`, \`session-start\`, \`/brain:forget\`, \`~/.brain/\`).
- Each item starts with a short bold lead-in ("**Recall relevance after out-of-band changes.**") followed by 1-3 sentences of what changed and why it matters to the user. Markdown is allowed: **bold**, \`code\`, [text](url).
- Skip purely internal churn with no user-visible effect (lockfile syncs, CI tweaks, test-only refactors, formatting) unless it changes behavior, security, or the public surface.
- "Security" is for anything touching encryption, auth, data handling, sandboxing, or the hosted service/connector.
- summary: <= 80 chars, sentence case, official tone, no emoji, no "this release".
- Group by intent, not one item per commit. 1-8 items total across all categories.
- If there is no user-visible content, output { "summary": "Internal maintenance.", "changes": { "Changed": ["**Internal maintenance.** No user-facing changes."] } }.

Schema: {"summary": string, "changes": { "<Category>": string[] }}
Respond with one JSON object. Nothing else.`;
}

/** Extract the first JSON object from a possibly-noisy model reply. */
export function extractJson(text) {
  if (!text) return null;
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  let obj = tryParse(text.trim());
  if (obj) return obj;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    obj = tryParse(fenced[1].trim());
    if (obj) return obj;
  }
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) return tryParse(brace[0]);
  return null;
}

/** Validate + normalize a proposal. Throws on unrecoverable shape. */
export function validate(proposal) {
  if (!proposal || typeof proposal !== "object") throw new Error("not an object");
  const summary = String(proposal.summary || "").trim();
  if (!summary || summary.length > 120) throw new Error("bad summary");
  const rawChanges = proposal.changes;
  if (!rawChanges || typeof rawChanges !== "object") throw new Error("no changes");

  const changes = {};
  let total = 0;
  for (const cat of CATEGORIES) {
    const items = rawChanges[cat];
    if (!Array.isArray(items)) continue;
    const clean = items.map((s) => String(s).trim()).filter(Boolean);
    if (clean.length) {
      changes[cat] = clean;
      total += clean.length;
    }
  }
  if (total === 0) throw new Error("no items");
  return { summary, changes };
}

/**
 * Classify the delta via `claude -p`. Returns a validated proposal, or null if
 * the CLI is unavailable / errors / returns unparseable output (caller falls
 * back to manual entry).
 */
export function classifyChanges(delta) {
  const prompt = buildPrompt(delta);
  const timeout = Number(process.env.BRAIN_RELEASE_CLAUDE_TIMEOUT_MS) || 120000;
  let res;
  try {
    res = spawnSync(
      "claude",
      ["-p", "--output-format", "text", "--max-turns", "1", "--append-system-prompt", SYSTEM, prompt],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 8 * 1024 * 1024,
        timeout,
        killSignal: "SIGKILL",
      }
    );
  } catch (e) {
    return { ok: false, error: `spawn failed: ${e.message}` };
  }
  if (res.error) {
    const why = res.error.code === "ETIMEDOUT" ? `timed out after ${timeout}ms` : res.error.message;
    return { ok: false, error: `claude not runnable: ${why}` };
  }
  if (res.signal) return { ok: false, error: `claude terminated by ${res.signal} (timeout?)` };
  if (res.status !== 0) {
    return { ok: false, error: `claude exited ${res.status}: ${(res.stderr || "").trim().slice(0, 300)}` };
  }
  const parsed = extractJson(res.stdout);
  if (!parsed) return { ok: false, error: "could not parse model JSON" };
  try {
    return { ok: true, proposal: validate(parsed) };
  } catch (e) {
    return { ok: false, error: `invalid proposal: ${e.message}` };
  }
}
