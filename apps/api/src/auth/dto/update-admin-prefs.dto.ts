import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';

// Admin self-service UI preferences (PATCH /auth/admin/prefs). `menuOrder` is a
// list of stable sidebar nav keys; AuthService.updateAdminPrefs() trims, dedupes
// and caps it before persisting (the admin app reconciles it against the live
// nav, so stray/missing keys are harmless). This is personal, not RBAC.
export class UpdateAdminPrefsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  menuOrder?: string[];
}
