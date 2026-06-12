import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { LmsWorld } from "../support/world";

// ---------- auth / requests ----------

When(
  "I log in as {string} with password {string}",
  async function (this: LmsWorld, email: string, password: string) {
    await this.login(email, password);
  },
);

When(
  "I GET {string} without a token",
  async function (this: LmsWorld, path: string) {
    await this.request("GET", path, { token: null });
  },
);

Given("I am logged in as the member", async function (this: LmsWorld) {
  await this.ensureMemberLoggedIn();
});

When("I GET {string}", async function (this: LmsWorld, path: string) {
  await this.request("GET", path, { token: this.memberToken });
});

When(
  "I POST {string} with body:",
  async function (this: LmsWorld, path: string, docString: string) {
    await this.request("POST", path, {
      token: this.memberToken,
      body: JSON.parse(docString),
    });
  },
);

// ---------- admin state setup ----------

Given(
  "the admin has granted the {string} level to the member",
  async function (this: LmsWorld, levelId: string) {
    const token = await this.adminToken();
    const id = await this.memberId();
    await this.request("POST", `/members/${id}/levels`, {
      token,
      body: { levelId },
    });
  },
);

Given(
  "the admin has revoked the {string} level from the member",
  async function (this: LmsWorld, levelId: string) {
    const token = await this.adminToken();
    const id = await this.memberId();
    // DELETE is idempotent enough for setup: 200 when present, 404/200 otherwise.
    await this.request("DELETE", `/members/${id}/levels/${levelId}`, { token });
  },
);

// ---------- assertions ----------

Then(
  "the response status should be {int}",
  function (this: LmsWorld, expected: number) {
    assert.equal(
      this.last.status,
      expected,
      `expected ${expected} but got ${this.last.status} (body: ${JSON.stringify(this.last.body)})`,
    );
  },
);

Then("the response should include a token", function (this: LmsWorld) {
  assert.ok(
    this.last.body && typeof this.last.body.token === "string",
    `expected a token in response, got: ${JSON.stringify(this.last.body)}`,
  );
});

function findCourse(world: LmsWorld, title: string): any {
  const cats = world.last.body?.categories ?? [];
  for (const c of cats) {
    const match = (c.courses ?? []).find((x: any) => x.title === title);
    if (match) return match;
  }
  return undefined;
}

Then(
  "the course {string} should be locked",
  function (this: LmsWorld, title: string) {
    const course = findCourse(this, title);
    assert.ok(course, `course "${title}" not found in dashboard`);
    assert.equal(course.locked, true, `expected "${title}" to be locked`);
  },
);

Then(
  "the course {string} should be unlocked",
  function (this: LmsWorld, title: string) {
    const course = findCourse(this, title);
    assert.ok(course, `course "${title}" not found in dashboard`);
    assert.equal(course.locked, false, `expected "${title}" to be unlocked`);
  },
);

// ---------- blog ----------

When(
  "I POST {string} without a token and body:",
  async function (this: LmsWorld, path: string, docString: string) {
    await this.request("POST", path, {
      token: null,
      body: JSON.parse(docString),
    });
  },
);

// Signup needs a never-seen email: the suite runs against a long-lived dev DB
// (only CI gets a fresh one), so a fixed address 409s on every rerun.
When(
  "I sign up with a fresh unique email",
  async function (this: LmsWorld) {
    await this.request("POST", "/auth/signup", {
      token: null,
      body: {
        email: `bdd-signup-${Date.now()}-${process.pid}@example.com`,
        password: "strongpass123",
        firstName: "BDD",
        lastName: "Signup",
      },
    });
  },
);

When(
  "I POST {string} with an admin token and body:",
  async function (this: LmsWorld, path: string, docString: string) {
    const token = await this.adminToken();
    await this.request("POST", path, { token, body: JSON.parse(docString) });
    // Track created content so the After hook can delete it — scenario rows
    // otherwise pile up in the shared dev DB (and PUBLISHED ones go live).
    const id = this.last.body?.id ?? null;
    if (path === "/admin/blog/posts") this.createdPostId = id;
    if (path === "/admin/pages") this.createdPageId = id;
  },
);

Then(
  "the response should include a post with slug {string}",
  function (this: LmsWorld, slug: string) {
    const body = this.last.body;
    assert.ok(
      Array.isArray(body),
      `expected an array, got: ${JSON.stringify(body)}`,
    );
    assert.ok(
      body.some((p: any) => p?.slug === slug),
      `expected a post with slug "${slug}" in the list`,
    );
  },
);

Then(
  "the response should not include a post with slug {string}",
  function (this: LmsWorld, slug: string) {
    const body = this.last.body;
    assert.ok(
      Array.isArray(body),
      `expected an array, got: ${JSON.stringify(body)}`,
    );
    assert.ok(
      !body.some((p: any) => p?.slug === slug),
      `did not expect a post with slug "${slug}" in the list`,
    );
  },
);

// ---------- pages (CMS / Puck) ----------

Then(
  "the response should include a page with slug {string}",
  function (this: LmsWorld, slug: string) {
    const body = this.last.body;
    assert.ok(
      Array.isArray(body),
      `expected an array, got: ${JSON.stringify(body)}`,
    );
    assert.ok(
      body.some((p: any) => p?.slug === slug),
      `expected a page with slug "${slug}" in the list`,
    );
  },
);

Then(
  "the response should not include a page with slug {string}",
  function (this: LmsWorld, slug: string) {
    const body = this.last.body;
    assert.ok(
      Array.isArray(body),
      `expected an array, got: ${JSON.stringify(body)}`,
    );
    assert.ok(
      !body.some((p: any) => p?.slug === slug),
      `did not expect a page with slug "${slug}" in the list`,
    );
  },
);

// ---------- forms (Mailchimp-linked) ----------

When(
  "I create a form via admin with body:",
  async function (this: LmsWorld, docString: string) {
    const token = await this.adminToken();
    await this.request("POST", "/admin/forms", {
      token,
      body: JSON.parse(docString),
    });
    this.formId = this.last.body?.id ?? null;
  },
);

When("I GET the created form without a token", async function (this: LmsWorld) {
  await this.request("GET", `/forms/${this.formId}`, { token: null });
});

When(
  "I submit the created form without a token and body:",
  async function (this: LmsWorld, docString: string) {
    await this.request("POST", `/forms/${this.formId}/submit`, {
      token: null,
      body: JSON.parse(docString),
    });
  },
);

Then(
  'the response "mailchimpStatus" should be {string}',
  function (this: LmsWorld, expected: string) {
    assert.equal(
      this.last.body?.mailchimpStatus,
      expected,
      `expected mailchimpStatus "${expected}" but got ${JSON.stringify(this.last.body)}`,
    );
  },
);

// ---------- popups (Puck overlay) ----------

When(
  "I create a popup via admin with body:",
  async function (this: LmsWorld, docString: string) {
    const token = await this.adminToken();
    await this.request("POST", "/admin/popups", {
      token,
      body: JSON.parse(docString),
    });
    this.popupId = this.last.body?.id ?? null;
  },
);

When(
  "I GET active popups for the dashboard without a token",
  async function (this: LmsWorld) {
    await this.request("GET", "/popups/active?context=dashboard", {
      token: null,
    });
  },
);

When(
  "I GET active popups for page {string} without a token",
  async function (this: LmsWorld, pageId: string) {
    await this.request(
      "GET",
      `/popups/active?context=page&pageId=${encodeURIComponent(pageId)}`,
      { token: null },
    );
  },
);

// Member-area surfaces beyond the dashboard (classes / courses / lessons).
When(
  "I GET active popups for context {string} without a token",
  async function (this: LmsWorld, context: string) {
    await this.request(
      "GET",
      `/popups/active?context=${encodeURIComponent(context)}`,
      { token: null },
    );
  },
);

Then(
  "the response should include the created popup",
  function (this: LmsWorld) {
    const body = this.last.body;
    assert.ok(
      Array.isArray(body),
      `expected an array, got: ${JSON.stringify(body)}`,
    );
    assert.ok(
      body.some((p: any) => p?.id === this.popupId),
      `expected the created popup "${this.popupId}" in the list`,
    );
  },
);

Then(
  "the response should not include the created popup",
  function (this: LmsWorld) {
    const body = this.last.body;
    assert.ok(
      Array.isArray(body),
      `expected an array, got: ${JSON.stringify(body)}`,
    );
    assert.ok(
      !body.some((p: any) => p?.id === this.popupId),
      `did not expect the created popup "${this.popupId}" in the list`,
    );
  },
);

When(
  "I record a {string} event on the created popup without a token",
  async function (this: LmsWorld, type: string) {
    await this.request("POST", `/popups/${this.popupId}/event`, {
      token: null,
      body: { type },
    });
  },
);

When("I GET the created popup as admin", async function (this: LmsWorld) {
  const token = await this.adminToken();
  await this.request("GET", `/admin/popups/${this.popupId}`, { token });
});

Then(
  "the response field {string} should be {int}",
  function (this: LmsWorld, field: string, expected: number) {
    assert.equal(
      this.last.body?.[field],
      expected,
      `expected "${field}" to be ${expected} but got ${JSON.stringify(this.last.body)}`,
    );
  },
);

Then(
  "the response field {string} should be {string}",
  function (this: LmsWorld, field: string, expected: string) {
    assert.equal(
      String(this.last.body?.[field] ?? ""),
      expected,
      `expected "${field}" to be "${expected}" but got ${JSON.stringify(this.last.body)}`,
    );
  },
);

// Enum assertion for values an admin can change on the long-lived dev DB —
// asserts the CONTRACT (one of the allowed values), not the saved data.
Then(
  "the response field {string} should be one of {string}",
  function (this: LmsWorld, field: string, allowed: string) {
    const value = String(this.last.body?.[field] ?? "");
    const options = allowed.split("|");
    assert.ok(
      options.includes(value),
      `expected "${field}" to be one of ${allowed} but got "${value}"`,
    );
  },
);

// ---------- members (admin profile edit) ----------

When(
  "I update the member's profile via admin with body:",
  async function (this: LmsWorld, docString: string) {
    const token = await this.adminToken();
    const id = await this.memberId();
    await this.request("PATCH", `/members/${id}`, {
      token,
      body: JSON.parse(docString),
    });
  },
);

When(
  "I try to update the member's profile without a token with body:",
  async function (this: LmsWorld, docString: string) {
    const id = await this.memberId();
    await this.request("PATCH", `/members/${id}`, {
      token: null,
      body: JSON.parse(docString),
    });
  },
);

// ---------- form submissions (entries viewer) ----------

When(
  "I GET the created form submissions as admin",
  async function (this: LmsWorld) {
    const token = await this.adminToken();
    await this.request("GET", `/admin/forms/${this.formId}/submissions`, {
      token,
    });
  },
);

// ---------- app customization (mobile branding config) ----------

When(
  "I PUT {string} without a token and body:",
  async function (this: LmsWorld, path: string, docString: string) {
    await this.request("PUT", path, { token: null, body: JSON.parse(docString) });
  },
);

When(
  "I GET {string} with an admin token",
  async function (this: LmsWorld, path: string) {
    const token = await this.adminToken();
    await this.request("GET", path, { token });
  },
);

When(
  "I DELETE {string} with an admin token",
  async function (this: LmsWorld, path: string) {
    const token = await this.adminToken();
    await this.request("DELETE", path, { token });
  },
);

When(
  "I PUT {string} with an admin token and body:",
  async function (this: LmsWorld, path: string, docString: string) {
    const token = await this.adminToken();
    await this.request("PUT", path, { token, body: JSON.parse(docString) });
  },
);

// App-config round-trip hygiene: the suite runs against a long-lived dev DB,
// so the scenario captures the live config first and restores it afterwards —
// otherwise the test branding ("BDD App") becomes the real app branding.
When("I capture the current app config", async function (this: LmsWorld) {
  await this.request("GET", "/app/config", { token: null });
  this.savedAppConfig = this.last.body;
});

When(
  "I restore the captured app config with an admin token",
  async function (this: LmsWorld) {
    const token = await this.adminToken();
    await this.request("PUT", "/admin/app/config", {
      token,
      body: { appConfig: this.savedAppConfig },
    });
  },
);

// Dotted-path variant of "the response field … should be …", so a nested value
// (e.g. "light.primary") can be asserted on the returned config.
Then(
  "the response field {string} should equal {string}",
  function (this: LmsWorld, path: string, expected: string) {
    const actual = path
      .split(".")
      .reduce((o: any, k) => (o == null ? o : o[k]), this.last.body);
    assert.equal(
      String(actual ?? ""),
      expected,
      `expected "${path}" to equal "${expected}" but got ${JSON.stringify(this.last.body)}`,
    );
  },
);

Then(
  "the response should include a submission with email {string}",
  function (this: LmsWorld, email: string) {
    const body = this.last.body;
    assert.ok(
      Array.isArray(body),
      `expected an array, got: ${JSON.stringify(body)}`,
    );
    assert.ok(
      body.some((s: any) => s?.email === email),
      `expected a submission with email "${email}"`,
    );
  },
);
