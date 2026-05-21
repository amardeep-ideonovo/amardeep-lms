import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthenticatedPrincipal, JwtPayload } from './jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') || 'dev-insecure-secret',
    });
  }

  // Whatever is returned here becomes req.user.
  async validate(payload: JwtPayload): Promise<AuthenticatedPrincipal> {
    return {
      sub: payload.sub,
      email: payload.email,
      username: payload.username,
      isAdmin: payload.isAdmin,
      role: payload.role,
    };
  }
}
