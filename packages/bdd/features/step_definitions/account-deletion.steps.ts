import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { LmsWorld } from "../support/world";

// Black-box coverage for member account deletion (POST /auth/me/delete,
// GET /auth/me/delete-summary, admin DELETE /members/:id). Every scenario runs
// on a FRESH disposable member so the shared dev DB's seed member is never
// touched. DB-real behaviours (User purge, cascades, Contact tombstoning) are
// asserted through their observable API effects: a purged user can't log in,
// the admin 404s them, the email frees up, an issued certificate's public
// verify link dies, and the member's Contact survives flipped to UNSUBSCRIBED.

const WRONG_PASSWORD = "definitely-not-the-password";

// ---------- disposable member setup ----------

Given(
  "a member has signed up for deletion testing",
  async function (this: LmsWorld) {
    this.delEmail = this.freshDeleteEmail();
    this.delPassword = "delete-test-pass-123"; // >= signup's 10-char minimum
    const r = await this.request("POST", "/auth/signup", {
      token: null,
      body: {
        email: this.delEmail,
        password: this.delPassword,
        firstName: "Deletion",
        lastName: "Probe",
      },
    });
    assert.equal(r.status, 200, `signup failed: ${JSON.stringify(r.body)}`);
    this.delToken = r.body?.token ?? null;
    this.delId = r.body?.user?.id ?? null;
    assert.ok(this.delToken && this.delId, "signup did not return token + user id");
    this.disposableMemberIds.push(this.delId);
  },
);

Given(
  "that member has been granted the {string} level",
  async function (this: LmsWorld, levelId: string) {
    const token = await this.adminToken();
    const r = await this.request("POST", `/members/${this.delId}/levels`, {
      token,
      body: { levelId },
    });
    assert.ok(r.status < 300, `grant failed: ${r.status} ${JSON.stringify(r.body)}`);
  },
);

Given(
  "that member has completed the {string} lesson",
  async function (this: LmsWorld, lessonId: string) {
    const r = await this.request("POST", `/lessons/${lessonId}/complete`, {
      token: this.delToken,
      body: {},
    });
    assert.ok(r.status < 300, `complete failed: ${r.status} ${JSON.stringify(r.body)}`);
  },
);

Given(
  "that member has claimed a certificate for the {string} level",
  async function (this: LmsWorld, levelId: string) {
    const r = await this.request("POST", "/certificates/claim", {
      token: this.delToken,
      body: { levelId },
    });
    assert.ok(r.status < 300, `claim failed: ${r.status} ${JSON.stringify(r.body)}`);
    this.delSerial = r.body?.serial ?? null;
    assert.ok(this.delSerial, "claim did not return a serial");
  },
);

Given(
  "a restricted admin without members-delete permission exists",
  async function (this: LmsWorld) {
    const token = await this.adminToken();
    const email = `bdd-restricted-admin-${Date.now()}-${process.pid}@example.com`;
    const password = "restricted-admin-pass-1";
    const r = await this.request("POST", "/admin/admins", {
      token,
      body: {
        email,
        password,
        superAdmin: false, // a super admin bypasses every permission check
        permissions: { members: { read: true, edit: true, delete: false } },
      },
    });
    assert.equal(r.status, 201, `admin create failed: ${JSON.stringify(r.body)}`);
    this.restrictedAdminId = r.body?.id ?? null;
    const login = await this.request("POST", "/auth/admin/login", {
      body: { email, password },
    });
    assert.equal(login.status, 200, "restricted admin login failed");
    this.restrictedAdminToken = login.body?.token ?? null;
    assert.ok(this.restrictedAdminToken, "no token for restricted admin");
  },
);

// ---------- actions ----------

When(
  "that member requests their account-deletion summary",
  async function (this: LmsWorld) {
    await this.request("GET", "/auth/me/delete-summary", { token: this.delToken });
  },
);

When(
  "that member deletes their account with their password",
  async function (this: LmsWorld) {
    await this.request("POST", "/auth/me/delete", {
      token: this.delToken,
      body: { password: this.delPassword },
    });
  },
);

When(
  "that member deletes their account with the wrong password",
  async function (this: LmsWorld) {
    await this.request("POST", "/auth/me/delete", {
      token: this.delToken,
      body: { password: WRONG_PASSWORD },
    });
  },
);

When("an admin deletes that member", async function (this: LmsWorld) {
  const token = await this.adminToken();
  await this.request("DELETE", `/members/${this.delId}`, { token });
});

When(
  "the restricted admin tries to delete that member",
  async function (this: LmsWorld) {
    await this.request("DELETE", `/members/${this.delId}`, {
      token: this.restrictedAdminToken,
    });
  },
);

// Re-registering the freed email creates a NEW member; track it for cleanup.
When("I register a new account with that email", async function (this: LmsWorld) {
  const r = await this.request("POST", "/auth/signup", {
    token: null,
    body: {
      email: this.delEmail,
      password: "delete-test-pass-456",
      firstName: "Reused",
      lastName: "Email",
    },
  });
  if (r.body?.user?.id) this.disposableMemberIds.push(r.body.user.id);
});

// ---------- assertions ----------

Then("that member's session should be rejected", async function (this: LmsWorld) {
  const r = await this.request("GET", "/auth/me", { token: this.delToken });
  assert.equal(r.status, 401, `expected 401 for a purged member's token, got ${r.status}`);
});

Then(
  "that member should no longer be able to log in",
  async function (this: LmsWorld) {
    const r = await this.login(this.delEmail!, this.delPassword!);
    assert.equal(r.status, 401, `expected login to fail (401), got ${r.status}`);
  },
);

Then(
  "that member should still be able to log in",
  async function (this: LmsWorld) {
    const r = await this.login(this.delEmail!, this.delPassword!);
    assert.equal(r.status, 200, `expected login to still work (200), got ${r.status}`);
  },
);

Then("an admin should not find that member", async function (this: LmsWorld) {
  const token = await this.adminToken();
  const r = await this.request("GET", `/members/${this.delId}`, { token });
  assert.equal(r.status, 404, `expected member to be gone (404), got ${r.status}`);
});

Then(
  "that member's email should be free to register again",
  async function (this: LmsWorld) {
    // A hard delete frees the unique email/username; a soft-disable would 409.
    const r = await this.request("POST", "/auth/signup", {
      token: null,
      body: {
        email: this.delEmail,
        password: "delete-test-pass-789",
        firstName: "Fresh",
        lastName: "Start",
      },
    });
    assert.equal(r.status, 200, `expected re-signup to succeed (200), got ${r.status} ${JSON.stringify(r.body)}`);
    if (r.body?.user?.id) this.disposableMemberIds.push(r.body.user.id);
  },
);

Then(
  "the deletion summary email should be that member's email",
  function (this: LmsWorld) {
    assert.equal(this.last.body?.email, this.delEmail);
  },
);

Then(
  "the deletion summary should report at least {int} completed lesson",
  function (this: LmsWorld, n: number) {
    const c = this.last.body?.completedLessons;
    assert.ok(typeof c === "number" && c >= n, `expected completedLessons >= ${n}, got ${c}`);
  },
);

Then(
  "the deletion summary should list at least {int} certificate",
  function (this: LmsWorld, n: number) {
    const certs = this.last.body?.certificates;
    assert.ok(Array.isArray(certs) && certs.length >= n, `expected >= ${n} certificates, got ${JSON.stringify(certs)}`);
  },
);

Then(
  "that member's certificate serial should no longer verify",
  async function (this: LmsWorld) {
    const r = await this.request(
      "GET",
      `/certificates/verify/${this.delSerial}`,
      { token: null },
    );
    // Verify always 200s; the cascade makes the row (and its serial) unknown.
    assert.equal(r.body?.valid, false, `expected the serial to stop verifying, got ${JSON.stringify(r.body)}`);
  },
);

Then(
  "that member's contact should be tombstoned as unsubscribed",
  async function (this: LmsWorld) {
    const token = await this.adminToken();
    // Locate the single global default audience the signup landed them in.
    const auds = await this.request("GET", "/admin/audiences", { token });
    const def = (auds.body?.items ?? auds.body ?? []).find(
      (a: any) => a.isDefault,
    );
    assert.ok(def?.id, "no default audience found");
    const list = await this.request(
      "GET",
      `/admin/audiences/${def.id}/contacts?q=${encodeURIComponent(this.delEmail!)}`,
      { token },
    );
    const contact = (list.body?.items ?? []).find(
      (c: any) => c.email === this.delEmail,
    );
    assert.ok(contact, "the member's contact was DELETED — it must survive as a suppression tombstone");
    assert.equal(contact.status, "UNSUBSCRIBED", `expected UNSUBSCRIBED, got ${contact.status}`);
    assert.equal(contact.userId, null, "tombstoned contact should have its member link cleared");
  },
);
