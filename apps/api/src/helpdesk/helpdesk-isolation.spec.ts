import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";

// Contract: the admin->operator support sync must NEVER select or push member
// helpdesk rows to the control plane. Its outbound selectors are keyed on
// `syncedAt`/`authorKind` with no lane predicate, so the ONLY thing keeping
// member-authored text on the tenant is that the Helpdesk* tables live in a
// separate namespace the sync never names. This asserts that structural
// property so a future edit can't quietly wire them together.
test("support-sync never references the helpdesk namespace", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "support", "support-sync.service.ts"),
    "utf8",
  );
  assert.ok(
    !/helpdesk/i.test(src),
    "support-sync.service.ts references 'helpdesk' — member support data must " +
      "never be pushed to the operator control plane.",
  );
});
