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
