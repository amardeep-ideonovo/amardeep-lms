import { IsString, MaxLength, MinLength } from 'class-validator';

// Member changes their own password (POST /auth/change-password). The current
// password is required to authorize the change; the new-password match ("verify
// entered password") is enforced client-side. Bounds mirror the signup DTO.
export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(72)
  newPassword!: string;
}
