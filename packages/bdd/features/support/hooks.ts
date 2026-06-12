import { After } from "@cucumber/cucumber";
import { LmsWorld } from "./world";

// Payment-provider scenarios mutate LIVE settings (the public /billing/config
// drives the member checkout UI), so restore stripe + wipe the BDD PayPal
// creds even when a step fails mid-scenario. Best-effort: restoring the
// provider needs Stripe configured (the controller guard), which holds on the
// dev DB this suite targets.
After({ tags: "@paypal-settings" }, async function (this: LmsWorld) {
  try {
    const token = await this.adminToken();
    await this.request("PUT", "/admin/settings/payment-provider", {
      token,
      body: { provider: "stripe" },
    });
    await this.request("DELETE", "/admin/settings/paypal", { token });
  } catch {
    /* cleanup is best-effort */
  }
});

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
