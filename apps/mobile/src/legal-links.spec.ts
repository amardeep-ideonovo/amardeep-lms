import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveLegalLinks,
  resolveLegalUrl,
  resolvePlatformPrivacyUrl,
} from "./legal-links";

const SITE = "https://evergreen.app.thewebpaanda.com";
const DIRECTORY = "https://thewebpaanda.com";

test("connected: the academy's AppConfig override wins, absolute or relative", () => {
  assert.deepEqual(
    resolveLegalLinks(SITE, {
      privacyUrl: "https://policies.example.com/privacy",
      termsUrl: "/legal/terms",
    }),
    {
      privacy: "https://policies.example.com/privacy",
      terms: `${SITE}/legal/terms`,
    },
  );
});

test("connected: with no override, the academy's own seeded pages are used", () => {
  assert.deepEqual(resolveLegalLinks(`${SITE}/`, undefined), {
    privacy: `${SITE}/privacy`,
    terms: `${SITE}/terms`,
  });
  assert.deepEqual(
    resolveLegalLinks(SITE, { privacyUrl: null, termsUrl: null }),
    {
      privacy: `${SITE}/privacy`,
      terms: `${SITE}/terms`,
    },
  );
});

test("not connected: no academy links at all — never the platform's B2B pages", () => {
  assert.equal(resolveLegalLinks("", undefined), null);
  // a relative override is unusable without a bound site
  assert.equal(
    resolveLegalLinks("", { privacyUrl: "/privacy", termsUrl: "/terms" }),
    null,
  );
});

test("resolveLegalUrl rejects anything that is not absolute http(s) or a bound /path", () => {
  assert.equal(resolveLegalUrl("javascript:alert(1)", SITE), null);
  assert.equal(resolveLegalUrl("privacy", SITE), null);
  assert.equal(resolveLegalUrl(undefined, SITE), null);
  assert.equal(resolveLegalUrl("/privacy", ""), null);
  assert.equal(resolveLegalUrl("HTTPS://x.test/p", ""), "HTTPS://x.test/p");
});

test("pre-connect: the platform's MEMBER-facing privacy page, trailing slash tolerated", () => {
  assert.equal(
    resolvePlatformPrivacyUrl(DIRECTORY),
    `${DIRECTORY}/app/privacy`,
  );
  assert.equal(
    resolvePlatformPrivacyUrl(`${DIRECTORY}/`),
    `${DIRECTORY}/app/privacy`,
  );
});

test("pre-connect: locked / white-label builds have no directory → no link", () => {
  assert.equal(resolvePlatformPrivacyUrl(""), null);
});
