import type { AdminPermissions, AdminRole } from '@lms/types';

// Single JWT shape for both members and admins. `isAdmin` + `role` drive RBAC.
// NOTE: the token deliberately does NOT carry permissions — those are loaded
// fresh from the DB per request (see JwtStrategy) so changes apply immediately.
export interface JwtPayload {
  sub: string; // user.id or admin.id
  email: string;
  username?: string; // members only
  isAdmin: boolean;
  role?: AdminRole; // admins only
}

// What gets attached to req.user after JwtStrategy validates the token. For
// admins, `role` + `permissions` are refreshed from the DB on every request.
export interface AuthenticatedPrincipal extends JwtPayload {
  permissions?: AdminPermissions; // admins only; SUPER_ADMIN ignores it
}
