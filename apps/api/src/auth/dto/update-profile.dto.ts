import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Member self-service profile fields (PATCH /auth/me). Email is intentionally
// NOT here — members cannot change their own email (that's admin-only).
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_]{3,30}$/, {
    message: 'Username must be 3–30 characters: letters, numbers, or underscore',
  })
  username?: string;

  // Clear the profile photo. Sent on its own from the "Remove" action.
  @IsOptional()
  @IsBoolean()
  removeAvatar?: boolean;
}
