import type { AdminRole } from '@lms/types';

// Single JWT shape for both members and admins. `isAdmin` + `role` drive RBAC.
export interface JwtPayload {
  sub: string; // user.id or admin.id
  email: string;
  username?: string; // members only
  isAdmin: boolean;
  role?: AdminRole; // admins only
}

// What gets attached to req.user after JwtStrategy validates the token.
export interface AuthenticatedPrincipal extends JwtPayload {}
