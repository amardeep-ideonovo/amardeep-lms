import { IsOptional, IsString } from 'class-validator';

export class UpdateStripeSettingsDto {
  @IsOptional()
  @IsString()
  secretKey?: string;

  @IsOptional()
  @IsString()
  webhookSecret?: string;
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
