import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthController } from "./auth.controller";

// Pins the throttle-enforcement SHAPE on the auth routes (2026-08-25):
//
//  1. Every sensitive unauthenticated route carries a @Throttle override —
//     that metadata is what the global GlobalThrottlerGuard enforces, keyed
//     on the real client IP (ProxyAwareThrottlerGuard).
//  2. NO route re-attaches a ThrottlerGuard via @UseGuards. A per-route
//     throttler on top of the global APP_GUARD evaluates the same throttler
//     name against the same context and tracker, so the same storage key is
//     incremented twice per request and the route's limit silently halves
//     (observed live: 429 on the 3rd of a 5-limit). The pre-fix shape was
//     worse still — the stock per-route guard keyed on bare req.ip, which
//     behind Caddy fused a whole academy into one shared login bucket.

const THROTTLED_ROUTES = [
  "memberLogin",
  "adminLogin",
  "memberSignup",
  "forgotPassword",
  "resetPassword",
  "changePassword",
  "changeAdminPassword",
] as const;

function handler(name: string): object {
  const fn = (AuthController.prototype as Record<string, unknown>)[name];
  assert.equal(typeof fn, "function", `handler ${name} exists`);
  return fn as object;
}

test("every sensitive auth route carries a @Throttle override", () => {
  for (const name of THROTTLED_ROUTES) {
    const keys = Reflect.getMetadataKeys(handler(name)) as unknown[];
    assert.ok(
      keys.some((k) => String(k).toUpperCase().includes("THROTTLER")),
      `${name} must carry @Throttle metadata (the global guard enforces it)`,
    );
  }
});

test("no auth route re-attaches a ThrottlerGuard (double-count = halved limit)", () => {
  for (const name of THROTTLED_ROUTES) {
    const guards = (Reflect.getMetadata("__guards__", handler(name)) ??
      []) as Array<{ name?: string }>;
    const throttlers = guards.filter((g) => /Throttler/i.test(g?.name ?? ""));
    assert.deepEqual(
      throttlers,
      [],
      `${name} must not carry a route-level throttler guard on top of the global APP_GUARD`,
    );
  }
});
