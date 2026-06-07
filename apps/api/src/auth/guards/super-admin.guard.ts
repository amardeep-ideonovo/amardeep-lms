import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedPrincipal } from '../jwt-payload.interface';

// Requires a valid JWT AND role === SUPER_ADMIN. Used on admin-management routes
// (only the super admin can create/edit/delete admins).
@Injectable()
export class SuperAdminGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedPrincipal>(err: any, user: any): TUser {
    if (err || !user) {
      throw err || new ForbiddenException('Authentication required');
    }
    const principal = user as AuthenticatedPrincipal;
    if (!principal.isAdmin || principal.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Super admin privileges required');
    }
    return user as TUser;
  }
}
