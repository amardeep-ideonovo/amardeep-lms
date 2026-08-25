import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExecutionContext } from "@nestjs/common";
import { GlobalThrottlerGuard } from "./global-throttler.guard";

// Regression guard for the WebSocket crash: registered as a global APP_GUARD,
// this throttler is also attached to WebSocket gateway (@SubscribeMessage)
// handlers. The base ThrottlerGuard resolves the response via switchToHttp() and
// calls res.header(...), which throws on a ws context (getResponse() returns the
// @MessageBody payload, not an HTTP response). shouldSkip() must bail out of
// every non-http execution context so the realtime gateway keeps working; it
// must NOT skip http (or the whole rate limiter would be a no-op).

function ctx(type: string): ExecutionContext {
  return { getType: () => type } as unknown as ExecutionContext;
}

// shouldSkip only reads context.getType(), so a prototype instance (no ctor,
// which would need options/storage/reflector) is enough to exercise it.
function shouldSkip(context: ExecutionContext): Promise<boolean> {
  const g = Object.create(GlobalThrottlerGuard.prototype) as {
    shouldSkip(c: ExecutionContext): Promise<boolean>;
  };
  return g.shouldSkip(context);
}

test("shouldSkip: skips websocket contexts (no res.header crash)", async () => {
  assert.equal(await shouldSkip(ctx("ws")), true);
});

test("shouldSkip: skips rpc/microservice contexts", async () => {
  assert.equal(await shouldSkip(ctx("rpc")), true);
});

test("shouldSkip: still throttles http requests", async () => {
  assert.equal(await shouldSkip(ctx("http")), false);
});

// ---- getTracker: the real-client keying every per-IP limit shares ----------
//
// Regression guard for the 2026-08-25 login-lockout finding: behind Caddy
// req.ip is the proxy's address for EVERY visitor, so a req.ip-keyed throttle
// fuses the whole academy into one bucket — 5 stranger requests a minute
// 429-locked login/signup/reset for everyone. The tracker must key on the
// RIGHTMOST X-Forwarded-For entry (the one the trusted proxy appends), which
// a client cannot forge through the proxy: their own header only ever ends up
// LEFT of the entry Caddy adds.

import { ProxyAwareThrottlerGuard } from "./proxy-aware-throttler.guard";

function getTracker(req: Record<string, unknown>): Promise<string> {
  const g = Object.create(ProxyAwareThrottlerGuard.prototype) as {
    getTracker(r: Record<string, unknown>): Promise<string>;
  };
  return g.getTracker(req);
}

test("getTracker: two clients behind the proxy get DIFFERENT buckets", async () => {
  const a = await getTracker({
    ip: "172.18.0.9", // the Caddy container — identical for both
    headers: { "x-forwarded-for": "203.0.113.7" },
  });
  const b = await getTracker({
    ip: "172.18.0.9",
    headers: { "x-forwarded-for": "198.51.100.4" },
  });
  assert.notEqual(a, b);
  assert.equal(a, "203.0.113.7");
  assert.equal(b, "198.51.100.4");
});

test("getTracker: rightmost XFF wins — a spoofed header cannot rotate buckets", async () => {
  // The attacker sends `X-Forwarded-For: 6.6.6.6`; Caddy APPENDS the real
  // peer. Whatever they fabricate, the rightmost (proxy-appended) entry is
  // still their actual address — same bucket every time.
  const spoofed = await getTracker({
    ip: "172.18.0.9",
    headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.7" },
  });
  const honest = await getTracker({
    ip: "172.18.0.9",
    headers: { "x-forwarded-for": "203.0.113.7" },
  });
  assert.equal(spoofed, "203.0.113.7");
  assert.equal(spoofed, honest);
});

test("getTracker: falls back to x-real-ip, then req.ip, then 'anon'", async () => {
  assert.equal(
    await getTracker({
      ip: "10.0.0.5",
      headers: { "x-real-ip": " 203.0.113.9 " },
    }),
    "203.0.113.9",
  );
  assert.equal(await getTracker({ ip: "10.0.0.5", headers: {} }), "10.0.0.5");
  assert.equal(await getTracker({ headers: {} }), "anon");
  // Degenerate header shapes must not throw or return an empty key.
  assert.equal(
    await getTracker({
      ip: "10.0.0.5",
      headers: { "x-forwarded-for": " , ," },
    }),
    "10.0.0.5",
  );
});

test("GlobalThrottlerGuard inherits the proxy-aware keying (one tracker everywhere)", () => {
  assert.ok(GlobalThrottlerGuard.prototype instanceof ProxyAwareThrottlerGuard);
});
