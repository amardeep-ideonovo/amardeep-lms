import { IsString, MaxLength, MinLength } from "class-validator";
// Relative on purpose — see packages/types/constants.ts (API value imports).
import { PASSWORD_MIN } from "../../../../../packages/types/constants";
import { STR } from "../../../../../packages/types/strings";

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
  @MinLength(PASSWORD_MIN.member, {
    message: STR.validation.passwordMin(PASSWORD_MIN.member),
  })
  @MaxLength(72)
  newPassword!: string;
}
