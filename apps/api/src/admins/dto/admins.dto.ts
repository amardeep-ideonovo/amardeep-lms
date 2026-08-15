import {
  IsBoolean,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";
import type { AdminPermissions } from "@lms/types";
// Relative on purpose — see packages/types/constants.ts (API value imports).
import { PASSWORD_MIN } from "../../../../../packages/types/constants";
import { STR } from "../../../../../packages/types/strings";

export class CreateAdminDto {
  @IsEmail()
  email!: string;

  // Instance admins are operator-created accounts — the tier is deliberately
  // 8, not the member 10 (owner decision recorded in constants.ts).
  @IsString()
  @MinLength(PASSWORD_MIN.admin, {
    message: STR.validation.passwordMin(PASSWORD_MIN.admin),
  })
  password!: string;

  @IsOptional()
  @IsBoolean()
  superAdmin?: boolean;

  // Loosely validated here; AdminsService.sanitize() strips it to known
  // sections/actions before persisting.
  @IsOptional()
  @IsObject()
  permissions?: AdminPermissions;
}

export class UpdateAdminDto {
  @IsOptional()
  @IsBoolean()
  superAdmin?: boolean;

  @IsOptional()
  @IsObject()
  permissions?: AdminPermissions;
}

export class ResetAdminPasswordDto {
  @IsString()
  @MinLength(PASSWORD_MIN.admin, {
    message: STR.validation.passwordMin(PASSWORD_MIN.admin),
  })
  password!: string;
}
