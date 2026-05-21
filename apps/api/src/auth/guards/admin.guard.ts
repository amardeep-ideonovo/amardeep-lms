import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedPrincipal } from '../jwt-payload.interface';

// Requires a valid JWT AND the `isAdmin` claim. Used on every /levels,
// /members, /admin/settings and write-side LMS route.
@Injectable()
export class AdminGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedPrincipal>(
    err: any,
    user: any,
    info: any,
  ): TUser {
    if (err || !user) {
      throw err || new ForbiddenException('Authentication required');
    }
    const principal = user as AuthenticatedPrincipal;
    if (!principal.isAdmin) {
      throw new ForbiddenException('Admin privileges required');
    }
    return user as TUser;
  }

  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
