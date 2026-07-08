import { IsString, MaxLength, MinLength } from 'class-validator';

// Body shape for POST /auth/reset-password. Mirrors ResetPasswordInput in
// @lms/types. The signed token (from the emailed link) is the credential —
// no current password required. New-password bounds mirror the signup DTO.
export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  token!: string;

  // 10 chars minimum / 72 max, same rationale as signup: a sensible floor
  // without complexity theatre; bcrypt silently truncates past 72 bytes.
  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters' })
  @MaxLength(72)
  newPassword!: string;
}
