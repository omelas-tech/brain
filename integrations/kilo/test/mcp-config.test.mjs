/**
 * kilo-mcp.snippet.json validity against the documented Kilo MCP schema
 * (https://kilo.ai/docs/automate/mcp/using-in-kilo-code): "mcp" map, remote
 * server as type "remote" with an https URL — and no baked-in credentials
 * (Kilo auto-starts OAuth for remote servers).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const snippetPath = fileURLToPath(new URL("../mcp/kilo-mcp.snippet.json", import.meta.url));

function readSnippet() {
  return JSON.parse(fs.readFileSync(snippetPath, "utf8"));
}

test("snippet is valid JSON with an mcp map", () => {
  const snippet = readSnippet();
  assert.equal(typeof snippet.mcp, "object");
  assert.ok(snippet.mcp["brain-memory"], "brain-memory server entry present");
});

test("brain-memory is a remote server per the documented schema", () => {
  const server = readSnippet().mcp["brain-memory"];
  assert.equal(server.type, "remote");
  assert.match(server.url, /^https:\/\//);
  assert.equal(server.url, "https://mcp.brainmemory.ai/mcp");
  assert.equal(server.enabled, true);
});

test("no credentials are baked into the shipped snippet", () => {
  const raw = fs.readFileSync(snippetPath, "utf8");
  assert.ok(!/authorization/i.test(raw), "no auth header shipped — OAuth auto-starts");
  assert.ok(!/bearer/i.test(raw));
  assert.equal(readSnippet().mcp["brain-memory"].headers, undefined);
});

test("snippet contains only the brain-memory server (safe to deep-merge)", () => {
  const snippet = readSnippet();
  assert.deepEqual(Object.keys(snippet), ["mcp"]);
  assert.deepEqual(Object.keys(snippet.mcp), ["brain-memory"]);
});
