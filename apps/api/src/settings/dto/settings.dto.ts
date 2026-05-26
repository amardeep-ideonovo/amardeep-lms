import { IsOptional, IsString } from 'class-validator';

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
