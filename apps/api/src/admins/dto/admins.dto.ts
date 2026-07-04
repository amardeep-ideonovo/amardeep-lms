import {
  IsBoolean,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import type { AdminPermissions } from '@lms/types';

export class CreateAdminDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
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
  @MinLength(8)
  password!: string;
}
