import {
  Body,
  Controller,
  Delete,
  Get,
  Put,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { SettingsService, SETTING_KEYS } from './settings.service';
import {
  UpdateMailchimpSettingsDto,
  UpdateStripeSettingsDto,
} from './dto/settings.dto';

// Last 4 chars of a secret for read-back (never the full plaintext).
const last4 = (s: string | null): string | null => (s ? s.slice(-4) : null);

// Secrets are write-only: GET returns last4 only. PUT sets/updates (blank = keep);
// DELETE clears a provider's credentials entirely. Gated by the `settings`
// permission (defaults off for new admins — sensitive section).
@UseGuards(PermissionsGuard)
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('stripe')
  @RequirePermission('settings', 'read')
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
  @RequirePermission('settings', 'edit')
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
  @RequirePermission('settings', 'delete')
  async deleteStripe() {
    await this.settings.clearStripe();
    return this.getStripe();
  }

  @Get('mailchimp')
  @RequirePermission('settings', 'read')
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
  @RequirePermission('settings', 'edit')
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
  @RequirePermission('settings', 'delete')
  async deleteMailchimp() {
    await this.settings.clearMailchimp();
    return this.getMailchimp();
  }
}
