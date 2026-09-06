import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { HelpdeskController } from "./helpdesk.controller";

// Pins the per-member throttle SHAPE on the helpdesk surface. Unlike the auth
// routes (which lean on @Throttle + the global IP guard alone), helpdesk
// deliberately attaches HelpdeskThrottlerGuard — a DIFFERENT (member) key-space,
// the one per-route throttler ProxyAwareThrottlerGuard blesses. So:
//
//  1. Every WRITE route carries BOTH the @Throttle override AND the member-keyed
//     guard (and only that throttler — never a second one that would double-count).
//  2. The READ routes — including the per-attachment download-url MINT, which the
//     widget fans out one-per-thumbnail when a thread opens — carry NO per-member
//     throttler. A tight bucket there would 429 a member viewing their own long
//     thread; the global per-IP guard is the ceiling for reads.

const THROTTLED = [
  "start",
  "reply",
  "resolve",
  "rate",
  "addAttachments",
  "stat",
];

const UNTHROTTLED = [
  "config",
  "articles",
  "myConversations",
  "myUnread",
  "thread",
  "read",
  "attachmentDownloadUrl", // the read fan-out — must stay unthrottled
  "downloadAttachment",
];

function handler(name: string): object {
  const proto = HelpdeskController.prototype as unknown as Record<
    string,
    unknown
  >;
  const fn = proto[name];
  assert.equal(typeof fn, "function", `handler ${name} exists`);
  return fn as object;
}

const hasThrottle = (name: string) =>
  (Reflect.getMetadataKeys(handler(name)) as unknown[]).some((k) =>
    String(k).toUpperCase().includes("THROTTLER"),
  );

const throttlerGuardNames = (name: string) =>
  (
    (Reflect.getMetadata("__guards__", handler(name)) ?? []) as Array<{
      name?: string;
    }>
  )
    .filter((g) => /Throttler/i.test(g?.name ?? ""))
    .map((g) => g.name);

test("every helpdesk write route carries @Throttle + the member-keyed guard", () => {
  for (const name of THROTTLED) {
    assert.ok(hasThrottle(name), `${name} must carry @Throttle metadata`);
    assert.deepEqual(
      throttlerGuardNames(name),
      ["HelpdeskThrottlerGuard"],
      `${name} must attach HelpdeskThrottlerGuard (per-member key-space) and no other throttler`,
    );
  }
});

test("read routes (incl. the download-url mint fan-out) are not per-member throttled", () => {
  for (const name of UNTHROTTLED) {
    assert.deepEqual(
      throttlerGuardNames(name),
      [],
      `${name} is a read — it must not carry a per-member throttler guard`,
    );
  }
});
