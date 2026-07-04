import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedPrincipal } from '../jwt-payload.interface';
import {
  PERMISSION_KEY,
  type RequiredPermission,
} from '../require-permission.decorator';

// Valid admin JWT + the route's @RequirePermission tag. SUPER_ADMIN passes
// everything (implicit full access); other admins must have the matching
// permissions[section][action] === true. An admin route with no tag just
// requires any authenticated admin.
@Injectable()
export class PermissionsGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  handleRequest<TUser = AuthenticatedPrincipal>(
    err: any,
    user: any,
    _info: any,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      throw err || new ForbiddenException('Authentication required');
    }
    const principal = user as AuthenticatedPrincipal;
    if (!principal.isAdmin) {
      throw new ForbiddenException('Admin privileges required');
    }
    if (principal.role === 'SUPER_ADMIN') {
      return user as TUser; // implicit full access
    }
    const required = this.reflector.getAllAndOverride<
      RequiredPermission | undefined
    >(PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (required) {
      const ok =
        principal.permissions?.[required.section]?.[required.action] === true;
      if (!ok) {
        throw new ForbiddenException(
          `You don't have permission to ${required.action} ${required.section}`,
        );
      }
    }
    return user as TUser;
  }
}
