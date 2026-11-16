// The memory inspector (MCP App). With CONNECTOR_ENABLE_UI unset the server
// carries no UI metadata at all; with it set, brain_verify points at a
// `ui://` resource a host can render. The view itself is then driven the way a
// host drives it — initialize handshake, then a tool result — against a
// minimal DOM, to prove it renders the review queue and never interprets
// memory text as HTML.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createApp } from "../src/server.js";
import { issueToken } from "../src/auth.js";
import { resolveBrainDir } from "../src/oauth.js";
import { INSPECTOR_URI, INSPECTOR_MIME, INSPECTOR_PROTOCOL, inspectorHtml } from "../src/inspector.js";

function seedEmptyBrain(dir: string) {
  for (const c of ["captured", "_archived"]) fs.mkdirSync(path.join(dir, c), { recursive: true });
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({
    version: 2, created: "2026-01-01T00:00:00.000Z", last_updated: "2026-01-01T00:00:00.000Z", memory_count: 0, memories: {},
    config: { max_depth: 6, consolidation_threshold: 0.3, association_config: { spreading_activation_depth: 2, spreading_activation_decay: 0.5 } },
  }));
  fs.writeFileSync(path.join(dir, "associations.json"), '{"version":1,"edges":{}}');
  fs.writeFileSync(path.join(dir, "_archived", "index.json"), '{"version":1,"archived_count":0,"memories":{}}');
}

async function connect(userId: string) {
  const brainDir = resolveBrainDir(userId);
  const srv = createApp().listen(0);
  await new Promise((r) => srv.once("listening", r));
  const port = (srv.address() as import("node:net").AddressInfo).port;
  const token = issueToken(userId, brainDir, { aud: `http://localhost:${port}/mcp`, scope: "brain.read brain.write" });
  const client = new Client({ name: "inspector-test", version: "0.0.1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  return { client, close: async () => { await client.close(); srv.close(); } };
}

// ---- A DOM just big enough for the view ------------------------------------
class Node_ {
  children: Node_[] = [];
  className = "";
  hidden = false;
  private own = "";
  constructor(public tag: string) {}
  appendChild(n: Node_) { this.children.push(n); return n; }
  set textContent(v: string) { this.own = String(v); this.children = []; }
  get textContent(): string { return this.own + this.children.map((c) => c.textContent).join(""); }
  // The view must never use innerHTML; reaching for it fails the test.
  set innerHTML(_v: string) { throw new Error("the view must not use innerHTML"); }
}

function runView() {
  const html = inspectorHtml();
  const script = /<script>([\s\S]*)<\/script>/.exec(html)![1];
  const byId: Record<string, Node_> = { root: new Node_("main"), heading: new Node_("h1"), sub: new Node_("div"), foot: new Node_("footer") };
  byId.root.textContent = "Waiting for the review queue…"; // as in the markup
  const sent: any[] = [];
  let onMessage: (ev: any) => void = () => {};
  const parent = { postMessage: (m: any) => sent.push(m) };
  const window = {
    parent,
    addEventListener: (_: string, fn: (ev: any) => void) => { onMessage = fn; },
  };
  const document = {
    getElementById: (id: string) => byId[id],
    createElement: (tag: string) => new Node_(tag),
    createTextNode: (t: string) => { const n = new Node_("#text"); n.textContent = t; return n; },
    documentElement: { scrollWidth: 400, scrollHeight: 300, style: { setProperty() {} } },
  };
  vm.runInNewContext(script, { window, document });
  const deliver = (data: any, source: any = parent) => onMessage({ source, data });
  return { byId, sent, deliver, html };
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bc-inspector-"));
  const source = path.join(tmp, "source-brain");
  seedEmptyBrain(source);
  process.env.CONNECTOR_BRAIN_BASE = path.join(tmp, "users");
  process.env.CONNECTOR_STORE = "local";
  process.env.DEV_LOCAL_BRAIN = source;

  // ① Flag off: no UI metadata, no UI resource.
  delete process.env.CONNECTOR_ENABLE_UI;
  {
    const { client, close } = await connect("brain_ui_off");
    try {
      const verify = (await client.listTools()).tools.find((t) => t.name === "brain_verify")!;
      assert.equal(verify._meta, undefined, "no UI metadata on brain_verify by default");
      await assert.rejects(client.listResources(), "no resources capability by default");
    } finally { await close(); }
  }
  console.log("  ① flag off → brain_verify carries no UI metadata, no resources");

  // ② Flag on: brain_verify links the view, and the resource reads as an MCP App.
  process.env.CONNECTOR_ENABLE_UI = "1";
  let queue: any;
  {
    const { client, close } = await connect("brain_ui_on");
    try {
      const tools = (await client.listTools()).tools;
      const verify = tools.find((t) => t.name === "brain_verify")!;
      assert.equal((verify._meta as any).ui.resourceUri, INSPECTOR_URI);
      assert.equal((verify._meta as any)["ui/resourceUri"], INSPECTOR_URI);
      for (const t of tools) if (t.name !== "brain_verify") assert.equal(t._meta, undefined, `${t.name} links no view`);

      const res = await client.readResource({ uri: INSPECTOR_URI });
      const doc = res.contents[0] as any;
      assert.equal(doc.mimeType, INSPECTOR_MIME);
      assert.equal(INSPECTOR_MIME, "text/html;profile=mcp-app");
      assert.ok(doc.text.startsWith("<!doctype html>"));
      // Self-contained: the default MCP Apps CSP allows nothing off-origin.
      assert.ok(!/(src|href)\s*=\s*["']https?:/i.test(doc.text), "no external resources");
      assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket/.test(doc.text), "no network calls");
      // Read-only: the view never calls a tool.
      assert.ok(!doc.text.includes("tools/call"), "the view makes no tool calls");

      // A quarantined write, then the real queue the view will be handed.
      await client.callTool({ name: "brain_memorize", arguments: {
        title: "<img src=x onerror=alert(1)>", content: "Text copied from a web page.", origin: "external",
      } });
      queue = await client.callTool({ name: "brain_verify", arguments: { action: "list" } });
      assert.equal(queue.structuredContent.pending.length, 1);
    } finally { await close(); }
  }
  console.log("  ② flag on → brain_verify links ui://brain/inspector, served as text/html;profile=mcp-app");

  // ③ The view: handshake, then render the queue from a tool result.
  const view = runView();
  const init = view.sent[0];
  assert.equal(init.method, "ui/initialize");
  assert.equal(init.params.protocolVersion, INSPECTOR_PROTOCOL);
  assert.ok(init.params.appInfo.name && init.params.appCapabilities);
  assert.ok(!view.sent.some((m) => m.method === "ui/notifications/initialized"), "not initialized before the host answers");

  view.deliver({ jsonrpc: "2.0", id: init.id, result: { protocolVersion: INSPECTOR_PROTOCOL, hostInfo: { name: "test", version: "0" }, hostCapabilities: {}, hostContext: {} } });
  assert.ok(view.sent.some((m) => m.method === "ui/notifications/initialized"));

  // A message from anywhere but the host is ignored.
  view.deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { pending: [] } } }, {});
  assert.match(view.byId.root.textContent, /Waiting/);

  view.deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: queue });
  assert.equal(view.byId.heading.textContent, "1 memory awaiting review");
  const shown = view.byId.root.textContent;
  assert.ok(shown.includes("<img src=x onerror=alert(1)>"), "the title is shown as text, verbatim");
  assert.ok(shown.includes("external") && shown.includes("origin:external"), "origin and reason are shown");
  assert.equal(view.byId.foot.hidden, false);
  assert.ok(view.sent.some((m) => m.method === "ui/notifications/size-changed"), "reports its size to the host");

  view.deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { pending: [] } } });
  assert.match(view.byId.root.textContent, /Nothing is waiting/);

  // An approve/reject result has no queue: the tool's own line is shown.
  view.deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [{ type: "text", text: "Rejected mem_1" }], structuredContent: { rejected: ["mem_1"] } } });
  assert.match(view.byId.root.textContent, /Rejected mem_1/);

  view.deliver({ jsonrpc: "2.0", id: 77, method: "ping" });
  // Compared as JSON: the reply object was created inside the vm realm.
  assert.equal(JSON.stringify(view.sent.find((m) => m.id === 77 && m.result)), '{"id":77,"result":{},"jsonrpc":"2.0"}');
  console.log("  ③ view → handshake, queue rendered as text, size reported, ping answered");

  console.log("\n✅ INSPECTOR: gated UI metadata, spec MIME type, read-only view renders the review queue.");
}

main().catch((e) => { console.error("\n❌ inspector test failed:", e); process.exit(1); });
