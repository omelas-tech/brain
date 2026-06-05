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
  type Session,
} from "./auth.js";
import { registerOAuthRoutes, mcpResource, resolveBrainUserId, resolveBrainDir } from "./oauth.js";
import { isFirebaseConfigured, verifyFirebaseIdToken, loginPageHtml } from "./firebase.js";

/** A fresh server per request, with tools bound to this user's brain dir. */
export function buildServer(session: Session): McpServer {
  const server = new McpServer(
    { name: "brain-memory", version: "0.0.1" },
    {
      instructions:
        "Recall the user's stored memories before tasks where prior decisions, " +
        "preferences, or learnings may help. brain_recall ranks by the brain's own " +
        "scoring (relevance + decayed strength + spreading activation), not keyword match.",
    },
  );

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
      const hits = await recall(session.brainDir, query, { top: limit, project });
      return {
        content: [{ type: "text", text: JSON.stringify(hits, null, 2) }],
        structuredContent: { count: hits.length, results: hits },
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
      const s = status(session.brainDir);
      return {
        content: [{ type: "text", text: JSON.stringify(s, null, 2) }],
        structuredContent: s,
      };
    },
  );

  return server;
}

export function createApp() {
  const app = express();
  app.use(express.json());

  const issuerOf = (req: Request) =>
    `${req.protocol}://${req.get("host")}`;

  // RFC 9728 — Protected Resource Metadata (how clients discover the AS).
  app.get("/.well-known/oauth-protected-resource", (req, res) => {
    res.json(protectedResourceMetadata(issuerOf(req)));
  });

  // OAuth 2.1 Authorization Server (authorize / token / register / metadata).
  registerOAuthRoutes(app);

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // Demo: see the Firebase login resolve YOUR identity in isolation (no OAuth
  // dance). Open /dev/whoami in a browser, sign in, watch it resolve.
  app.get("/dev/whoami", (_req, res) => {
    if (!isFirebaseConfigured()) {
      res.type("html").send("<pre>Firebase not configured. Set FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID (and friends), then restart.</pre>");
      return;
    }
    res.type("html").send(loginPageHtml({ action: "/dev/whoami", title: "Who am I? (Firebase demo)" }));
  });
  app.post("/dev/whoami", async (req, res) => {
    try {
      const id = await verifyFirebaseIdToken(req.body?.id_token);
      const userId = resolveBrainUserId(id.uid);
      res.json({ firebase_uid: id.uid, email: id.email, name: id.name, brain_user_id: userId, brain_dir: resolveBrainDir(userId) });
    } catch (e: any) {
      res.status(401).json({ error: e.message });
    }
  });

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
  const port = Number(process.env.PORT) || 8788;
  createApp().listen(port, () => {
    console.log(`brain-connector (Phase 1) on http://localhost:${port}`);
    console.log(`  PRM:  http://localhost:${port}/.well-known/oauth-protected-resource`);
    console.log(`  MCP:  http://localhost:${port}/mcp`);
  });
}
