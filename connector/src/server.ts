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
  protectedResourceMetadata,
  wwwAuthenticate,
  sweepExpiredTokens,
  type Session,
} from "./auth.js";
import { registerOAuthRoutes, mcpResource, sweepExpired } from "./oauth.js";
import { initOAuthState } from "./persist.js";
import { isFirebaseConfigured } from "./firebase.js";
import { ensureUserBrain, syncBack, purgeBrain, startBrainReaper } from "./store.js";
import { memorize, pin, unpin, forget } from "./write.js";
import { rateLimit } from "./ratelimit.js";

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
      },
      annotations: { readOnlyHint: true, title: "Recall memories" },
    },
    async ({ query, limit, project }) => {
      await ensureFresh();
      const hits = await recall(session.brainDir, query, { top: limit, project });
      // Surface the login-time identity hint ONLY when recall is empty — that's the
      // case where a wrong-account sign-in looks like "no memories" and the user
      // needs to know why. Non-empty results stay clutter-free.
      const note = hits.length === 0 ? session.identityNote : undefined;
      const text = JSON.stringify(hits, null, 2) + (note ? `\n\nNote: ${note}` : "");
      return {
        content: [{ type: "text", text }],
        structuredContent: { count: hits.length, results: hits, ...(note ? { note } : {}) },
      };
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
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        structuredContent: out,
      };
    },
  );

  // ---- Write tools (Phase 2) ----------------------------------------------
  // Each mutates the user's brain working copy via the deterministic engine, then
  // syncs the brain back to brain-cloud so it reaches the CLI and other devices.
  const writeBack = async () =>
    syncBack({ brainDir: session.brainDir, brainId: session.brainId, idToken: session.idToken });

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
      },
      annotations: { title: "Memorize", readOnlyHint: false },
    },
    async ({ content, title, type, tags }) => {
      await ensureFresh();
      const stored = await memorize(session.brainDir, { content, title, type, tags });
      const sync = await writeBack();
      return {
        content: [{ type: "text", text: `Stored "${stored.title ?? title ?? "memory"}" (${stored.id ?? "ok"})${sync.pushed ? " — synced" : sync.error ? ` — local only (${sync.error})` : ""}` }],
        structuredContent: { stored, synced: sync.pushed },
      };
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
      await ensureFresh();
      const res = await pin(session.brainDir, id);
      const sync = await writeBack();
      return { content: [{ type: "text", text: `Pinned ${id}${sync.pushed ? " — synced" : ""}` }], structuredContent: { ...res, synced: sync.pushed } };
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
      await ensureFresh();
      const res = await unpin(session.brainDir, id);
      const sync = await writeBack();
      return { content: [{ type: "text", text: `Unpinned ${id}${sync.pushed ? " — synced" : ""}` }], structuredContent: { ...res, synced: sync.pushed } };
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
      await ensureFresh();
      const res = await forget(session.brainDir, id);
      const sync = await writeBack();
      return { content: [{ type: "text", text: `Archived ${id}${sync.pushed ? " — synced" : ""}` }], structuredContent: { ...res, synced: sync.pushed } };
    },
  );

  return server;
}

export function createApp() {
  const app = express();
  // Behind a TLS-terminating proxy (nginx / Cloudflare tunnel), trust
  // X-Forwarded-Proto so issuer/resource URLs are https (Claude requires it).
  // Trust ONLY the loopback proxy — NOT `true`, which would let a direct client
  // spoof X-Forwarded-* (and thus forge the issuer used in audience binding and
  // OAuth callback URLs). The connector also binds to 127.0.0.1 (see listen).
  app.set("trust proxy", "loopback");
  app.use(express.json());
  // OAuth token requests are application/x-www-form-urlencoded (RFC 6749 §4.1.3).
  app.use(express.urlencoded({ extended: true }));

  const issuerOf = (req: Request) =>
    `${req.protocol}://${req.get("host")}`;

  // Per-IP rate limits (in-memory). Tightest on open DCR; generous on /mcp tool
  // traffic, which is Bearer-authenticated. Must precede the route registrations.
  app.use("/register", rateLimit({ windowMs: 60_000, max: 10 }));
  app.use(["/authorize", "/authorize/complete"], rateLimit({ windowMs: 60_000, max: 30 }));
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
        .set("WWW-Authenticate", wwwAuthenticate(issuerOf(req), "missing or invalid token"))
        .json({ error: "unauthorized" });
      return;
    }
    // RFC 8707 — only accept tokens minted for THIS resource (audience binding).
    if (session.aud !== mcpResource(issuerOf(req))) {
      res
        .status(401)
        .set("WWW-Authenticate", wwwAuthenticate(issuerOf(req), "token audience mismatch"))
        .json({ error: "unauthorized" });
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
  if (process.env.NODE_ENV === "production" && !isFirebaseConfigured()) {
    console.error(
      "[connector] FATAL: NODE_ENV=production but Firebase is not configured " +
        "(set FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID). " +
        "Refusing to start with authentication disabled.",
    );
    process.exit(1);
  }
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
