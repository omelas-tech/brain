/**
 * mcp-config.snippet.json validity against the documented Copilot CLI MCP
 * schema (https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers):
 * mcpServers map, remote server as type "http" with an https URL, tools
 * allowlist — and no baked-in credentials (auth is OAuth or a user-added
 * header).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const snippetPath = fileURLToPath(new URL("../mcp/mcp-config.snippet.json", import.meta.url));

function readSnippet() {
  return JSON.parse(fs.readFileSync(snippetPath, "utf8"));
}

test("snippet is valid JSON with an mcpServers map", () => {
  const snippet = readSnippet();
  assert.equal(typeof snippet.mcpServers, "object");
  assert.ok(snippet.mcpServers["brain-memory"], "brain-memory server entry present");
});

test("brain-memory is a remote streamable-HTTP server", () => {
  const server = readSnippet().mcpServers["brain-memory"];
  assert.equal(server.type, "http");
  assert.match(server.url, /^https:\/\//, "https is required by the CLI for remote servers");
  assert.equal(server.url, "https://mcp.brainmemory.ai/mcp");
});

test("tools allowlist follows the documented format", () => {
  const server = readSnippet().mcpServers["brain-memory"];
  assert.ok(Array.isArray(server.tools));
  assert.deepEqual(server.tools, ["*"]);
});

test("no credentials are baked into the shipped snippet", () => {
  const raw = fs.readFileSync(snippetPath, "utf8");
  assert.ok(!/authorization/i.test(raw), "no auth header shipped — OAuth or user-added token");
  assert.ok(!/bearer/i.test(raw));
  assert.equal(readSnippet().mcpServers["brain-memory"].headers, undefined);
});

test("snippet contains only the brain-memory server (safe to deep-merge)", () => {
  const snippet = readSnippet();
  assert.deepEqual(Object.keys(snippet), ["mcpServers"]);
  assert.deepEqual(Object.keys(snippet.mcpServers), ["brain-memory"]);
});
