import { IsString, MaxLength, MinLength } from "class-validator";
// Relative on purpose — see packages/types/constants.ts (API value imports).
import { PASSWORD_MIN } from "../../../../../packages/types/constants";
import { STR } from "../../../../../packages/types/strings";

// Member changes their own password (POST /auth/change-password). The current
// password is required to authorize the change; the new-password match ("verify
// entered password") is enforced client-side. Bounds mirror the signup DTO.
export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(PASSWORD_MIN.member, {
    message: STR.validation.passwordMin(PASSWORD_MIN.member),
  })
  @MaxLength(72)
  newPassword!: string;
}
