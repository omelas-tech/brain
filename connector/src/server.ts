// Brain Memory — Claude connector (Phase 1: read-only MVP).
//
// Official MCP TypeScript SDK over streamable HTTP. Exposes the brain's real
// scored recall as MCP tools, behind OAuth (resource-server guard). Each request
// is bound to the authenticated user's brain working copy.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { z } from "zod";

import { recall, status } from "./engine.js";
import {
  authenticate,
  protectedResourceMetadata,
  wwwAuthenticate,
  type Session,
} from "./auth.js";

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

// Run directly: brain-connector listening for MCP over HTTP.
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT) || 8788;
  createApp().listen(port, () => {
    console.log(`brain-connector (Phase 1) on http://localhost:${port}`);
    console.log(`  PRM:  http://localhost:${port}/.well-known/oauth-protected-resource`);
    console.log(`  MCP:  http://localhost:${port}/mcp`);
  });
}
