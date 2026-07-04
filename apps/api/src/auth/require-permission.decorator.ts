import { SetMetadata } from '@nestjs/common';
import type { AdminAction, AdminSection } from '@lms/types';

export const PERMISSION_KEY = 'requiredPermission';

export interface RequiredPermission {
  section: AdminSection;
  action: AdminAction;
}

// Tag an admin route with the (section, action) the caller must hold. Enforced
// by PermissionsGuard; SUPER_ADMIN bypasses the check.
export const RequirePermission = (section: AdminSection, action: AdminAction) =>
  SetMetadata(PERMISSION_KEY, { section, action } as RequiredPermission);
