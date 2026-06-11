import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AdminPermissions } from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { jwtSecret } from '../common/env.util';
import type { AuthenticatedPrincipal, JwtPayload } from './jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret(config.get<string>('JWT_SECRET')),
    });
  }

  // Whatever is returned here becomes req.user. We also confirm the principal
  // still exists: a token whose subject was removed (e.g. an admin/user id that
  // changed in a DB reseed) is rejected with 401 — rather than treated as a
  // valid-but-authorless session — so the client clears it and re-prompts a
  // sign-in.
  async validate(payload: JwtPayload): Promise<AuthenticatedPrincipal> {
    if (payload.isAdmin) {
      // Load the admin's CURRENT role + permissions (not what was in the token),
      // so permission/role edits take effect on the very next request.
      const admin = await this.prisma.admin.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true, permissions: true },
      });
      if (!admin) {
        throw new UnauthorizedException(
          'Your session is no longer valid — please sign in again',
        );
      }
      return {
        sub: payload.sub,
        email: payload.email,
        isAdmin: true,
        role: admin.role,
        permissions: (admin.permissions as AdminPermissions) ?? {},
      };
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true },
    });
    if (!user) {
      throw new UnauthorizedException(
        'Your session is no longer valid — please sign in again',
      );
    }
    return {
      sub: payload.sub,
      email: payload.email,
      username: payload.username,
      isAdmin: false,
    };
  }
}
