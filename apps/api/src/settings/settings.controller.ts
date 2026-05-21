import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { SettingsService, SETTING_KEYS } from './settings.service';
import { maskSecret } from '../common/crypto.util';
import {
  UpdateMailchimpSettingsDto,
  UpdateStripeSettingsDto,
} from './dto/settings.dto';

// Secrets are write-only: GET returns masked values (last4) only, never plaintext.
@UseGuards(AdminGuard)
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('stripe')
  async getStripe() {
    const [secret, webhook] = await Promise.all([
      this.settings.getSecret(SETTING_KEYS.stripeSecretKey),
      this.settings.getSecret(SETTING_KEYS.stripeWebhookSecret),
    ]);
    return {
      secretKey: maskSecret(secret),
      webhookSecret: maskSecret(webhook),
      configured: { secretKey: !!secret, webhookSecret: !!webhook },
    };
  }

  @Put('stripe')
  async putStripe(@Body() dto: UpdateStripeSettingsDto) {
    await this.settings.setSecret(SETTING_KEYS.stripeSecretKey, dto.secretKey);
    await this.settings.setSecret(
      SETTING_KEYS.stripeWebhookSecret,
      dto.webhookSecret,
    );
    return { ok: true };
  }

  @Get('mailchimp')
  async getMailchimp() {
    const [apiKey, serverPrefix, audienceId] = await Promise.all([
      this.settings.getSecret(SETTING_KEYS.mailchimpApiKey),
      this.settings.getSecret(SETTING_KEYS.mailchimpServerPrefix),
      this.settings.getSecret(SETTING_KEYS.mailchimpAudienceId),
    ]);
    return {
      apiKey: maskSecret(apiKey),
      // serverPrefix & audienceId are non-secret identifiers — safe to return.
      serverPrefix: serverPrefix ?? null,
      audienceId: audienceId ?? null,
      configured: { apiKey: !!apiKey },
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
    return { ok: true };
  }
}
