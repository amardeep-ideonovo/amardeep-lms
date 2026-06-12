import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateStripeSettingsDto {
  @IsOptional()
  @IsString()
  secretKey?: string;

  @IsOptional()
  @IsString()
  webhookSecret?: string;

  // Publishable key is public (not a secret) but managed here alongside the
  // others; whitelisted so saving it doesn't get rejected by the global pipe.
  @IsOptional()
  @IsString()
  publishableKey?: string;
}

export class UpdateMailchimpSettingsDto {
  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  serverPrefix?: string;

  @IsOptional()
  @IsString()
  audienceId?: string;
}

export class UpdatePayPalSettingsDto {
  // Client id is public (it ships to the browser for the PayPal JS SDK) but
  // managed here alongside the secret.
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  clientSecret?: string;

  // Webhook id from the PayPal app's webhook registration — needed to call
  // verify-webhook-signature. An identifier, not a secret.
  @IsOptional()
  @IsString()
  webhookId?: string;

  @IsOptional()
  @IsIn(['sandbox', 'live'])
  mode?: 'sandbox' | 'live';
}

export class UpdatePaymentProviderDto {
  @IsIn(['stripe', 'paypal'])
  provider!: 'stripe' | 'paypal';
}
