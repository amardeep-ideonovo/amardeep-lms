import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify as apiSlugify } from "./slugify";
import { slugify as typesSlugify } from "@lms/types";

// The API's server-side slugify (apps/api/src/common/slugify.ts) MUST stay
// byte-identical to the client-side one in @lms/types (the admin's live
// slug-autofill), so a class/course URL the admin previews matches exactly what
// the server stores. The two live in different packages for a runtime reason
// (the built API can't require @lms/types), so this test is the guard against
// drift — change either implementation in a way that diverges and this fails.
//
// (This spec runs under ts-node, which resolves @lms/types to source — unlike
// the BUILT API, which is why the server copy exists in the first place.)
const CASES = [
  "Modern Science 101!",
  "  Héllo Wörld  ",
  "Café & Crème",
  "already-a-slug",
  "UPPER  MULTI___spaces",
  "!!!",
  "Yoga—Flow",
  "",
  "a.b.c",
  "Ünïcödé Diàcrïtïcs",
  "trailing---dashes---",
  "MiXeD_CaSe with-Punctuation!?",
  "日本語 mixed 123",
];

test("API slugify is byte-identical to the @lms/types (client) slugify", () => {
  for (const input of CASES) {
    assert.equal(
      apiSlugify(input),
      typesSlugify(input),
      `slugify diverged for input ${JSON.stringify(input)}`,
    );
  }
});
