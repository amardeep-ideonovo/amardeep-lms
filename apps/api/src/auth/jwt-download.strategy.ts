import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { jwtSecret } from '../common/env.util';
import type {
  AuthenticatedPrincipal,
  JwtPayload,
} from './jwt-payload.interface';

// A JWT strategy variant that also accepts the token via a `?token=` query
// param (header is still preferred). Used ONLY by the lesson-note download
// route: a mobile client opens the file URL in the device browser via
// Linking, where it can't attach an Authorization header. The token is the
// member's own JWT over HTTPS; query-param acceptance is scoped to this one
// route so the rest of the API stays header-only.
@Injectable()
export class JwtDownloadStrategy extends PassportStrategy(
  Strategy,
  'jwt-download',
) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: Request) =>
          typeof req?.query?.token === 'string' ? req.query.token : null,
      ]),
      ignoreExpiration: false,
      secretOrKey: jwtSecret(config.get<string>('JWT_SECRET')),
    });
  }

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
