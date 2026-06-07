// Security regression: the open endpoints are per-IP rate limited. /register
// (unauthenticated dynamic client registration) is the tightest — 10/min — so the
// 11th request in a window must be rejected with 429, not accepted.

import assert from "node:assert/strict";

import { createApp } from "../src/server.js";

async function main() {
  const srv = createApp().listen(0);
  await new Promise((r) => srv.once("listening", r));
  const port = (srv.address() as import("node:net").AddressInfo).port;
  const base = `http://localhost:${port}`;

  try {
    const register = () => fetch(`${base}/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }),
    });

    let limited = 0, ok = 0;
    for (let i = 0; i < 12; i++) {
      const res = await register();
      if (res.status === 429) limited++;
      else if (res.status === 201) ok++;
    }
    assert.equal(ok, 10, "first 10 registrations succeed");
    assert.ok(limited >= 1, "excess registrations are rate-limited (429)");
    console.log(`  /register → ${ok} ok, ${limited} rate-limited (429)`);
    console.log("\n✅ RATE LIMIT: open DCR endpoint is throttled per IP.");
  } finally {
    srv.close();
  }
}

main().catch((e) => { console.error("\n❌ rate limit test failed:", e); process.exit(1); });
