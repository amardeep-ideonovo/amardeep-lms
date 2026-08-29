import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryForText, routeHelpdeskText } from "@lms/types";
import { ANSWERABLE } from "./helpdesk-answerable";

// The helpdesk composer has no language model behind it — this keyword router
// IS the answer to "what happens when a member types something". These cases
// pin the behaviour the transcript depends on: route to a topic we can answer,
// hand straight over when a human is asked for, and never silently guess.
//
// Lives in apps/mobile because that workspace's `test` script is what CI runs
// over spec files; the router itself is shared with web.

test("routes plain topic words to the matching card", () => {
  assert.deepEqual(routeHelpdeskText("payments", ANSWERABLE), {
    kind: "topic",
    category: "BILLING",
  });
  assert.deepEqual(routeHelpdeskText("my classes", ANSWERABLE), {
    kind: "topic",
    category: "ACCESS",
  });
  assert.deepEqual(routeHelpdeskText("lessons", ANSWERABLE), {
    kind: "topic",
    category: "TECHNICAL",
  });
});

test("is case- and punctuation-insensitive", () => {
  // iOS autocapitalises the first word of a message; the router must not care.
  assert.deepEqual(routeHelpdeskText("Payments?", ANSWERABLE), {
    kind: "topic",
    category: "BILLING",
  });
  assert.deepEqual(
    routeHelpdeskText("When is my next PAYMENT due?", ANSWERABLE),
    { kind: "topic", category: "BILLING" },
  );
});

test("an explicit ask for a person beats any topic word in the sentence", () => {
  // "I already read the payments page, get me a person" must not answer with
  // the payments card — the member has told us the bot already failed.
  assert.deepEqual(
    routeHelpdeskText("I read the payment page, get me a human", ANSWERABLE),
    { kind: "human" },
  );
  assert.deepEqual(routeHelpdeskText("talk to someone", ANSWERABLE), {
    kind: "human",
  });
});

test("asks about existing tickets go to the requests list", () => {
  assert.deepEqual(routeHelpdeskText("where is my ticket", ANSWERABLE), {
    kind: "requests",
  });
});

test("unmatched text is unknown — never a guess", () => {
  assert.deepEqual(routeHelpdeskText("the weather is nice", ANSWERABLE), {
    kind: "unknown",
  });
  assert.deepEqual(routeHelpdeskText("", ANSWERABLE), { kind: "unknown" });
  assert.deepEqual(routeHelpdeskText("   !!!   ", ANSWERABLE), {
    kind: "unknown",
  });
});

test("a recognised topic this surface cannot answer is unknown, not a wrong card", () => {
  // Mobile has no live-session card. Routing it to a topic would render an
  // empty bubble; unknown sends it to a human with the right category instead.
  assert.deepEqual(routeHelpdeskText("my zoom session", ANSWERABLE), {
    kind: "unknown",
  });
  // …and web, which can answer it, gets the card.
  assert.deepEqual(
    routeHelpdeskText("my zoom session", [...ANSWERABLE, "LIVE_SESSION"]),
    { kind: "topic", category: "LIVE_SESSION" },
  );
});

// --- regressions found by adversarial review; these are the misroutes that
// --- actually bite members, so they get pinned.

test("the product's own vocabulary does not hijack routing", () => {
  // "support", "team" and "staff" appear in ordinary sentences. Matching them
  // as bare tokens sent almost every message straight to a human.
  assert.deepEqual(
    routeHelpdeskText("my support ticket about payment", ANSWERABLE),
    {
      kind: "requests",
    },
  );
  assert.deepEqual(routeHelpdeskText("the team charged me twice", ANSWERABLE), {
    kind: "topic",
    category: "BILLING",
  });
});

test("'request' as a verb is not a request for the ticket list", () => {
  assert.deepEqual(
    routeHelpdeskText("I'd like to request a refund", ANSWERABLE),
    { kind: "topic", category: "BILLING" },
  );
  // …but the possessive phrasing still reaches the list.
  assert.deepEqual(routeHelpdeskText("show my requests", ANSWERABLE), {
    kind: "requests",
  });
});

test("'call me' is not a live session", () => {
  assert.deepEqual(routeHelpdeskText("please call me back", ANSWERABLE), {
    kind: "unknown",
  });
});

test("phrases still reach a human without the bare-word false positives", () => {
  for (const q of [
    "can I speak to a person",
    "talk to someone please",
    "I want a real person",
    "get me a human",
  ]) {
    assert.deepEqual(routeHelpdeskText(q, ANSWERABLE), { kind: "human" }, q);
  }
});

test("the most common support message of all routes somewhere useful", () => {
  // "I can't log in" tokenises to log/in and used to score ZERO across every
  // group, reaching the admin queue with no category at all.
  assert.equal(categoryForText("I cant log in"), "ACCOUNT");
  assert.equal(categoryForText("I can not sign in"), "ACCOUNT");
  assert.equal(categoryForText("my e-mail changed"), "ACCOUNT");
  assert.equal(categoryForText("I was double charged"), "BILLING");
});

test("ties break toward the more specific topic, not the biggest word list", () => {
  // "certificate" (narrow) vs a single BILLING word — the narrow topic wins.
  assert.equal(categoryForText("my certificate payment"), "CERTIFICATE");
});

test("categoryForText files an escalation under the right bucket", () => {
  // The whole point: a ticket the bot could not answer should still reach the
  // admin queue tagged, not dumped in OTHER.
  assert.equal(categoryForText("my certificate never arrived"), "CERTIFICATE");
  assert.equal(categoryForText("I was charged twice"), "BILLING");
  assert.equal(categoryForText("the weather is nice"), "OTHER");
});

// --- the article tier: admin-authored FAQ matched from the composer ---------

const ARTICLES = [
  {
    id: "a-refund",
    title: "Refund policy",
    keywords: ["refund", "refunds", "money back"],
  },
  { id: "a-login", title: "Trouble signing in", keywords: ["log in"] },
  { id: "a-schedule", title: "Studio opening hours", keywords: [] },
];

test("a keyword hit routes to the article — and outranks the topic map", () => {
  // "refund" is also a BILLING word, but the admin wrote a refund POLICY for
  // this academy; the member asked about policy, not their own last payment.
  assert.deepEqual(
    routeHelpdeskText("how do refunds work", ANSWERABLE, ARTICLES),
    { kind: "article", articleId: "a-refund" },
  );
});

test("multi-word keywords match as phrases", () => {
  assert.deepEqual(
    routeHelpdeskText("I want my money back", ANSWERABLE, ARTICLES),
    { kind: "article", articleId: "a-refund" },
  );
});

test("a title-only match fires only when no topic claims the message", () => {
  // Two title words, no topic word anywhere → the article answers.
  assert.deepEqual(
    routeHelpdeskText(
      "what are the studio opening hours",
      ANSWERABLE,
      ARTICLES,
    ),
    { kind: "article", articleId: "a-schedule" },
  );
  // A topic word in the sentence → the topic keeps the message; incidental
  // title language must not shadow account answers.
  assert.deepEqual(
    routeHelpdeskText("opening my payment history", ANSWERABLE, ARTICLES),
    { kind: "topic", category: "BILLING" },
  );
});

test("one short incidental title word is below the bar", () => {
  assert.deepEqual(
    routeHelpdeskText("hours and hours of fun", ANSWERABLE, []),
    { kind: "unknown" },
  );
  assert.deepEqual(
    routeHelpdeskText("nothing relevant here", ANSWERABLE, ARTICLES),
    {
      kind: "unknown",
    },
  );
});

test("an explicit ask for a person still beats an article keyword", () => {
  assert.deepEqual(
    routeHelpdeskText(
      "I read the refund article, talk to someone",
      ANSWERABLE,
      ARTICLES,
    ),
    { kind: "human" },
  );
});

test("a keyword-hit article beats a higher-scoring title-only article", () => {
  // "refund policy details" scores the policy article twice by title, but the
  // keyworded article owns the word — tiers, then scores.
  const rival = [
    { id: "t-only", title: "Refund policy details explained", keywords: [] },
    { id: "kw", title: "Getting your money back", keywords: ["refund"] },
  ];
  assert.deepEqual(
    routeHelpdeskText("refund policy details", ANSWERABLE, rival),
    { kind: "article", articleId: "kw" },
  );
});

test("without articles the router behaves exactly as before", () => {
  assert.deepEqual(routeHelpdeskText("how do refunds work", ANSWERABLE), {
    kind: "topic",
    category: "BILLING",
  });
  // An API that predates keywords sends articles without the field — no crash,
  // titles still count.
  assert.deepEqual(
    routeHelpdeskText("what are the studio opening hours", ANSWERABLE, [
      { id: "a-schedule", title: "Studio opening hours" },
    ]),
    { kind: "article", articleId: "a-schedule" },
  );
});

test("certificate and account questions now land on their own cards", () => {
  assert.deepEqual(routeHelpdeskText("where is my certificate", ANSWERABLE), {
    kind: "topic",
    category: "CERTIFICATE",
  });
  assert.deepEqual(routeHelpdeskText("I cant log in", ANSWERABLE), {
    kind: "topic",
    category: "ACCOUNT",
  });
});
