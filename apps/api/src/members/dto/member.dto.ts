import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AddMemberLevelDto {
  @IsString()
  @MinLength(1)
  levelId!: string;
}

// Admin-editable profile fields. All optional; an empty string clears the
// field (handled in the service), an absent field leaves it unchanged.
export class UpdateMemberDto {
  // Changing email re-points login + Stripe receipts + the in-house contact
  // (handled in MembersService.update). Must be a valid address; never cleared.
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
}

// Admin override: set a member's password without their current one.
export class SetMemberPasswordDto {
  @IsString()
  @MinLength(10)
  @MaxLength(72)
  newPassword!: string;
}
