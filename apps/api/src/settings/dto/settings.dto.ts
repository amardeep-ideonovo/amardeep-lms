import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

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

export class UpdateEmailSettingsDto {
  // The pluggable sender id: "smtp" (nodemailer) or "resend" (REST API).
  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  host?: string;

  // String on the wire (matches the form input); parsed to a number on read.
  @IsOptional()
  @IsString()
  port?: string;

  @IsOptional()
  @IsString()
  user?: string;

  // The SMTP password — the only secret in this group (write-only).
  @IsOptional()
  @IsString()
  pass?: string;

  // The Resend REST API key (re_…) — write-only secret used when provider="resend".
  // Blank/omitted keeps the stored value, exactly like `pass`.
  @IsOptional()
  @IsString()
  resendApiKey?: string;

  @IsOptional()
  @IsString()
  fromEmail?: string;

  @IsOptional()
  @IsString()
  fromName?: string;

  @IsOptional()
  @IsBoolean()
  secure?: boolean;
}
