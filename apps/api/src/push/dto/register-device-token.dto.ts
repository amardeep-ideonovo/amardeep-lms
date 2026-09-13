import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

// Body of POST /push/register. The token is the ExponentPushToken[...] minted by
// the native build; validity is re-checked server-side with Expo.isExpoPushToken.
export class RegisterDeviceTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  token!: string;

  @IsIn(["ios", "android"])
  platform!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  appVersion?: string;
}

// Body of DELETE /push/register — only the token is needed to remove the row.
export class UnregisterDeviceTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  token!: string;
}
