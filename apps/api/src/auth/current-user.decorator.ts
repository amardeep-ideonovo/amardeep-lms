import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedPrincipal } from './jwt-payload.interface';

// Pulls the authenticated principal off the request (set by JwtStrategy).
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedPrincipal => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthenticatedPrincipal;
  },
);
