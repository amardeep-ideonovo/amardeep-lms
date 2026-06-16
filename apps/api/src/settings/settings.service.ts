import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret } from '../common/crypto.util';

// Setting keys stored (encrypted) in the Setting table.
export const SETTING_KEYS = {
  stripeSecretKey: 'stripe.secretKey',
  stripeWebhookSecret: 'stripe.webhookSecret',
  stripePublishableKey: 'stripe.publishableKey',
  mailchimpApiKey: 'mailchimp.apiKey',
  mailchimpServerPrefix: 'mailchimp.serverPrefix',
  mailchimpAudienceId: 'mailchimp.audienceId',
  // Cutover flag. When false (the default) NOTHING is written back to Mailchimp
  // — the in-house contacts list is the system of record. Flip it on only to
  // dual-run during a migration window. READ paths (import/export) ignore this.
  mailchimpSyncEnabled: 'mailchimp.syncEnabled',
  paypalClientId: 'paypal.clientId',
  paypalClientSecret: 'paypal.clientSecret',
  paypalWebhookId: 'paypal.webhookId',
  paypalMode: 'paypal.mode',
  // Which processor NEW checkouts use ("stripe" | "paypal"). Existing
  // subscriptions keep billing on the provider that created them.
  paymentProvider: 'payments.provider',
  // Outbound email / SMTP sender (in-house Mailchimp replacement). `emailPass`
  // is the only secret; the rest are config (host/port/from), stored the same
  // way for a single source of truth + per-key env fallback.
  emailProvider: 'email.provider',
  emailHost: 'email.host',
  emailPort: 'email.port',
  emailUser: 'email.user',
  emailPass: 'email.pass',
  // Resend REST API key (the only Resend secret — provider="resend" sends via the
  // Resend HTTP API instead of SMTP). Write-only, encrypted, exactly like emailPass.
  emailResendApiKey: 'email.resendApiKey',
  emailFromEmail: 'email.fromEmail',
  emailFromName: 'email.fromName',
  emailSecure: 'email.secure',
  // Shared secret for the public provider feedback webhook (bounce/complaint
  // ingestion). The webhook is unauthenticated at the route level (providers
  // can't carry our JWT), so a request must present this secret (header or
  // ?key=) before it's allowed to suppress addresses. Write-only like emailPass.
  emailWebhookSecret: 'email.webhookSecret',
} as const;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
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
    if (plaintext === undefined || plaintext === '') return;
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

  /** Clear all Stripe credentials. */
  async clearStripe(): Promise<void> {
    await Promise.all([
      this.clearSecret(SETTING_KEYS.stripeSecretKey),
      this.clearSecret(SETTING_KEYS.stripeWebhookSecret),
      this.clearSecret(SETTING_KEYS.stripePublishableKey),
    ]);
  }

  /** Clear all Mailchimp credentials (key + server prefix + audience + sync flag). */
  async clearMailchimp(): Promise<void> {
    await Promise.all([
      this.clearSecret(SETTING_KEYS.mailchimpApiKey),
      this.clearSecret(SETTING_KEYS.mailchimpServerPrefix),
      this.clearSecret(SETTING_KEYS.mailchimpAudienceId),
      this.clearSecret(SETTING_KEYS.mailchimpSyncEnabled),
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
    return this.getSecret(SETTING_KEYS.stripeSecretKey, 'STRIPE_SECRET_KEY');
  }
  getStripeWebhookSecret(): Promise<string | null> {
    return this.getSecret(
      SETTING_KEYS.stripeWebhookSecret,
      'STRIPE_WEBHOOK_SECRET',
    );
  }
  // Publishable key is public (safe to expose to the browser for Stripe Elements).
  getStripePublishableKey(): Promise<string | null> {
    return this.getSecret(
      SETTING_KEYS.stripePublishableKey,
      'STRIPE_PUBLISHABLE_KEY',
    );
  }
  getMailchimpApiKey(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.mailchimpApiKey, 'MAILCHIMP_API_KEY');
  }
  getMailchimpServerPrefix(): Promise<string | null> {
    return this.getSecret(
      SETTING_KEYS.mailchimpServerPrefix,
      'MAILCHIMP_SERVER_PREFIX',
    );
  }
  getMailchimpAudienceId(): Promise<string | null> {
    return this.getSecret(
      SETTING_KEYS.mailchimpAudienceId,
      'MAILCHIMP_AUDIENCE_ID',
    );
  }
  /**
   * Mailchimp write-back cutover flag. Default + unknown values → false, so the
   * migrated install writes NOTHING back to Mailchimp unless an admin explicitly
   * re-enables dual-run. Stored as 'true'/'false' (or env MAILCHIMP_SYNC_ENABLED).
   */
  async getMailchimpSyncEnabled(): Promise<boolean> {
    const v = await this.getSecret(
      SETTING_KEYS.mailchimpSyncEnabled,
      'MAILCHIMP_SYNC_ENABLED',
    );
    return v === 'true' || v === '1';
  }
  // Client id is public (ships to the browser for the PayPal JS SDK).
  getPayPalClientId(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.paypalClientId, 'PAYPAL_CLIENT_ID');
  }
  getPayPalClientSecret(): Promise<string | null> {
    return this.getSecret(
      SETTING_KEYS.paypalClientSecret,
      'PAYPAL_CLIENT_SECRET',
    );
  }
  getPayPalWebhookId(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.paypalWebhookId, 'PAYPAL_WEBHOOK_ID');
  }
  async getPayPalMode(): Promise<'sandbox' | 'live'> {
    const v = await this.getSecret(SETTING_KEYS.paypalMode, 'PAYPAL_MODE');
    return v === 'live' ? 'live' : 'sandbox'; // default + unknown → sandbox
  }
  /** The processor NEW checkouts use. Default + unknown values → stripe. */
  async getPaymentProvider(): Promise<'stripe' | 'paypal'> {
    const v = await this.getSecret(SETTING_KEYS.paymentProvider);
    return v === 'paypal' ? 'paypal' : 'stripe';
  }

  // --- Outbound email / SMTP accessors (consumed by the email sender) ---

  /** The active mail sender id. Default + unknown values → smtp. */
  async getEmailProvider(): Promise<'smtp' | 'resend'> {
    const v = await this.getSecret(SETTING_KEYS.emailProvider, 'EMAIL_PROVIDER');
    return v === 'resend' ? 'resend' : 'smtp';
  }
  /**
   * Resend REST API key (re_…). Write-only secret consumed by the Resend mail
   * sender when provider="resend"; null when unset. Env fallback so a deployment
   * can configure it without touching the DB.
   */
  getEmailResendApiKey(): Promise<string | null> {
    return this.getSecret(
      SETTING_KEYS.emailResendApiKey,
      'RESEND_API_KEY',
    );
  }
  getEmailHost(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.emailHost, 'SMTP_HOST');
  }
  /** SMTP port as a number (default 587 — STARTTLS submission). */
  async getEmailPort(): Promise<number> {
    const v = await this.getSecret(SETTING_KEYS.emailPort, 'SMTP_PORT');
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 587;
  }
  getEmailUser(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.emailUser, 'SMTP_USER');
  }
  getEmailPass(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.emailPass, 'SMTP_PASS');
  }
  getEmailFromEmail(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.emailFromEmail, 'EMAIL_FROM');
  }
  getEmailFromName(): Promise<string | null> {
    return this.getSecret(SETTING_KEYS.emailFromName, 'EMAIL_FROM_NAME');
  }
  /** Implicit-TLS flag (true ≈ port 465). Default false (STARTTLS on 587). */
  async getEmailSecure(): Promise<boolean> {
    const v = await this.getSecret(SETTING_KEYS.emailSecure, 'SMTP_SECURE');
    return v === 'true' || v === '1';
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
      'EMAIL_WEBHOOK_SECRET',
    );
  }
}
