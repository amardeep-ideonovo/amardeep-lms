import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { decryptSecret, encryptSecret } from "../common/crypto.util";

// Setting keys stored (encrypted) in the Setting table.
export const SETTING_KEYS = {
  stripeSecretKey: "stripe.secretKey",
  stripeWebhookSecret: "stripe.webhookSecret",
  stripePublishableKey: "stripe.publishableKey",
  paypalClientId: "paypal.clientId",
  paypalClientSecret: "paypal.clientSecret",
  paypalWebhookId: "paypal.webhookId",
  paypalMode: "paypal.mode",
  // Which processor NEW checkouts use ("stripe" | "paypal"). Existing
  // subscriptions keep billing on the provider that created them.
  paymentProvider: "payments.provider",
  // --- Operator-managed DEMO payment credentials (Stripe TEST mode) ---
  // Pushed in by the control plane over the service-token channel so a demo or
  // sample-content instance can take a fake checkout out of the box. They live
  // under their OWN keys, never `stripe.secretKey`, so they can never be
  // mistaken for — or silently overwrite — a credential the client typed. They
  // also deliberately have NO env fallback: a demo key that could resolve from
  // the environment would let one stray compose var arm checkout fleet-wide.
  demoStripeSecretKey: "stripe.demoSecretKey",
  demoStripePublishableKey: "stripe.demoPublishableKey",
  demoStripeWebhookSecret: "stripe.demoWebhookSecret",
  // Identifies THIS instance on the shared demo account. Stamped into the
  // metadata of every Stripe object we create there, so the account-wide admin
  // reads can be filtered back down to this tenant's own rows.
  demoStripeTenantTag: "stripe.demoTenantTag",
  // Outbound email / SMTP sender (the in-house email platform). `emailPass`
  // is the only secret; the rest are config (host/port/from), stored the same
  // way for a single source of truth + per-key env fallback.
  emailProvider: "email.provider",
  emailHost: "email.host",
  emailPort: "email.port",
  emailUser: "email.user",
  emailPass: "email.pass",
  // Resend REST API key (the only Resend secret — provider="resend" sends via the
  // Resend HTTP API instead of SMTP). Write-only, encrypted, exactly like emailPass.
  emailResendApiKey: "email.resendApiKey",
  emailFromEmail: "email.fromEmail",
  emailFromName: "email.fromName",
  emailSecure: "email.secure",
  // Shared secret for the public provider feedback webhook (bounce/complaint
  // ingestion). The webhook is unauthenticated at the route level (providers
  // can't carry our JWT), so a request must present this secret (header or
  // ?key=) before it's allowed to suppress addresses. Write-only like emailPass.
  emailWebhookSecret: "email.webhookSecret",
  // Zoom Meeting SDK (in-page live-session embed). The SDK key is public (it
  // ships to the browser to join); the SDK secret signs the join signature
  // server-side and is write-only, exactly like the Stripe secret key.
  zoomSdkKey: "zoom.sdkKey",
  zoomSdkSecret: "zoom.sdkSecret",
} as const;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Read & decrypt a stored secret, falling back to an env var if unset. */
  async getSecret(key: string, envFallback?: string): Promise<string | null> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    if (row?.value) {
      try {
        return decryptSecret(row.value);
      } catch (err) {
        // Corrupt/old ciphertext (e.g. SETTINGS_ENC_KEY was rotated) — treat as
        // unset and fall back, but surface it: silently masking the failure can
        // make a "missing" secret look intentional when it's really unreadable.
        this.logger.warn(
          `failed to decrypt setting '${key}' — treating as unset and falling ` +
            `back to env/null: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (envFallback) {
      return this.config.get<string>(envFallback) || null;
    }
    return null;
  }

  /** Encrypt & upsert a secret. Empty/undefined values are skipped (no-op). */
  async setSecret(key: string, plaintext: string | undefined): Promise<void> {
    if (plaintext === undefined || plaintext === "") return;
    const value = encryptSecret(plaintext);
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  /** Remove a stored secret entirely (so it reads back as unset). Idempotent. */
  async clearSecret(key: string): Promise<void> {
    await this.prisma.setting.deleteMany({ where: { key } });
  }

  // --- Operator-managed DEMO Stripe credentials ---
  //
  // Read with NO env fallback, on purpose (see SETTING_KEYS above). Each getter
  // reflects the DB row only, so revoking is a delete and nothing else.

  getDemoStripeSecretKey(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.demoStripeSecretKey);
  }
  getDemoStripePublishableKey(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.demoStripePublishableKey);
  }
  getDemoStripeWebhookSecret(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.demoStripeWebhookSecret);
  }
  getDemoStripeTenantTag(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.demoStripeTenantTag);
  }

  /**
   * The Stripe credentials checkout actually runs on, resolved as ONE coherent
   * set: the instance's own key always wins, and the operator's demo test key is
   * only a fallback for an instance that has no key of its own. Never mixes the
   * two — pairing a client's secret key with the demo publishable key (or the
   * reverse) would point the browser at a different account than the server.
   * Null when neither is configured.
   */
  async getEffectiveStripeKeys(): Promise<{
    secretKey: string;
    publishableKey: string | null;
    webhookSecret: string | null;
    /** True when this instance is billing through the operator's SHARED demo
     * account — the signal every cross-tenant guard keys off. */
    demo: boolean;
    tenantTag: string | null;
  } | null> {
    const own = await this.getStripeSecretKey();
    if (own) {
      const [publishableKey, webhookSecret] = await Promise.all([
        this.getStripePublishableKey(),
        this.getStripeWebhookSecret(),
      ]);
      return {
        secretKey: own,
        publishableKey,
        webhookSecret,
        demo: false,
        tenantTag: null,
      };
    }

    // FAIL CLOSED on an unreadable own key. getSecret() reports a row it cannot
    // decrypt as "not set" (SETTINGS_ENC_KEY rotated, ciphertext corrupted), and
    // without this check that indistinguishability would silently promote the
    // OPERATOR'S TEST KEYS on an academy that has its own — a client selling for
    // real would keep taking checkouts that collect nothing. A stored-but-broken
    // credential must break payments loudly, not quietly move them to our
    // sandbox. (An academy that never had a key of its own has no row here, so
    // the demo path below is unaffected.)
    const ownRow = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.stripeSecretKey },
      select: { key: true },
    });
    if (ownRow) {
      this.logger.error(
        "stripe.secretKey is stored but unreadable — refusing to fall back to " +
          "demo keys. Payments stay unavailable until it is re-entered.",
      );
      return null;
    }

    const demoSecret = await this.getDemoStripeSecretKey();
    if (!demoSecret) return null;
    const [publishableKey, webhookSecret, tenantTag] = await Promise.all([
      this.getDemoStripePublishableKey(),
      this.getDemoStripeWebhookSecret(),
      this.getDemoStripeTenantTag(),
    ]);
    return {
      secretKey: demoSecret,
      publishableKey,
      webhookSecret,
      demo: true,
      tenantTag,
    };
  }

  /** True when checkout is running on the operator's shared demo account. */
  async isDemoStripeActive(): Promise<boolean> {
    return (await this.getEffectiveStripeKeys())?.demo === true;
  }

  /** True when demo keys are STORED here, whether or not they're in use (an
   * instance whose client added their own key keeps them, dormant). Powers the
   * admin-facing "operator test keys" badge. */
  async hasDemoStripeKeys(): Promise<boolean> {
    return !!(await this.getDemoStripeSecretKey());
  }

  /**
   * Store the operator's demo credentials.
   *
   * The tenant tag is always rewritten. The webhook secret is three-state: a
   * push that OMITS it leaves the stored one alone, because the control plane
   * sends a keys-only push first as a reachability probe and that probe must not
   * strip a working academy's signing secret; sending an explicit null is how it
   * says "there is no webhook for you".
   */
  async setDemoStripe(input: {
    secretKey: string;
    publishableKey: string;
    /** `undefined` = leave whatever is stored alone (used by the control
     *  plane's keys-only reachability probe, which must not knock a working
     *  academy off its webhook); `null` = clear it; a string = set it. */
    webhookSecret?: string | null;
    tenantTag: string;
  }): Promise<void> {
    if (input.webhookSecret !== undefined) {
      await this.clearSecret(SETTING_KEYS.demoStripeWebhookSecret);
    }
    await this.clearSecret(SETTING_KEYS.demoStripeTenantTag);
    await Promise.all([
      this.setSecret(SETTING_KEYS.demoStripeSecretKey, input.secretKey),
      this.setSecret(
        SETTING_KEYS.demoStripePublishableKey,
        input.publishableKey,
      ),
      this.setSecret(
        SETTING_KEYS.demoStripeWebhookSecret,
        input.webhookSecret ?? undefined,
      ),
      // (a null webhookSecret was already cleared above; setSecret no-ops on it)
      this.setSecret(SETTING_KEYS.demoStripeTenantTag, input.tenantTag),
    ]);
  }

  /** Revoke the operator's demo credentials (the control plane's kill switch). */
  async clearDemoStripe(): Promise<void> {
    await Promise.all([
      this.clearSecret(SETTING_KEYS.demoStripeSecretKey),
      this.clearSecret(SETTING_KEYS.demoStripePublishableKey),
      this.clearSecret(SETTING_KEYS.demoStripeWebhookSecret),
      this.clearSecret(SETTING_KEYS.demoStripeTenantTag),
    ]);
  }

  /** Clear all Stripe credentials. */
  async clearStripe(): Promise<void> {
    await Promise.all([
      this.clearSecret(SETTING_KEYS.stripeSecretKey),
      this.clearSecret(SETTING_KEYS.stripeWebhookSecret),
      this.clearSecret(SETTING_KEYS.stripePublishableKey),
    ]);
  }

  /** Clear all outbound-email / SMTP settings (provider, host/port/from, pass). */
  async clearEmail(): Promise<void> {
    await Promise.all([
      this.clearSecret(SETTING_KEYS.emailProvider),
      this.clearSecret(SETTING_KEYS.emailHost),
      this.clearSecret(SETTING_KEYS.emailPort),
      this.clearSecret(SETTING_KEYS.emailUser),
      this.clearSecret(SETTING_KEYS.emailPass),
      this.clearSecret(SETTING_KEYS.emailResendApiKey),
      this.clearSecret(SETTING_KEYS.emailFromEmail),
      this.clearSecret(SETTING_KEYS.emailFromName),
      this.clearSecret(SETTING_KEYS.emailSecure),
    ]);
  }

  /** Clear just the webhook shared secret (kept separate from clearEmail so an
   * admin can rotate it without wiping SMTP config). Idempotent. */
  async clearEmailWebhookSecret(): Promise<void> {
    await this.clearSecret(SETTING_KEYS.emailWebhookSecret);
  }

  /** Clear the Zoom Meeting SDK credentials (key + secret). */
  async clearZoom(): Promise<void> {
    await Promise.all([
      this.clearSecret(SETTING_KEYS.zoomSdkKey),
      this.clearSecret(SETTING_KEYS.zoomSdkSecret),
    ]);
  }

  /** Clear all PayPal credentials (client id + secret + webhook id + mode). */
  async clearPayPal(): Promise<void> {
    await Promise.all([
      this.clearSecret(SETTING_KEYS.paypalClientId),
      this.clearSecret(SETTING_KEYS.paypalClientSecret),
      this.clearSecret(SETTING_KEYS.paypalWebhookId),
      this.clearSecret(SETTING_KEYS.paypalMode),
    ]);
  }

  /**
   * Forget every provisioned STRIPE product/price id, for exactly the reason
   * clearPayPalProvisionedIds exists: Stripe object ids are scoped to ONE
   * account. `price_…` minted on the operator's demo sandbox does not exist in
   * the client's own account, and vice versa.
   *
   * This matters now that an academy can change Stripe account at runtime —
   * armed with the operator's demo keys, revoked, or the client adding their
   * own. Without this reset, every paid checkout after the switch dies on
   * "No such price" against ids the new account has never seen, and nothing
   * self-heals: ensureStripePrice only creates a Price when stripePriceId is
   * null, so a stale id is permanent.
   */
  async clearStripeProvisionedIds(): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.price.updateMany({
        where: { stripePriceId: { not: null } },
        data: { stripePriceId: null },
      }),
      this.prisma.level.updateMany({
        where: { stripeProductId: { not: null } },
        data: { stripeProductId: null },
      }),
      // Customer ids are account-scoped too, and this one is easy to miss:
      // ensureCustomer RETURNS an existing stripeCustomerId without calling
      // Stripe, so a member who bought during the demo would keep pointing at a
      // customer in the OLD account forever. Their next checkout dies on
      // "No such customer", and /account + the billing portal throw on every
      // load. Nulling it makes the next checkout mint them a customer in the
      // new account, which is exactly what a fresh start on a new account means.
      this.prisma.user.updateMany({
        where: { stripeCustomerId: { not: null } },
        data: { stripeCustomerId: null },
      }),
      // Mirror rows index subscriptions that live in the old account: they can
      // no longer be reconciled, cancelled or displayed. Drop the STRIPE ones so
      // the member's billing pages show the truth (nothing) instead of rows
      // whose every action 404s at Stripe. PayPal rows are a different rail and
      // are left alone. Existing UserLevel grants are deliberately NOT revoked —
      // access already sold is not ours to take away here.
      this.prisma.subscriptionMirror.deleteMany({
        where: { provider: "STRIPE" },
      }),
    ]);
  }

  /**
   * The Stripe ACCOUNT a key belongs to, or null when it can't be determined.
   *
   * Modern Stripe keys embed the account id right after the `sk_test_` /
   * `pk_live_` prefix, so two keys from one account share that segment. Legacy
   * keys (pre-2020 accounts) do not, hence the null.
   */
  static stripeAccountOf(key: string | null): string | null {
    const m = key?.match(/^[a-z]{2}_(?:test|live)_(51[A-Za-z0-9]{14,})/);
    return m ? m[1].slice(0, 16) : null;
  }

  /**
   * Run a Stripe-credential mutation and reconcile everything derived from it.
   *
   * Wrapping the mutation (rather than asking callers to remember) is the point:
   * EVERY path that can change these credentials — the admin saving or deleting
   * their own keys, the control plane arming or revoking demo keys — goes
   * through here, so the derived state can never drift from the credentials.
   * Two things are derived:
   *
   *  1. Provisioned Stripe ids, dropped when the ACCOUNT changed (a caller that
   *     forgets leaves the academy permanently unable to sell).
   *  2. The standing "you are on demo keys" notification, emitted or withdrawn
   *     to match reality.
   */
  async withStripeCredentialChange<T>(mutate: () => Promise<T>): Promise<T> {
    const before = (await this.getEffectiveStripeKeys())?.secretKey ?? null;
    const result = await mutate();
    const after = (await this.getEffectiveStripeKeys())?.secretKey ?? null;
    if (SettingsService.isAccountChange(before, after)) {
      this.logger.log(
        "Stripe account changed — clearing provisioned product/price ids",
      );
      await this.clearStripeProvisionedIds();
    }
    await this.syncDemoKeyNotification();
    return result;
  }

  /** Dedupe key for the standing demo-keys warning. Fixed, because the warning
   *  is a STATE ("you are on demo keys"), not an event — re-pushing the same
   *  keys must not stack up a second copy in the bell. */
  private static readonly DEMO_KEYS_NOTIFICATION_KEY = "payment-keys:demo";

  /**
   * Keep the admin notification in step with whether demo keys are actually in
   * use. Emitted when they are, DELETED when they stop being — the moment the
   * client adds their own keys or the operator revokes, the warning is wrong and
   * a stale "no money reaches you" sitting in the bell is worse than none.
   *
   * Never throws: a notification failure must not break a credential save.
   */
  async syncDemoKeyNotification(): Promise<void> {
    try {
      if (await this.isDemoStripeActive()) {
        await this.notifications.record({
          type: "PAYMENT_KEYS_DEMO",
          severity: "WARNING",
          title: "Demo payment keys are active",
          body:
            "Checkout is running on test keys that came with your sample " +
            "content: cards are never charged and no money reaches you. Add " +
            "your own Stripe keys in Settings before you start selling.",
          dedupeKey: SettingsService.DEMO_KEYS_NOTIFICATION_KEY,
        });
      } else {
        await this.prisma.adminNotification.deleteMany({
          where: { dedupeKey: SettingsService.DEMO_KEYS_NOTIFICATION_KEY },
        });
      }
    } catch (err) {
      this.logger.warn(
        `failed to sync the demo-payment-keys notification: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Did the Stripe ACCOUNT change between these two secret keys?
   *
   * Compares the embedded account segment rather than the key string, because a
   * same-account key ROTATION must NOT reset anything: the ids are all still
   * valid in that account, and clearing them would break every live
   * subscription's reconciliation (no local Price matches, so grants stop being
   * renewed or revoked), orphan per-level coupons, and mint duplicate Products.
   *
   * Falls back to a string comparison when either key is legacy-format, where no
   * account segment exists — conservative in the safe direction: a needless
   * reset costs a re-mint, a missed one leaves the academy unable to sell.
   */
  static isAccountChange(before: string | null, after: string | null): boolean {
    if (before === after) return false;
    if (before === null || after === null) return true; // configured/unconfigured
    const a = SettingsService.stripeAccountOf(before);
    const b = SettingsService.stripeAccountOf(after);
    if (a === null || b === null) return true; // legacy key — can't tell, assume yes
    return a !== b;
  }

  /**
   * Forget every provisioned PayPal catalog/plan id. Plan and product ids are
   * environment-scoped at PayPal (sandbox ids are invalid in live and across
   * apps), so any change of client id or mode must reset them — they re-create
   * lazily at the next PayPal checkout.
   */
  async clearPayPalProvisionedIds(): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.price.updateMany({
        where: { paypalPlanId: { not: null } },
        data: { paypalPlanId: null },
      }),
      this.prisma.level.updateMany({
        where: { paypalProductId: { not: null } },
        data: { paypalProductId: null },
      }),
    ]);
  }

  // --- Convenience accessors used by integration services ---

  getStripeSecretKey(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.stripeSecretKey, "STRIPE_SECRET_KEY");
  }
  getStripeWebhookSecret(): Promise<string | null> {
    return this.getSecret(
      SETTING_KEYS.stripeWebhookSecret,
      "STRIPE_WEBHOOK_SECRET",
    );
  }
  // Publishable key is public (safe to expose to the browser for Stripe Elements).
  getStripePublishableKey(): Promise<string | null> {
    return this.getSecret(
      SETTING_KEYS.stripePublishableKey,
      "STRIPE_PUBLISHABLE_KEY",
    );
  }
  // Client id is public (ships to the browser for the PayPal JS SDK).
  getPayPalClientId(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.paypalClientId, "PAYPAL_CLIENT_ID");
  }
  getPayPalClientSecret(): Promise<string | null> {
    return this.getSecret(
      SETTING_KEYS.paypalClientSecret,
      "PAYPAL_CLIENT_SECRET",
    );
  }
  getPayPalWebhookId(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.paypalWebhookId, "PAYPAL_WEBHOOK_ID");
  }
  async getPayPalMode(): Promise<"sandbox" | "live"> {
    const v = await this.getSecret(SETTING_KEYS.paypalMode, "PAYPAL_MODE");
    return v === "live" ? "live" : "sandbox"; // default + unknown → sandbox
  }
  /** The processor NEW checkouts use. Default + unknown values → stripe. */
  async getPaymentProvider(): Promise<"stripe" | "paypal"> {
    const v = await this.getSecret(SETTING_KEYS.paymentProvider);
    return v === "paypal" ? "paypal" : "stripe";
  }

  // --- Zoom Meeting SDK accessors (consumed by the live-session embed) ---

  /** Zoom SDK key — public (ships to the browser). Env fallback: ZOOM_SDK_KEY. */
  getZoomSdkKey(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.zoomSdkKey, "ZOOM_SDK_KEY");
  }
  /** Zoom SDK secret — server-only (signs the join signature). */
  getZoomSdkSecret(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.zoomSdkSecret, "ZOOM_SDK_SECRET");
  }

  // --- Outbound email / SMTP accessors (consumed by the email sender) ---

  /** The active mail sender id. Default + unknown values → smtp. */
  async getEmailProvider(): Promise<"smtp" | "resend"> {
    const v = await this.getSecret(
      SETTING_KEYS.emailProvider,
      "EMAIL_PROVIDER",
    );
    return v === "resend" ? "resend" : "smtp";
  }
  /**
   * Resend REST API key (re_…). Write-only secret consumed by the Resend mail
   * sender when provider="resend"; null when unset. Env fallback so a deployment
   * can configure it without touching the DB.
   */
  getEmailResendApiKey(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.emailResendApiKey, "RESEND_API_KEY");
  }
  getEmailHost(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.emailHost, "SMTP_HOST");
  }
  /** SMTP port as a number (default 587 — STARTTLS submission). */
  async getEmailPort(): Promise<number> {
    const v = await this.getSecret(SETTING_KEYS.emailPort, "SMTP_PORT");
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 587;
  }
  getEmailUser(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.emailUser, "SMTP_USER");
  }
  getEmailPass(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.emailPass, "SMTP_PASS");
  }
  getEmailFromEmail(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.emailFromEmail, "EMAIL_FROM");
  }
  getEmailFromName(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.emailFromName, "EMAIL_FROM_NAME");
  }
  /** Implicit-TLS flag (true ≈ port 465). Default false (STARTTLS on 587). */
  async getEmailSecure(): Promise<boolean> {
    const v = await this.getSecret(SETTING_KEYS.emailSecure, "SMTP_SECURE");
    return v === "true" || v === "1";
  }
  /**
   * Shared secret guarding the public provider feedback webhook. Returns null
   * when unset (the webhook controller decides fail-open vs fail-closed from
   * there — closed in production, open with a warning locally). Env fallback so
   * a deployment can configure it without touching the DB.
   */
  getEmailWebhookSecret(): Promise<string | null> {
    return this.getSecret(
      SETTING_KEYS.emailWebhookSecret,
      "EMAIL_WEBHOOK_SECRET",
    );
  }
}
