import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "class-validator";
import { StatEventDto } from "./dto/helpdesk.dto";

// The stats endpoint's integrity boundary. recordStat() hardcodes a cardViews
// increment, and the global ValidationPipe rejects any non-cardView event via
// @IsIn(["cardView"]). This pins that ONLY cardView is accepted — the retired
// `escalation` (now counted server-side) and `resolvedYes` (legacy) events are
// the exact inputs a member used to inflate the anonymous ops counters, so a
// future re-widening of the union must fail here.
async function errorsFor(payload: Record<string, unknown>) {
  return validate(Object.assign(new StatEventDto(), payload));
}

test("StatEventDto accepts the one live event, cardView", async () => {
  assert.equal(
    (await errorsFor({ category: "BILLING", event: "cardView" })).length,
    0,
  );
});

test("StatEventDto rejects the retired escalation/resolvedYes events", async () => {
  for (const event of ["escalation", "resolvedYes", "somethingElse"]) {
    const errs = await errorsFor({ category: "BILLING", event });
    assert.ok(errs.length > 0, `event="${event}" must be rejected`);
  }
});

test("StatEventDto still rejects an unknown category", async () => {
  const errs = await errorsFor({ category: "NONSENSE", event: "cardView" });
  assert.ok(errs.length > 0);
});
