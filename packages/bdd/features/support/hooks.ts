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

// Scenarios tagged @cert-default create a template with isDefault:true, which
// demotes the SEEDED default (Classic Cream). The generic cleanup deletes the
// BDD template, so restore the seeded default afterwards — otherwise classes
// without an override lose certificates until the next re-seed.
After({ tags: "@cert-default" }, async function (this: LmsWorld) {
  try {
    const token = await this.adminToken();
    await this.request(
      "PATCH",
      "/admin/certificate-templates/seed-cert-template-classic",
      { token, body: { isDefault: true } },
    );
  } catch {
    /* cleanup is best-effort */
  }
});

// Content created by scenarios lands as real rows in the shared dev database —
// ACTIVE popups and PUBLISHED posts/pages immediately surface on the live
// member site. Delete whatever the scenario created so a test run leaves no
// trace. (Forms are covered too: 60+ "BDD form" rows had accumulated.)
After(async function (this: LmsWorld) {
  const targets: Array<[string | null, string]> = [
    [this.popupId, "/admin/popups"],
    [this.createdPostId, "/admin/blog/posts"],
    [this.createdPageId, "/admin/pages"],
    [this.formId, "/admin/forms"],
    // Certificates: the claimed row first (its template FK is SetNull anyway),
    // then the scenario's template and uploaded artwork.
    [this.certificateId, "/admin/certificates"],
    [this.certificateTemplateId, "/admin/certificate-templates"],
    [this.certificateMediaId, "/admin/media"],
  ];
  if (!targets.some(([id]) => id)) return;
  try {
    const token = await this.adminToken();
    for (const [id, base] of targets) {
      if (!id) continue;
      try {
        await this.request("DELETE", `${base}/${id}`, { token });
      } catch {
        /* per-row best effort */
      }
    }
  } catch {
    /* cleanup is best-effort — a failed delete must not fail the scenario */
  }
});
