import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { MemberStatusFilter } from '@lms/types';

const MEMBER_STATUS_FILTERS = [
  'active',
  'past_due',
  'paused',
  'canceled',
  'expired',
] as const;

// Query params for the server-paged member list. The global ValidationPipe runs
// with enableImplicitConversion, so page/pageSize arrive as numbers.
export class ListMembersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  // A real level id, or the sentinel "__none__" = holds no class.
  @IsOptional()
  @IsString()
  levelId?: string;

  @IsOptional()
  @IsIn(MEMBER_STATUS_FILTERS)
  status?: MemberStatusFilter;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

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
