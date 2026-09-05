import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import {
  CSRF_COOKIE,
  HINT_COOKIE,
  SESSION_COOKIE,
  clearAuthCookies,
  parseCookies,
  readCookie,
  setAuthCookies,
} from "./cookie.util";

test("parseCookies handles spacing, encoding, and missing values", () => {
  assert.deepEqual(parseCookies("a=1; b=2"), { a: "1", b: "2" });
  assert.deepEqual(parseCookies("x=%20sp%20"), { x: " sp " });
  assert.deepEqual(parseCookies(undefined), {});
  // a valueless flag is skipped, a real pair beside it survives
  assert.deepEqual(parseCookies("flag; k=v"), { k: "v" });
});

test("readCookie pulls one cookie from the request Cookie header", () => {
  const req = {
    headers: { cookie: `${SESSION_COOKIE}=jwt.here; other=1` },
  } as unknown as Request;
  assert.equal(readCookie(req, SESSION_COOKIE), "jwt.here");
  assert.equal(readCookie(req, "missing"), null);
  assert.equal(readCookie({ headers: {} } as Request, SESSION_COOKIE), null);
});

// Capture res.cookie/clearCookie calls with a fake Response.
function fakeRes() {
  const set: Array<{
    name: string;
    value: string;
    opts: Record<string, unknown>;
  }> = [];
  const cleared: Array<{ name: string; opts: Record<string, unknown> }> = [];
  const res = {
    cookie(name: string, value: string, opts: Record<string, unknown>) {
      set.push({ name, value, opts });
      return this;
    },
    clearCookie(name: string, opts: Record<string, unknown>) {
      cleared.push({ name, opts });
      return this;
    },
  } as unknown as Response;
  return { res, set, cleared };
}

test("setAuthCookies makes the session httpOnly and the hint/csrf readable", () => {
  const { res, set } = fakeRes();
  setAuthCookies(res, "the.jwt.token");

  const session = set.find((c) => c.name === SESSION_COOKIE);
  const csrf = set.find((c) => c.name === CSRF_COOKIE);
  const hint = set.find((c) => c.name === HINT_COOKIE);

  assert.ok(session && csrf && hint, "all three cookies are set");
  assert.equal(session!.value, "the.jwt.token");
  assert.equal(session!.opts.httpOnly, true, "session JWT is httpOnly");
  assert.equal(csrf!.opts.httpOnly, false, "csrf token must be JS-readable");
  assert.equal(hint!.opts.httpOnly, false, "hint must be JS-readable");
  // Same-site lax + a positive maxAge, on all three.
  for (const c of [session!, csrf!, hint!]) {
    assert.equal(c.opts.sameSite, "lax");
    assert.equal(c.opts.path, "/");
    assert.ok((c.opts.maxAge as number) > 0);
  }
  // The csrf token is a fresh random value, not the JWT.
  assert.notEqual(csrf!.value, session!.value);
  assert.ok(csrf!.value.length >= 32);
});

test("clearAuthCookies clears all three", () => {
  const { res, cleared } = fakeRes();
  clearAuthCookies(res);
  const names = cleared.map((c) => c.name).sort();
  assert.deepEqual(names, [CSRF_COOKIE, HINT_COOKIE, SESSION_COOKIE].sort());
});
