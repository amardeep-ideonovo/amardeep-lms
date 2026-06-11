import { After } from "@cucumber/cucumber";
import { LmsWorld } from "./world";

// Popups created by scenarios are real rows in the shared dev database — and
// ACTIVE ones immediately surface on the live member site (dashboard, class/
// course/lesson screens). Delete whatever the scenario created so a test run
// leaves no trace.
After(async function (this: LmsWorld) {
  if (!this.popupId) return;
  try {
    const token = await this.adminToken();
    await this.request("DELETE", `/admin/popups/${this.popupId}`, { token });
  } catch {
    /* cleanup is best-effort — a failed delete must not fail the scenario */
  }
});
