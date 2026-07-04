import { After, Before } from "@cucumber/cucumber";
import { LmsWorld } from "./world";
import { SmtpCatcher } from "./smtp-catcher";

// @email-capture scenarios need real outbound mail they can read (e.g. the
// password-reset link). Start an in-process SMTP sink on an ephemeral
// loopback port and point the platform's LIVE email settings at it via the
// admin API — the SMTP sender re-reads settings per send, so no restart is
// needed. The prior settings are snapshotted first and restored in After
// (same live-settings discipline as @paypal-settings). The stored SMTP
// password is never touched: PUT no-ops on omitted secrets and the sink
// accepts any credentials, so there's nothing irrecoverable here.
Before({ tags: "@email-capture" }, async function (this: LmsWorld) {
  this.smtpCatcher = new SmtpCatcher();
  const port = await this.smtpCatcher.start();
  const token = await this.adminToken();
  const current = await this.request("GET", "/admin/settings/email", { token });
  this.savedEmailSettings = current.status === 200 ? current.body : null;
  const r = await this.request("PUT", "/admin/settings/email", {
    token,
    body: {
      provider: "smtp",
      host: "127.0.0.1",
      port: String(port),
      user: "bdd-catcher",
      secure: false,
    },
  });
  if (r.status !== 200) {
    throw new Error(`could not point email settings at the catcher (${r.status})`);
  }
});

After({ tags: "@email-capture" }, async function (this: LmsWorld) {
  await this.smtpCatcher?.stop().catch(() => undefined);
  this.smtpCatcher = null;
  try {
    const token = await this.adminToken();
    const s = this.savedEmailSettings;
    const wasEmpty =
      s &&
      !s.host &&
      !s.user &&
      !s.passSet &&
      !s.resendApiKeySet &&
      !s.fromEmail &&
      !s.fromName;
    if (!s || wasEmpty) {
      // Nothing was configured before (CI, fresh dev DB) — clear everything
      // the hook wrote. Safe: passSet was false, so DELETE loses no secret.
      await this.request("DELETE", "/admin/settings/email", { token });
    } else {
      // Restore the readable fields we overwrote (provider/host/port/user/
      // secure). PUT can't null a field, so an oddball partial config (e.g.
      // host set but user unset) keeps the catcher's value there — accepted,
      // cleanup is best-effort like every other hook in this file.
      await this.request("PUT", "/admin/settings/email", {
        token,
        body: {
          provider: s.provider ?? undefined,
          host: s.host ?? undefined,
          port: s.port != null ? String(s.port) : undefined,
          user: s.user ?? undefined,
          secure: !!s.secure,
        },
      });
    }
  } catch {
    /* cleanup is best-effort */
  }
  this.savedEmailSettings = null;
});

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
