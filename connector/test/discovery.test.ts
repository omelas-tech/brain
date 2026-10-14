// What hosts and directories see before a user signs in: the brand icon, the
// protected-resource metadata at both RFC 9728 locations, and the scopes a
// client is granted. ChatGPT asks for `offline_access`; storing that verbatim
// would leave the session without brain.read/brain.write and every tool would
// fail its scope check.

import assert from "node:assert/strict";

import { createApp } from "../src/server.js";
import { grantedScope } from "../src/oauth.js";

async function main() {
  assert.equal(grantedScope(undefined), "brain.read brain.write", "no scope → full default");
  assert.equal(grantedScope("offline_access"), "brain.read brain.write", "only unknown scopes → default");
  assert.equal(grantedScope("brain.read offline_access"), "brain.read", "unknown dropped, known kept");
  assert.equal(grantedScope("brain.read brain.write"), "brain.read brain.write");
  console.log("  scopes: unknown dropped, read-only requests respected, default when none known");

  const srv = createApp().listen(0);
  await new Promise((r) => srv.once("listening", r));
  const port = (srv.address() as import("node:net").AddressInfo).port;
  const base = `http://localhost:${port}`;

  try {
    for (const [p, type] of [["/favicon.ico", "image/png"], ["/favicon.svg", "image/svg+xml"]]) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, `${p} is served`);
      assert.ok(res.headers.get("content-type")?.startsWith(type), `${p} is ${type}`);
      assert.ok((await res.arrayBuffer()).byteLength > 100, `${p} has content`);
    }
    console.log("  favicon: /favicon.ico (png) and /favicon.svg served");

    for (const p of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, `${p} is served`);
      const body = await res.json() as { resource: string; authorization_servers: string[] };
      assert.ok(body.resource.endsWith("/mcp"), `${p} names the /mcp resource`);
      assert.ok(body.authorization_servers.length > 0, `${p} lists an authorization server`);
    }
    console.log("  PRM: served at the root and the path-inserted /mcp location");

    console.log("\n✅ DISCOVERY: brand icon, RFC 9728 metadata at both locations, scope normalization.");
  } finally {
    srv.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
