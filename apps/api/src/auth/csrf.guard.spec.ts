import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CsrfGuard } from "./csrf.guard";
import { SKIP_CSRF_KEY } from "./skip-csrf.decorator";

// The CSRF guard protects ONLY cookie-authenticated unsafe requests (the web
// member session). It must be a no-op for safe methods, Bearer clients
// (mobile/admin/bdd), requests with no session cookie (public/webhooks), and
// routes explicitly marked @SkipCsrf() (login/signup/forgot/reset) — otherwise
// it would break those.

// The guard reads @SkipCsrf() metadata off the route handler/class via the
// Reflector, so the fake context must expose getHandler/getClass (real objects,
// since Reflect.getMetadata is called on them).
function ctxFor(
  req: unknown,
  handler: object = {},
  cls: object = {},
): ExecutionContext {
  return {
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => cls,
  } as unknown as ExecutionContext;
}

const guard = new CsrfGuard(new Reflector());

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

test("a @SkipCsrf() route is exempt even with a session cookie and no header", () => {
  // Session-bootstrap routes (login/signup/forgot/reset) opt out, so a stale
  // session cookie can't deadlock re-authentication.
  const handler = () => {};
  Reflect.defineMetadata(SKIP_CSRF_KEY, true, handler);
  const ctx = ctxFor(
    { method: "POST", headers: { cookie: "lms_session=t; csrf_token=abc123" } },
    handler,
  );
  assert.equal(guard.canActivate(ctx), true);
});

test("non-http contexts are ignored", () => {
  const ctx = {
    getType: () => "ws",
  } as unknown as ExecutionContext;
  assert.equal(guard.canActivate(ctx), true);
});
