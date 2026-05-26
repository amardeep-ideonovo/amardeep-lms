import { Injectable } from '@nestjs/common';
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
} as const;

@Injectable()
export class SettingsService {
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
      } catch {
        // Corrupt/old ciphertext — treat as unset and fall back.
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

  /** Clear all Mailchimp credentials (key + server prefix + audience). */
  async clearMailchimp(): Promise<void> {
    await Promise.all([
      this.clearSecret(SETTING_KEYS.mailchimpApiKey),
      this.clearSecret(SETTING_KEYS.mailchimpServerPrefix),
      this.clearSecret(SETTING_KEYS.mailchimpAudienceId),
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
}
