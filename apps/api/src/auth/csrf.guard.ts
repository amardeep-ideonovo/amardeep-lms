import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { CSRF_COOKIE, SESSION_COOKIE, readCookie } from "./cookie.util";

// CSRF protection for the COOKIE-authenticated web session (double-submit
// token). A global guard, but it only ever acts on cookie-authed, unsafe-method
// requests — everything else is skipped so it can't break the Bearer clients or
// public/webhook routes:
//   - safe methods (GET/HEAD/OPTIONS): skip (no state change)
//   - Authorization: Bearer present (mobile, admin, server-to-server, bdd):
//     skip — bearer credentials aren't attached by the browser automatically,
//     so they're immune to CSRF by construction.
//   - no session cookie present (login/signup/forgot/reset, raw-body webhooks):
//     skip — there's no ambient credential to abuse.
// Otherwise: require the X-CSRF-Token header to equal the csrf_token cookie. A
// cross-site attacker can't read the (same-site) cookie to echo it, so a forged
// request has no matching header.
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    // Non-HTTP contexts (e.g. websocket) have no HTTP request — nothing to check.
    if (ctx.getType() !== "http") return true;
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
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new ForbiddenException("Invalid or missing CSRF token");
    }
    return true;
  }
}
