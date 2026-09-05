import { test } from "node:test";
import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { CsrfGuard } from "./csrf.guard";

// The CSRF guard protects ONLY cookie-authenticated unsafe requests (the web
// member session). It must be a no-op for safe methods, Bearer clients
// (mobile/admin/bdd), and requests with no session cookie (public/webhooks) —
// otherwise it would break those.

function ctxFor(req: unknown): ExecutionContext {
  return {
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const guard = new CsrfGuard();

test("GET is always allowed (safe method)", () => {
  const ctx = ctxFor({ method: "GET", headers: { cookie: "lms_session=t" } });
  assert.equal(guard.canActivate(ctx), true);
});

test("Bearer-authenticated POST is exempt (mobile/admin/bdd)", () => {
  const ctx = ctxFor({
    method: "POST",
    headers: { authorization: "Bearer abc", cookie: "lms_session=t" },
  });
  assert.equal(guard.canActivate(ctx), true);
});

test("POST with no session cookie is exempt (public route / webhook)", () => {
  const ctx = ctxFor({ method: "POST", headers: {} });
  assert.equal(guard.canActivate(ctx), true);
});

test("cookie-authed POST with matching double-submit token passes", () => {
  const ctx = ctxFor({
    method: "POST",
    headers: {
      cookie: "lms_session=t; csrf_token=abc123",
      "x-csrf-token": "abc123",
    },
  });
  assert.equal(guard.canActivate(ctx), true);
});

test("cookie-authed POST with a MISSING csrf header is rejected", () => {
  const ctx = ctxFor({
    method: "POST",
    headers: { cookie: "lms_session=t; csrf_token=abc123" },
  });
  assert.throws(() => guard.canActivate(ctx), ForbiddenException);
});

test("cookie-authed POST with a MISMATCHED csrf token is rejected", () => {
  const ctx = ctxFor({
    method: "POST",
    headers: {
      cookie: "lms_session=t; csrf_token=abc123",
      "x-csrf-token": "WRONG",
    },
  });
  assert.throws(() => guard.canActivate(ctx), ForbiddenException);
});

test("non-http contexts are ignored", () => {
  const ctx = {
    getType: () => "ws",
  } as unknown as ExecutionContext;
  assert.equal(guard.canActivate(ctx), true);
});
