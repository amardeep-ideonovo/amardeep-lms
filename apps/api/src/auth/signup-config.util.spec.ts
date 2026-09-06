import { test } from "node:test";
import assert from "node:assert/strict";
import { requiredInviteCode, signupRequiresInvite } from "./signup-config.util";

// Covers the logic behind GET /auth/signup-config (the endpoint returns
// { inviteRequired: signupRequiresInvite() }) AND the matching gate in
// AuthService.signupMember (which uses requiredInviteCode()). Both read the
// same env var via this helper, so testing it locks in that the invite field
// is shown/enforced in exactly the same states. Env is passed explicitly so we
// never mutate the real process.env.

test("gate OFF when SIGNUP_INVITE_CODE is unset", () => {
  assert.equal(signupRequiresInvite({}), false);
  assert.equal(requiredInviteCode({}), undefined);
});

test("gate OFF when the value is empty or whitespace-only", () => {
  for (const v of ["", "   ", "\t", "\n "]) {
    assert.equal(
      signupRequiresInvite({ SIGNUP_INVITE_CODE: v }),
      false,
      `"${v}" must not enable the gate`,
    );
    assert.equal(requiredInviteCode({ SIGNUP_INVITE_CODE: v }), undefined);
  }
});

test("gate ON when set to a non-empty value", () => {
  assert.equal(signupRequiresInvite({ SIGNUP_INVITE_CODE: "beta2026" }), true);
  assert.equal(requiredInviteCode({ SIGNUP_INVITE_CODE: "beta2026" }), "beta2026");
});

test("the required code is trimmed (matches signupMember's dto.inviteCode.trim())", () => {
  assert.equal(
    requiredInviteCode({ SIGNUP_INVITE_CODE: "  beta2026 " }),
    "beta2026",
  );
  assert.equal(signupRequiresInvite({ SIGNUP_INVITE_CODE: "  beta2026 " }), true);
});
