import { test } from "node:test";
import assert from "node:assert/strict";
// Relative import — the API's welcome-email path (auth.service.ts) derives the
// connect code the same way, and value imports from @lms/types must be relative
// (the built API can't require the source .ts). See constants.ts header.
import { mobileConnectCode } from "../../../../packages/types/format";

// mobileConnectCode() is the load-bearing bit shared by BOTH member-facing
// surfaces (the account-page card and the welcome email): the connect code is
// the site's leading DNS label, or null when none can be inferred (callers then
// fall back to the site address).

test("derives the leading label as the code (both fleet schemes)", () => {
  // custom-domain scheme: <code>.<domain>
  assert.equal(mobileConnectCode("https://demo.thewebpaanda.com"), "demo");
  // fleet subdomain scheme: <code>.app.<domain>
  assert.equal(
    mobileConnectCode("https://solitaire-web-solution.app.thewebpaanda.com"),
    "solitaire-web-solution",
  );
  // trailing path / port don't matter — only the hostname's first label
  assert.equal(
    mobileConnectCode("https://acme-academy.app.x.com/account"),
    "acme-academy",
  );
});

test("returns null for infra subdomains (never a code)", () => {
  for (const host of ["api", "admin", "www", "app"]) {
    assert.equal(mobileConnectCode(`https://${host}.thewebpaanda.com`), null);
  }
});

test("returns null when no code can be inferred (custom apex / localhost / bad input)", () => {
  assert.equal(mobileConnectCode("https://acme.com"), null); // 2 labels = apex/custom
  assert.equal(mobileConnectCode("http://localhost:3002"), null);
  assert.equal(mobileConnectCode("not a url"), null);
  assert.equal(mobileConnectCode(""), null);
  assert.equal(mobileConnectCode(null), null);
  assert.equal(mobileConnectCode(undefined), null);
});

test("is case-insensitive on the host", () => {
  assert.equal(mobileConnectCode("https://Demo.TheWebPaanda.com"), "demo");
});
