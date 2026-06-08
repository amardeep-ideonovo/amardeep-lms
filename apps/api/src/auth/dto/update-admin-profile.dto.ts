import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

// Admin self-service profile update (PATCH /auth/admin/profile). Email is the
// login id and is NOT editable here. Send name: "" to clear the display name;
// removeAvatar: true to drop the photo.
export class UpdateAdminProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  removeAvatar?: boolean;
}
