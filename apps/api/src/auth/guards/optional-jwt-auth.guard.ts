import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Optional JWT auth: attaches the principal if a valid token is present, else
// leaves req.user null — never throws. Used by public endpoints that vary their
// output by visitor (e.g. menus filtered by membership) but still serve guests.
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(_err: unknown, user: unknown): TUser {
    return (user || null) as TUser;
  }
}
