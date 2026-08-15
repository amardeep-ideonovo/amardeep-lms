import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
// Relative on purpose: a bare "@lms/types" VALUE import would survive into the
// compiled dist and fail to resolve at runtime (see packages/types/constants.ts).
import { PASSWORD_MIN } from "../../../../../packages/types/constants";
import { STR } from "../../../../../packages/types/strings";

// Body shape for POST /auth/signup. Mirrors SignupInput in @lms/types.
export class SignupDto {
  @IsEmail()
  email!: string;

  // 10 chars is a sensible minimum that doesn't shame users into "Password1!".
  // Max 72 because bcrypt silently truncates anything longer.
  @IsString()
  @MinLength(PASSWORD_MIN.member, {
    message: STR.validation.passwordMin(PASSWORD_MIN.member),
  })
  @MaxLength(72)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  // Only enforced if SIGNUP_INVITE_CODE is set on the server (closed beta).
  @IsOptional()
  @IsString()
  @MaxLength(120)
  inviteCode?: string;
}
