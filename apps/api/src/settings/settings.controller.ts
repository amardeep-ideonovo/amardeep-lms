import {
  BadRequestException,
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
  UpdateEmailSettingsDto,
  UpdateMailchimpSettingsDto,
  UpdatePaymentProviderDto,
  UpdatePayPalSettingsDto,
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

  // ----- Outbound email / SMTP sender (same write-only pattern; password is
  // the only secret — GET reports only whether it's stored, never the value).

  @Get('email')
  @RequirePermission('settings', 'read')
  async getEmail() {
    const [provider, host, port, user, pass, fromEmail, fromName, secure] =
      await Promise.all([
        this.settings.getEmailProvider(),
        this.settings.getSecret(SETTING_KEYS.emailHost),
        this.settings.getSecret(SETTING_KEYS.emailPort),
        this.settings.getSecret(SETTING_KEYS.emailUser),
        this.settings.getSecret(SETTING_KEYS.emailPass),
        this.settings.getSecret(SETTING_KEYS.emailFromEmail),
        this.settings.getSecret(SETTING_KEYS.emailFromName),
        this.settings.getEmailSecure(),
      ]);
    return {
      provider,
      // host/port/from/user are config, not secrets — returned in full.
      host: host ?? null,
      port: port ?? null,
      user: user ?? null,
      passSet: !!pass,
      fromEmail: fromEmail ?? null,
      fromName: fromName ?? null,
      secure,
    };
  }

  @Put('email')
  @RequirePermission('settings', 'edit')
  async putEmail(@Body() dto: UpdateEmailSettingsDto) {
    await this.settings.setSecret(SETTING_KEYS.emailProvider, dto.provider);
    await this.settings.setSecret(SETTING_KEYS.emailHost, dto.host);
    await this.settings.setSecret(SETTING_KEYS.emailPort, dto.port);
    await this.settings.setSecret(SETTING_KEYS.emailUser, dto.user);
    // Blank/omitted password keeps the stored one (setSecret no-ops on '').
    await this.settings.setSecret(SETTING_KEYS.emailPass, dto.pass);
    await this.settings.setSecret(SETTING_KEYS.emailFromEmail, dto.fromEmail);
    await this.settings.setSecret(SETTING_KEYS.emailFromName, dto.fromName);
    // Boolean → stable string so setSecret persists it (and 'false' isn't '').
    if (dto.secure !== undefined) {
      await this.settings.setSecret(
        SETTING_KEYS.emailSecure,
        dto.secure ? 'true' : 'false',
      );
    }
    return this.getEmail();
  }

  @Delete('email')
  @RequirePermission('settings', 'delete')
  async deleteEmail() {
    await this.settings.clearEmail();
    return this.getEmail();
  }

  // ----- PayPal credentials (same write-only pattern as Stripe) -----

  @Get('paypal')
  @RequirePermission('settings', 'read')
  async getPayPal() {
    const [clientId, clientSecret, webhookId, mode] = await Promise.all([
      this.settings.getSecret(SETTING_KEYS.paypalClientId),
      this.settings.getSecret(SETTING_KEYS.paypalClientSecret),
      this.settings.getSecret(SETTING_KEYS.paypalWebhookId),
      this.settings.getSecret(SETTING_KEYS.paypalMode),
    ]);
    return {
      // client id is public (the browser loads the PayPal SDK with it) and the
      // webhook id is an identifier — both returned in full for the admin.
      clientId: clientId ?? null,
      clientSecretLast4: last4(clientSecret),
      webhookId: webhookId ?? null,
      mode: mode === 'live' ? 'live' : mode === 'sandbox' ? 'sandbox' : null,
    };
  }

  @Put('paypal')
  @RequirePermission('settings', 'edit')
  async putPayPal(@Body() dto: UpdatePayPalSettingsDto) {
    // Plan/product ids are environment-scoped at PayPal — a different app or a
    // sandbox↔live switch invalidates them all, so detect the change first.
    const [prevClientId, prevMode] = await Promise.all([
      this.settings.getSecret(SETTING_KEYS.paypalClientId),
      this.settings.getSecret(SETTING_KEYS.paypalMode),
    ]);
    await this.settings.setSecret(SETTING_KEYS.paypalClientId, dto.clientId);
    await this.settings.setSecret(
      SETTING_KEYS.paypalClientSecret,
      dto.clientSecret,
    );
    await this.settings.setSecret(SETTING_KEYS.paypalWebhookId, dto.webhookId);
    await this.settings.setSecret(SETTING_KEYS.paypalMode, dto.mode);
    const clientChanged =
      dto.clientId !== undefined &&
      dto.clientId !== '' &&
      dto.clientId !== prevClientId;
    const modeChanged =
      dto.mode !== undefined && dto.mode !== (prevMode ?? 'sandbox');
    if (clientChanged || modeChanged) {
      await this.settings.clearPayPalProvisionedIds();
    }
    return this.getPayPal();
  }

  @Delete('paypal')
  @RequirePermission('settings', 'delete')
  async deletePayPal() {
    await this.settings.clearPayPal();
    // Whatever app these ids belonged to is no longer configured.
    await this.settings.clearPayPalProvisionedIds();
    return this.getPayPal();
  }

  // ----- Active payment provider (governs NEW checkouts only) -----

  @Get('payment-provider')
  @RequirePermission('settings', 'read')
  async getPaymentProvider() {
    return { provider: await this.settings.getPaymentProvider() };
  }

  @Put('payment-provider')
  @RequirePermission('settings', 'edit')
  async putPaymentProvider(@Body() dto: UpdatePaymentProviderDto) {
    // Refuse to point new checkouts at an unconfigured processor.
    if (dto.provider === 'paypal') {
      const [clientId, secret] = await Promise.all([
        this.settings.getPayPalClientId(),
        this.settings.getPayPalClientSecret(),
      ]);
      if (!clientId || !secret) {
        throw new BadRequestException(
          'Add the PayPal client ID and secret before making PayPal the active provider.',
        );
      }
      const webhookId = await this.settings.getPayPalWebhookId();
      await this.settings.setSecret(
        SETTING_KEYS.paymentProvider,
        dto.provider,
      );
      return {
        provider: 'paypal' as const,
        // Checkouts work without a webhook id (the activate endpoint reconciles
        // inline), but renewals/cancellations made AT PayPal won't sync.
        warning: webhookId
          ? null
          : 'No PayPal webhook ID saved — subscription changes made at PayPal will not sync automatically.',
      };
    }
    const secretKey = await this.settings.getStripeSecretKey();
    if (!secretKey) {
      throw new BadRequestException(
        'Add the Stripe secret key before making Stripe the active provider.',
      );
    }
    await this.settings.setSecret(SETTING_KEYS.paymentProvider, dto.provider);
    return { provider: 'stripe' as const, warning: null };
  }
}
