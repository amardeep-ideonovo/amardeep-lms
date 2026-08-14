import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

// Body for the control-plane-only POST /instance-admin/reset-password. The
// control plane GENERATES the new password and tells us which admin it's for
// (the email it displays); we only set the hash. Guarded by ServiceTokenGuard,
// so this is never reachable with a user session.
export class ResetInstanceAdminDto {
  // The displayed owner-admin's email. Optional: if absent or not found on this
  // instance we fall back to the earliest SUPER_ADMIN (the one seeded at
  // provisioning), so a recovery never dead-ends on an email drift.
  @IsOptional()
  @IsString()
  email?: string;

  // Control-plane-generated; we set it verbatim as the new password. 12–72 to
  // stay within bcrypt's 72-byte input limit while rejecting anything too short.
  @IsString()
  @MinLength(12)
  @MaxLength(72)
  password!: string;
}
