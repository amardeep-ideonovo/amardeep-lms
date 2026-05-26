import {
  Body,
  Controller,
  Delete,
  Get,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { SettingsService, SETTING_KEYS } from './settings.service';
import {
  UpdateMailchimpSettingsDto,
  UpdateStripeSettingsDto,
} from './dto/settings.dto';

// Last 4 chars of a secret for read-back (never the full plaintext).
const last4 = (s: string | null): string | null => (s ? s.slice(-4) : null);

// Secrets are write-only: GET returns last4 only. PUT sets/updates (blank = keep);
// DELETE clears a provider's credentials entirely.
@UseGuards(AdminGuard)
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('stripe')
  async getStripe() {
    const [secret, webhook, publishable] = await Promise.all([
      this.settings.getSecret(SETTING_KEYS.stripeSecretKey),
      this.settings.getSecret(SETTING_KEYS.stripeWebhookSecret),
      this.settings.getSecret(SETTING_KEYS.stripePublishableKey),
    ]);
    return {
      secretKeyLast4: last4(secret),
      webhookSecretLast4: last4(webhook),
      // publishable key is public — returned in full so the admin can see it.
      publishableKey: publishable ?? null,
    };
  }

  @Put('stripe')
  async putStripe(@Body() dto: UpdateStripeSettingsDto) {
    await this.settings.setSecret(SETTING_KEYS.stripeSecretKey, dto.secretKey);
    await this.settings.setSecret(
      SETTING_KEYS.stripeWebhookSecret,
      dto.webhookSecret,
    );
    await this.settings.setSecret(
      SETTING_KEYS.stripePublishableKey,
      dto.publishableKey,
    );
    return this.getStripe();
  }

  @Delete('stripe')
  async deleteStripe() {
    await this.settings.clearStripe();
    return this.getStripe();
  }

  @Get('mailchimp')
  async getMailchimp() {
    const [apiKey, serverPrefix, audienceId] = await Promise.all([
      this.settings.getSecret(SETTING_KEYS.mailchimpApiKey),
      this.settings.getSecret(SETTING_KEYS.mailchimpServerPrefix),
      this.settings.getSecret(SETTING_KEYS.mailchimpAudienceId),
    ]);
    return {
      apiKeyLast4: last4(apiKey),
      // serverPrefix & audienceId are non-secret identifiers — safe to return.
      serverPrefix: serverPrefix ?? null,
      audienceId: audienceId ?? null,
    };
  }

  @Put('mailchimp')
  async putMailchimp(@Body() dto: UpdateMailchimpSettingsDto) {
    await this.settings.setSecret(SETTING_KEYS.mailchimpApiKey, dto.apiKey);
    await this.settings.setSecret(
      SETTING_KEYS.mailchimpServerPrefix,
      dto.serverPrefix,
    );
    await this.settings.setSecret(
      SETTING_KEYS.mailchimpAudienceId,
      dto.audienceId,
    );
    return this.getMailchimp();
  }

  @Delete('mailchimp')
  async deleteMailchimp() {
    await this.settings.clearMailchimp();
    return this.getMailchimp();
  }
}
