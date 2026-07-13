import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

// Authenticates a server-to-server call FROM the control plane. No user, no JWT —
// the gate is the per-instance service token, the SAME shared secret this
// instance uses to call the control plane (INSTANCE_SERVICE_TOKEN). The control
// plane holds the matching half (Instance.secretsEnc.serviceToken) and presents
// it as a bearer. Constant-time compare so the token can't be recovered by
// timing the 401.
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.INSTANCE_SERVICE_TOKEN ?? '';
    if (!expected) throw new UnauthorizedException(); // no token → nothing to authorize
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!presented || !safeEqual(presented, expected)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // Length is not secret; bail before timingSafeEqual (which throws on a mismatch).
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
