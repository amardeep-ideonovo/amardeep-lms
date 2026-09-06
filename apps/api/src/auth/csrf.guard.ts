import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { timingSafeEqual } from "crypto";
import type { Request } from "express";
import { CSRF_COOKIE, SESSION_COOKIE, readCookie } from "./cookie.util";
import { SKIP_CSRF_KEY } from "./skip-csrf.decorator";

// Constant-time string compare (both are hex tokens). timingSafeEqual throws on
// unequal lengths, so guard that first; a length mismatch is already a mismatch.
function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// CSRF protection for the COOKIE-authenticated web session (double-submit
// token). A global guard, but it only ever acts on cookie-authed, unsafe-method
// requests — everything else is skipped so it can't break the Bearer clients or
// public/webhook routes:
//   - non-HTTP contexts (websocket): skip (no HTTP request to check)
//   - routes marked @SkipCsrf() (login/signup/forgot/reset — session bootstrap):
//     skip, so a stale session cookie can't deadlock re-authentication.
//   - safe methods (GET/HEAD/OPTIONS): skip (no state change)
//   - Authorization: Bearer present (mobile, admin, server-to-server, bdd):
//     skip — bearer credentials aren't attached by the browser automatically,
//     so they're immune to CSRF by construction.
//   - no session cookie present (raw-body webhooks, logged-out POSTs):
//     skip — there's no ambient credential to abuse.
// Otherwise: require the X-CSRF-Token header to equal the csrf_token cookie. A
// cross-site attacker can't read the (same-site) cookie to echo it, so a forged
// request has no matching header. The web echoes the token the API returned in
// the login/signup response body (it can't read the API-host cookie directly).
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    // Non-HTTP contexts (e.g. websocket) have no HTTP request — nothing to
    // check, and no route handler for the reflector to inspect.
    if (ctx.getType() !== "http") return true;

    // Session-bootstrap routes opt out explicitly (see @SkipCsrf()).
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (skip) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const method = (req.method || "GET").toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return true;
    }
    const hasBearer =
      typeof req.headers?.authorization === "string" &&
      req.headers.authorization.startsWith("Bearer ");
    if (hasBearer) return true;

    const sessionCookie = readCookie(req, SESSION_COOKIE);
    if (!sessionCookie) return true; // not a cookie session → nothing to protect

    const cookieToken = readCookie(req, CSRF_COOKIE);
    const headerRaw = req.headers?.["x-csrf-token"];
    const headerToken = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
    if (!cookieToken || !headerToken || !tokensMatch(cookieToken, headerToken)) {
      throw new ForbiddenException("Invalid or missing CSRF token");
    }
    return true;
  }
}
