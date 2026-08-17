import { test } from "node:test";
import assert from "node:assert/strict";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import type { JwtService } from "@nestjs/jwt";
import { PreviewReadOnlyGuard } from "./preview-read-only.guard";
import type { JwtPayload } from "../auth/jwt-payload.interface";

// PreviewReadOnlyGuard makes admin "preview member" sessions strictly read-only:
// any state-changing verb carrying a preview JWT is 403'd, while everything else
// (safe verbs, real members, absent/forged tokens) passes through so the route's
// own JWT guard still runs.

// A JwtService stub: `verify` returns the payload keyed by the token string, or
// throws for the sentinel "bad" token (mimicking a malformed/expired JWT).
function fakeJwt(payloads: Record<string, JwtPayload>): JwtService {
  return {
    verify: (token: string) => {
      if (token === "bad") throw new Error("invalid token");
      return payloads[token];
    },
  } as unknown as JwtService;
}

function httpCtx(method: string, authorization?: string): ExecutionContext {
  return {
    getType: () => "http",
    switchToHttp: () => ({
      getRequest: () => ({ method, headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}

const preview: JwtPayload = {
  sub: "u_prev",
  email: "p@preview.invalid",
  isAdmin: false,
  isPreview: true,
};
const member: JwtPayload = {
  sub: "u_real",
  email: "m@example.com",
  isAdmin: false,
};

test("write verb + preview token → 403", () => {
  const guard = new PreviewReadOnlyGuard(fakeJwt({ tok: preview }));
  assert.throws(
    () => guard.canActivate(httpCtx("POST", "Bearer tok")),
    ForbiddenException,
  );
});

test("write verb + real member token → allowed", () => {
  const guard = new PreviewReadOnlyGuard(fakeJwt({ tok: member }));
  assert.equal(guard.canActivate(httpCtx("POST", "Bearer tok")), true);
});

test("GET is always allowed, even with a preview token", () => {
  const guard = new PreviewReadOnlyGuard(fakeJwt({ tok: preview }));
  assert.equal(guard.canActivate(httpCtx("GET", "Bearer tok")), true);
});

test("write verb with NO token → passthrough (route guard 401s)", () => {
  const guard = new PreviewReadOnlyGuard(fakeJwt({}));
  assert.equal(guard.canActivate(httpCtx("POST")), true);
});

test("write verb with a malformed/expired token → passthrough", () => {
  const guard = new PreviewReadOnlyGuard(fakeJwt({}));
  assert.equal(guard.canActivate(httpCtx("POST", "Bearer bad")), true);
});

test("non-http contexts are ignored", () => {
  const guard = new PreviewReadOnlyGuard(fakeJwt({}));
  const wsCtx = { getType: () => "ws" } as unknown as ExecutionContext;
  assert.equal(guard.canActivate(wsCtx), true);
});
