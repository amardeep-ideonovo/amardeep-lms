import { Given, When, Then } from "@cucumber/cucumber";
import * as assert from "assert";
import { LmsWorld } from "../support/world";
import { decodeQuotedPrintable } from "../support/smtp-catcher";

// End-to-end member password reset. A FRESH member (via public signup) is
// used instead of the seeded member@example.com so a passing run never
// changes the credentials every other scenario logs in with.

Given(
  "a fresh member exists with password {string}",
  async function (this: LmsWorld, password: string) {
    const email = `bdd-reset-${Date.now()}-${process.pid}@example.com`;
    const r = await this.request("POST", "/auth/signup", {
      token: null,
      body: { email, password, firstName: "BDD", lastName: "Reset" },
    });
    assert.equal(r.status, 200, `signup failed: ${JSON.stringify(r.body)}`);
    this.resetMemberEmail = email;
    this.resetMemberPassword = password;
  },
);

When(
  "I request a password reset for that member",
  async function (this: LmsWorld) {
    assert.ok(this.resetMemberEmail, "no fresh member in this scenario");
    await this.request("POST", "/auth/forgot-password", {
      token: null,
      body: { email: this.resetMemberEmail },
    });
  },
);

Then(
  "a password-reset email is captured for that member",
  async function (this: LmsWorld) {
    assert.ok(this.smtpCatcher, "scenario is missing the @email-capture tag");
    const email = this.resetMemberEmail!;
    // The signup in the Given step also lands a WELCOME mail for this member
    // in the catcher, so match on the reset link, not just the recipient.
    // Decode inside the predicate too: quoted-printable soft breaks can split
    // the URL across lines and '=' arrives as '=3D'.
    const mail = await this.smtpCatcher!.waitForMessage(
      (m) =>
        m.to.some((rcpt) => rcpt.toLowerCase().includes(email)) &&
        decodeQuotedPrintable(m.data).includes("/reset-password?token="),
    );
    const decoded = decodeQuotedPrintable(mail.data);
    const match = decoded.match(/\/reset-password\?token=([A-Za-z0-9_.-]+)/);
    assert.ok(
      match,
      `captured mail has no reset link; payload starts: ${decoded.slice(0, 400)}`,
    );
    this.resetToken = match![1];
  },
);

When(
  "I reset the password using the emailed token to {string}",
  async function (this: LmsWorld, newPassword: string) {
    assert.ok(this.resetToken, "no reset token captured yet");
    await this.request("POST", "/auth/reset-password", {
      token: null,
      body: { token: this.resetToken, newPassword },
    });
  },
);

Then(
  "logging in as that member with {string} fails with 401",
  async function (this: LmsWorld, password: string) {
    const r = await this.login(this.resetMemberEmail!, password);
    assert.equal(r.status, 401, `expected 401, got ${r.status}`);
  },
);

Then(
  "logging in as that member with {string} succeeds",
  async function (this: LmsWorld, password: string) {
    const r = await this.login(this.resetMemberEmail!, password);
    assert.equal(
      r.status,
      200,
      `expected 200, got ${r.status} (${JSON.stringify(r.body)})`,
    );
    assert.ok(typeof r.body?.token === "string", "login returned no JWT");
  },
);

// Single-use guarantee: the reset changed the password hash, so the token's
// hash fingerprint no longer matches and the same link must now be rejected.
Then(
  "reusing the same reset token returns 400",
  async function (this: LmsWorld) {
    const r = await this.request("POST", "/auth/reset-password", {
      token: null,
      body: { token: this.resetToken, newPassword: "another-new-pass-789" },
    });
    assert.equal(r.status, 400, `expected 400, got ${r.status}`);
  },
);

Then("the response should include ok true", function (this: LmsWorld) {
  assert.equal(
    this.last.body?.ok,
    true,
    `expected { ok: true }, got: ${JSON.stringify(this.last.body)}`,
  );
});
