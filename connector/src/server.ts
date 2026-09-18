// Brain Memory — Claude connector (Phase 1: read-only MVP).
//
// Official MCP TypeScript SDK over streamable HTTP. Exposes the brain's real
// scored recall as MCP tools, behind OAuth (resource-server guard). Each request
// is bound to the authenticated user's brain working copy.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { recall, status } from "./engine.js";
import {
  authenticate,
  hasScope,
  protectedResourceMetadata,
  wwwAuthenticate,
  sweepExpiredTokens,
  type Session,
} from "./auth.js";
import { registerOAuthRoutes, mcpResource, sweepExpired } from "./oauth.js";
import { initOAuthState } from "./persist.js";
import { activeProvider, providerProblem } from "./identity.js";
import { ensureUserBrain, syncBack, purgeBrain, startBrainReaper } from "./store.js";
import { memorize, pin, unpin, forget, verifyList, verifyApprove, verifyReject } from "./write.js";
import { rateLimit } from "./ratelimit.js";
import { memoryResult } from "./result.js";
import { INSPECTOR_URI, inspectorHtml } from "./inspector.js";

/**
 * A tool result the client MUST NOT act on because the token lacks the write
 * scope. Returned as an error result (not thrown) so the model sees a clean
 * message instead of a transport failure. Kept private-scoped like every other
 * memory response.
 */
function scopeError(tool: string): ReturnType<typeof memoryResult> & { isError: true } {
  return {
    ...memoryResult(
      `Refused: ${tool} needs the "brain.write" scope, but this token is read-only. ` +
        `Re-authorize requesting brain.write.`,
    ),
    isError: true,
  };
}

/** A fresh server per request, with tools bound to this user's brain dir. */
export function buildServer(session: Session): McpServer {
  const server = new McpServer(
    { name: "brain-memory", version: "0.0.1" },
    {
      instructions:
        "Recall the user's stored memories before tasks where prior decisions, " +
        "preferences, or learnings may help. brain_recall ranks by the brain's own " +
        "scoring (relevance + decayed strength + spreading activation), not keyword match. " +
        "Use brain_memorize to store a specific fact the user asks to remember — pass only the " +
        "distilled content, never the whole conversation.",
    },
  );

  // Freshness: re-pull the user's brain from brain-cloud when the cached working copy
  // is older than CONNECTOR_REPULL_TTL_MS (default 120s; 0 disables). The re-pull is
  // cheap — it skips the download unless the cloud checksum changed — and never
  // overwrites an unsynced local write, so a CLI `brain cloud push` mid-session shows
  // up without forcing a re-auth.
  const FRESH_TTL_MS = Number(process.env.CONNECTOR_REPULL_TTL_MS ?? 120_000);
  const ensureFresh = () =>
    ensureUserBrain({
      userId: session.userId,
      brainDir: session.brainDir,
      idToken: session.idToken,
      ttlMs: FRESH_TTL_MS > 0 ? FRESH_TTL_MS : undefined,
    });

  server.registerTool(
    "brain_recall",
    {
      description:
        "Recall the user's most relevant stored memories for a query, ranked by the " +
        "brain engine (TF-IDF relevance + decayed strength + spreading activation + " +
        "context match). Call this at the start of a task where past context may help.",
      inputSchema: {
        query: z.string().describe("What to recall — a topic, question, or task description"),
        limit: z.number().int().min(1).max(25).default(10).describe("Max memories to return"),
        project: z.string().optional().describe("Current project name, for context-matched scoring"),
        as_of: z.string().optional().describe(
          "ISO date (e.g. 2026-03-01). Return what was TRUE at that instant — memories whose " +
          "validity window contains it, with the superseded-fact demotion lifted. Use for dated " +
          "questions like 'what were we using back in March?' instead of reasoning over timestamps.",
        ),
        as_known_of: z.string().optional().describe(
          "ISO date. Return only memories the brain had RECORDED by then — what it knew at that " +
          "point, regardless of when the facts were true. Combine with as_of to reconstruct " +
          "exactly what the brain believed, and when.",
        ),
      },
      annotations: { readOnlyHint: true, title: "Recall memories" },
    },
    async ({ query, limit, project, as_of, as_known_of }) => {
      await ensureFresh();
      const hits = await recall(session.brainDir, query, {
        top: limit, project, asOf: as_of, asKnownOf: as_known_of,
      });
      // Surface the login-time identity hint ONLY when recall is empty — that's the
      // case where a wrong-account sign-in looks like "no memories" and the user
      // needs to know why. Non-empty results stay clutter-free.
      const note = hits.length === 0 ? session.identityNote : undefined;
      // Recall hits carry `low_trust` / `quarantine_pending` straight from the
      // engine; the model reads them from the JSON to caveat unverified facts.
      const pending = hits.filter((h: any) => h.quarantine_pending).length;
      // Bitemporal: a hit whose validity window has closed is history, not the
      // current answer. Spelled out in the text channel — the model reads that
      // far more reliably than a per-hit boolean buried in the JSON.
      const expired = hits.filter((h: any) => h.expired).length;
      const text = JSON.stringify(hits, null, 2)
        + (pending ? `\n\n${pending} of these are pending verification (unverified source) — treat as claims.` : "")
        + (expired ? `\n\n${expired} of these are EXPIRED (their validity window closed — see valid_until). State them as history ("that was the case until <date>"), never as the current answer.` : "")
        + (note ? `\n\nNote: ${note}` : "");
      // Per-user memory content — never cacheable across users.
      return memoryResult(text, {
        count: hits.length,
        results: hits,
        ...(expired ? { expired_count: expired } : {}),
        ...(as_of || as_known_of ? { as_of, as_known_of } : {}),
        ...(note ? { note } : {}),
      });
    },
  );

  server.registerTool(
    "brain_status",
    {
      description: "Health overview of the user's brain: memory count and last-updated time.",
      inputSchema: {},
      annotations: { readOnlyHint: true, title: "Brain status" },
    },
    async () => {
      await ensureFresh();
      const s = status(session.brainDir);
      // brain_status is the diagnostic tool — always report the identity hint here
      // (e.g. "this account has no brain in Brain Cloud") so a wrong-account
      // sign-in is visible even when the brain isn't empty for other reasons.
      const note = session.identityNote;
      const out = note ? { ...s, note } : s;
      return memoryResult(JSON.stringify(out, null, 2), out);
    },
  );

  // ---- Write tools (Phase 2) ----------------------------------------------
  // Each mutates the user's brain working copy via the deterministic engine, then
  // syncs the brain back to brain-cloud so it reaches the CLI and other devices.
  const writeBack = async () =>
    syncBack({ brainDir: session.brainDir, brainId: session.brainId, idToken: session.idToken });

  // Apply one write and push it. If the store moved on since this working copy
  // was pulled (another device pushed), the push is refused rather than allowed to
  // overwrite that work. Then: throw this copy away, start from the store's
  // current brain, apply the SAME write again, and push once more. Re-running on a
  // fresh copy (instead of unpacking the newer archive over this one) is what
  // keeps the index and the memory files consistent.
  const writeThenSync = async <T>(op: () => Promise<T>) => {
    let result = await op();
    let sync = await writeBack();
    if (sync.conflict) {
      purgeBrain(session.brainDir);
      await ensureUserBrain({ userId: session.userId, brainDir: session.brainDir, idToken: session.idToken, refresh: true });
      result = await op();
      sync = await writeBack();
    }
    return { result, sync };
  };

  server.registerTool(
    "brain_memorize",
    {
      description:
        "Store a new memory from the SPECIFIC content provided in `content` — a distilled fact, " +
        "decision, preference, or note the user wants remembered. Pass only that content, not the " +
        "whole conversation. Returns the stored memory's id and path.",
      inputSchema: {
        content: z.string().min(1).describe("The exact memory content to store (Markdown ok). Distilled, not the raw chat."),
        title: z.string().optional().describe("Short title; derived from content if omitted"),
        type: z.enum(["decision", "insight", "goal", "experience", "learning", "relationship", "preference", "observation"]).optional().describe("Memory type (default: learning)"),
        tags: z.array(z.string()).optional().describe("Topic tags"),
        origin: z.enum(["user", "agent-inferred", "tool-output", "external"]).optional().describe(
          "Provenance of the fact — be honest, recall trusts it: 'user' ONLY when the user explicitly " +
          "stated it or asked to remember it; 'agent-inferred' (default) for facts you summarized from " +
          "the conversation; 'tool-output' for facts from tool or file results; 'external' for facts " +
          "sourced from web pages, emails, or other third-party content. Non-user origins are " +
          "confidence-capped at write and down-weighted at recall.",
        ),
        valid_from: z.string().optional().describe(
          "ISO date the fact BECAME true, when that differs from now — 'starting in March', " +
          "'since the rewrite'. Distinct from when it is being recorded. Omit for facts simply true.",
        ),
        valid_until: z.string().optional().describe(
          "ISO date the fact STOPS being true — 'until the end of Q3', 'while I'm on leave'. " +
          "After it passes, recall demotes the memory and marks it expired instead of serving it " +
          "as current. Omit unless the user bounded the fact in time.",
        ),
        supersedes: z.array(z.string()).optional().describe(
          "Ids of memories this one REPLACES (a decision reversed, a preference changed). Closes " +
          "their validity window so 'that was true until X' stays answerable — they are demoted, " +
          "never deleted. Use instead of storing a contradicting fact alongside the old one.",
        ),
      },
      annotations: { title: "Memorize", readOnlyHint: false },
    },
    async ({ content, title, type, tags, origin, valid_from, valid_until, supersedes }) => {
      if (!hasScope(session, "brain.write")) return scopeError("brain_memorize");
      await ensureFresh();
      const { result: stored, sync } = await writeThenSync(() => memorize(session.brainDir, {
        content, title, type, tags, origin, valid_from, valid_until, supersedes,
      }));
      // A low-trust or lint-flagged write lands pending verification — say so,
      // so the user knows it won't be treated as established fact yet.
      const pending = stored?.quarantine_pending
        ? ` — pending verification (${(stored.quarantine_reasons || []).join(", ")}); resolve with brain_verify`
        : "";
      const syncMsg = sync.pushed ? " — synced" : sync.error ? ` — local only (${sync.error})` : "";
      // A replacement that actually landed vs one held behind verification: the
      // second is the security-relevant case, because the user asked for an old
      // fact to be retired and it is still current until they approve.
      const replaced = stored?.superseded?.length
        ? ` — replaced ${stored.superseded.map((s: any) => `"${s.title}"`).join(", ")}`
        : "";
      const heldBack = stored?.supersede_pending?.length
        ? ` — the replacement of ${stored.supersede_pending.join(", ")} is HELD until you approve this write (brain_verify); those memories are still current`
        : "";
      return memoryResult(
        `Stored "${stored.title ?? title ?? "memory"}" (${stored.id ?? "ok"})${syncMsg}${pending}${replaced}${heldBack}`,
        { stored, synced: sync.pushed },
      );
    },
  );

  server.registerTool(
    "brain_pin",
    {
      description:
        "Pin a memory to the always-present tier so it loads every session and never decays. " +
        "Provide the memory `id` (e.g. from brain_recall results).",
      inputSchema: { id: z.string().describe("Memory id, e.g. mem_20260101_abc123") },
      annotations: { title: "Pin memory", readOnlyHint: false },
    },
    async ({ id }) => {
      if (!hasScope(session, "brain.write")) return scopeError("brain_pin");
      await ensureFresh();
      const { result: res, sync } = await writeThenSync(() => pin(session.brainDir, id));
      return memoryResult(`Pinned ${id}${sync.pushed ? " — synced" : ""}`, { ...res, synced: sync.pushed });
    },
  );

  server.registerTool(
    "brain_unpin",
    {
      description: "Remove a memory from the always-present tier (returns it to normal recall + decay). Provide the memory `id`.",
      inputSchema: { id: z.string().describe("Memory id to unpin") },
      annotations: { title: "Unpin memory", readOnlyHint: false },
    },
    async ({ id }) => {
      if (!hasScope(session, "brain.write")) return scopeError("brain_unpin");
      await ensureFresh();
      const { result: res, sync } = await writeThenSync(() => unpin(session.brainDir, id));
      return memoryResult(`Unpinned ${id}${sync.pushed ? " — synced" : ""}`, { ...res, synced: sync.pushed });
    },
  );

  server.registerTool(
    "brain_forget",
    {
      description:
        "Archive a memory so it stops surfacing in recall (recoverable — moved to _archived/, not " +
        "permanently deleted). Provide the memory `id` (e.g. from brain_recall results).",
      inputSchema: { id: z.string().describe("Memory id to archive") },
      annotations: { title: "Forget memory", readOnlyHint: false, destructiveHint: true },
    },
    async ({ id }) => {
      if (!hasScope(session, "brain.write")) return scopeError("brain_forget");
      await ensureFresh();
      const { result: res, sync } = await writeThenSync(() => forget(session.brainDir, id));
      return memoryResult(`Archived ${id}${sync.pushed ? " — synced" : ""}`, { ...res, synced: sync.pushed });
    },
  );

  // ---- Verification (ASI06 quarantine) ------------------------------------
  server.registerTool(
    "brain_verify",
    {
      description:
        "Review and resolve memories pending verification (writes from untrusted sources — " +
        "tool output, external content, or instruction-shaped text — are quarantined until reviewed). " +
        "action 'list' (default) is read-only; 'approve' clears the flag (origin and trust weighting " +
        "stay); 'reject' archives the memory. Approval is the user's call — never approve unreviewed.",
      inputSchema: {
        action: z.enum(["list", "approve", "reject"]).default("list").describe("What to do"),
        ids: z.array(z.string()).optional().describe("Memory ids for approve/reject"),
      },
      annotations: { title: "Verify memories", readOnlyHint: false },
    },
    async ({ action, ids }) => {
      await ensureFresh();
      if (action === "list") {
        const res = await verifyList(session.brainDir);
        return memoryResult(JSON.stringify(res, null, 2), res);
      }
      if (!hasScope(session, "brain.write")) return scopeError("brain_verify");
      if (!ids || ids.length === 0) {
        return { ...memoryResult(`brain_verify ${action} needs at least one id.`), isError: true };
      }
      const { result: res, sync } = await writeThenSync(() => action === "approve"
        ? verifyApprove(session.brainDir, ids)
        : verifyReject(session.brainDir, ids));
      return memoryResult(
        `${action === "approve" ? "Approved" : "Rejected"} ${ids.join(", ")}${sync.pushed ? " — synced" : ""}`,
        { ...res, synced: sync.pushed },
      );
    },
  );

  // Experimental MCP App (memory inspector). Dormant unless CONNECTOR_ENABLE_UI=1
  // — MCP Apps client support is still emerging, so it must never touch the
  // default tool surface. Registers a self-contained ui:// HTML resource.
  if (process.env.CONNECTOR_ENABLE_UI === "1") {
    server.registerResource(
      "brain-inspector",
      INSPECTOR_URI,
      { title: "Memory Inspector", description: "Provenance and verification state for recalled memories.", mimeType: "text/html" },
      async () => ({
        contents: [{ uri: INSPECTOR_URI, mimeType: "text/html", text: inspectorHtml() }],
      }),
    );
  }

  return server;
}

export function createApp() {
  const app = express();
  // Behind a TLS-terminating proxy (nginx / Cloudflare tunnel), trust
  // X-Forwarded-Proto so issuer/resource URLs are https (Claude requires it).
  // Trust ONLY the loopback proxy — NOT `true`, which would let a direct client
  // spoof X-Forwarded-* (and thus forge the issuer used in audience binding and
  // OAuth callback URLs). The connector also binds to 127.0.0.1 (see listen).
  // CONNECTOR_TRUST_PROXY overrides this for deployments where the proxy is not on
  // loopback — e.g. "uniquelocal" when the proxy is another container on a private
  // Docker network. It takes Express's trust-proxy syntax. `true` is refused.
  const trustProxy = (process.env.CONNECTOR_TRUST_PROXY || "loopback").trim();
  if (/^(true|1)$/i.test(trustProxy)) {
    throw new Error('CONNECTOR_TRUST_PROXY must name the proxy (e.g. "loopback", "uniquelocal", a subnet), never "true"');
  }
  app.set("trust proxy", trustProxy);
  app.use(express.json());
  // OAuth token requests are application/x-www-form-urlencoded (RFC 6749 §4.1.3).
  app.use(express.urlencoded({ extended: true }));

  const issuerOf = (req: Request) =>
    `${req.protocol}://${req.get("host")}`;

  // Per-IP rate limits (in-memory). Tightest on open DCR; generous on /mcp tool
  // traffic, which is Bearer-authenticated. Must precede the route registrations.
  app.use("/register", rateLimit({ windowMs: 60_000, max: 10 }));
  app.use(["/authorize", "/authorize/complete", "/oidc/callback"], rateLimit({ windowMs: 60_000, max: 30 }));
  app.use("/token", rateLimit({ windowMs: 60_000, max: 60 }));
  app.use("/mcp", rateLimit({ windowMs: 60_000, max: 300 }));

  // RFC 9728 — Protected Resource Metadata (how clients discover the AS).
  app.get("/.well-known/oauth-protected-resource", (req, res) => {
    res.json(protectedResourceMetadata(issuerOf(req)));
  });

  // OAuth 2.1 Authorization Server (authorize / token / register / metadata).
  registerOAuthRoutes(app);

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // MCP endpoint — OAuth resource server. Bearer required on every request.
  app.post("/mcp", async (req: Request, res: Response) => {
    const session = authenticate(req.headers["authorization"]);
    if (!session) {
      res
        .status(401)
        .set("WWW-Authenticate", wwwAuthenticate(issuerOf(req), "missing or invalid token", "invalid_token"))
        .json({ error: "invalid_token" });
      return;
    }
    // RFC 8707 — only accept tokens minted for THIS resource (audience binding).
    if (session.aud !== mcpResource(issuerOf(req))) {
      res
        .status(401)
        .set("WWW-Authenticate", wwwAuthenticate(issuerOf(req), "token audience mismatch", "invalid_token"))
        .json({ error: "invalid_token" });
      return;
    }

    const server = buildServer(session);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // The stateless server exposes only POST /mcp. Answer the other verbs with an
  // explicit 405 + Allow header (RFC 7231) instead of a generic 404, so a client
  // probing for the server-initiated SSE stream (GET) or session teardown
  // (DELETE) gets the correct "not supported here" signal.
  app.all("/mcp", (_req, res) => {
    res.status(405).set("Allow", "POST").json({ error: "method_not_allowed" });
  });

  return app;
}

/** Minimal .env loader (no dependency): set vars from connector/.env if present. */
function loadDotEnv() {
  try {
    const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* best-effort */ }
}

// Run directly: brain-connector listening for MCP over HTTP.
if (import.meta.url === `file://${process.argv[1]}`) {
  loadDotEnv();
  // FAIL CLOSED: never run in production without an identity provider — otherwise
  // /authorize would have to fall back to the shared dev stub (auth bypass).
  if (process.env.NODE_ENV === "production" && !activeProvider()) {
    console.error(
      `[connector] FATAL: NODE_ENV=production but there is no identity provider: ${providerProblem()}. ` +
        "Refusing to start with authentication disabled.",
    );
    process.exit(1);
  }
  console.log(`  identity: ${activeProvider()?.name ?? "none (dev stub only)"}`);
  const port = Number(process.env.PORT) || 8788;
  // Login continuity: refresh grants + the DCR client registry persist under
  // CONNECTOR_STATE_DIR so a deploy/restart doesn't log every user out.
  const state = initOAuthState();
  if (state.persistent) {
    console.log(`  oauth state: persisted in ${state.dir}`);
  } else if (process.env.NODE_ENV === "production") {
    console.warn(
      "[connector] WARNING: CONNECTOR_STATE_DIR is not set — refresh grants and " +
        "client registrations are memory-only, so every restart forces every user " +
        "to log in again.",
    );
  }
  // Garbage-collect expired auth codes / pending logins / tokens (they are only
  // pruned lazily on use otherwise). Unref'd so it never holds the process open.
  // Session end: when a user's last token expires, purge their plaintext working
  // copy from the host so it doesn't linger after they disconnect.
  setInterval(() => {
    sweepExpired();
    for (const dir of sweepExpiredTokens()) purgeBrain(dir);
  }, 60_000).unref();

  // Idle reaper: even on the prod RAM tmpfs, a live-host compromise can read every
  // working copy still present, so we bound that to CONNECTOR_IDLE_PURGE_MS of
  // inactivity (default 15m; 0 disables). A returning user is re-pulled
  // transparently by ensureUserBrain, so a purge only costs a re-pull.
  const idlePurgeMs = Number(process.env.CONNECTOR_IDLE_PURGE_MS ?? 900_000);
  const purgeSweepMs = Number(process.env.CONNECTOR_PURGE_SWEEP_MS ?? 60_000);
  if (startBrainReaper({ idleMs: idlePurgeMs, intervalMs: purgeSweepMs })) {
    console.log(`  reaper: purging idle brain working copies after ${Math.round(idlePurgeMs / 1000)}s of inactivity`);
  }
  // Bind to loopback only: the connector is reached via the local reverse proxy,
  // never directly from the network (defense in depth alongside the host firewall).
  const host = process.env.CONNECTOR_BIND_HOST || "127.0.0.1";
  createApp().listen(port, host, () => {
    console.log(`brain-connector on http://${host}:${port}`);
    console.log(`  PRM:  http://${host}:${port}/.well-known/oauth-protected-resource`);
    console.log(`  MCP:  http://${host}:${port}/mcp`);
  });
}
