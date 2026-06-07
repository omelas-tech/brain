// Minimal in-memory fixed-window rate limiter (no dependency).
//
// The connector's OAuth + MCP endpoints were previously unthrottled, so anyone
// could flood /register (open DCR), /authorize, /token, or /mcp. This caps
// per-IP request rate and self-prunes so the limiter's own map stays bounded.
// `app.set("trust proxy", "loopback")` means req.ip is the real client IP behind
// the local reverse proxy.

import type { Request, Response, NextFunction } from "express";

export function rateLimit(opts: { windowMs: number; max: number; key?: (req: Request) => string }) {
  const hits = new Map<string, { count: number; reset: number }>();
  const keyOf = opts.key ?? ((req: Request) => req.ip || "unknown");
  let lastSweep = 0;

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();

    // Amortized O(n)-once-per-window cleanup so unique IPs don't accumulate.
    if (now - lastSweep > opts.windowMs) {
      for (const [k, e] of hits) if (e.reset <= now) hits.delete(k);
      lastSweep = now;
    }

    const k = keyOf(req);
    let e = hits.get(k);
    if (!e || e.reset <= now) { e = { count: 0, reset: now + opts.windowMs }; hits.set(k, e); }
    e.count++;
    if (e.count > opts.max) {
      res.set("Retry-After", String(Math.ceil((e.reset - now) / 1000))).status(429).json({ error: "rate_limited" });
      return;
    }
    next();
  };
}
