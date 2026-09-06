import { test } from "node:test";
import assert from "node:assert/strict";
import { HelpdeskThrottlerGuard } from "./helpdesk.throttler.guard";

// getTracker is protected; reach it through a thin subclass. Build the instance
// with Object.create so we skip ThrottlerGuard's DI constructor — getTracker
// reads only the request, never guard state.
class Probe extends HelpdeskThrottlerGuard {
  track(req: Record<string, unknown>) {
    return this.getTracker(req);
  }
}
const probe = () => Object.create(Probe.prototype) as Probe;

test("keys the throttle on the member id, not the IP (per-member limit)", async () => {
  assert.equal(
    await probe().track({ user: { sub: "u1" }, ip: "1.2.3.4" }),
    "u1",
  );
});

test("falls back to the client IP when there is no principal", async () => {
  assert.equal(await probe().track({ ip: "1.2.3.4" }), "1.2.3.4");
});
