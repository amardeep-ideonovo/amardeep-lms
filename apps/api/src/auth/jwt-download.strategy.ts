import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { Request } from "express";
import { jwtSecret } from "../common/env.util";
import type {
  AuthenticatedPrincipal,
  JwtPayload,
} from "./jwt-payload.interface";
import {
  certDownloadScope,
  helpdeskAttachmentDownloadScope,
  noteDownloadScope,
  type DownloadTokenPayload,
} from "./download-token.util";
import { SESSION_COOKIE, readCookie } from "./cookie.util";

// JWT strategy for the file-download routes. It accepts the token from the
// Authorization header (preferred — used by the web app's authed blob download)
// OR from a `?token=` query param (used by mobile, which opens the URL in the
// device browser and can't send a header).
//
// SECURITY: the query-string path accepts ONLY a short-lived, resource-scoped
// download token (typ:"dl", see download-token.util). A full session JWT is no
// longer honoured in the query string, so it can never be exfiltrated via a
// leaked URL. The header path is unchanged (a normal session JWT), because a
// header is not logged/refererred the way a URL is.
@Injectable()
export class JwtDownloadStrategy extends PassportStrategy(
  Strategy,
  "jwt-download",
) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // The web's httpOnly session cookie (a full session JWT, like the header
        // path) — sent automatically on credentialed download fetches.
        (req: Request) => readCookie(req, SESSION_COOKIE),
        (req: Request) =>
          typeof req?.query?.token === "string" ? req.query.token : null,
      ]),
      ignoreExpiration: false,
      secretOrKey: jwtSecret(config.get<string>("JWT_SECRET")),
      passReqToCallback: true,
    });
  }

  validate(
    req: Request,
    payload: JwtPayload | DownloadTokenPayload,
  ): AuthenticatedPrincipal {
    // A full session JWT is fine from the Authorization header OR the httpOnly
    // session cookie (both are session credentials the browser/app holds). Only
    // the ?token= query path must be a correctly-scoped, short-lived download
    // token — that's the value that can leak via a URL.
    const fromSession =
      typeof req.headers?.authorization === "string" ||
      readCookie(req, SESSION_COOKIE) != null;
    if (!fromSession) {
      const dl = payload as DownloadTokenPayload;
      if (dl.typ !== "dl" || !this.scopeMatches(dl.scope, req)) {
        throw new UnauthorizedException("Invalid or expired download token.");
      }
    }
    // A `dl` token no longer carries email/username (it omits PII), so default
    // them here — the download services only read `sub` + `isAdmin`. A header
    // (session-JWT) token still supplies the real values.
    return {
      sub: payload.sub,
      email: (payload as JwtPayload).email ?? "",
      username: (payload as JwtPayload).username,
      isAdmin: payload.isAdmin,
      role: payload.role,
    };
  }

  // Defence-in-depth on top of the per-resource access check the controllers
  // run: the token's scope must match the route it's used on, so a token minted
  // for one note/cert can't be replayed against another.
  private scopeMatches(scope: string | undefined, req: Request): boolean {
    if (!scope) return false;
    const params = (req.params ?? {}) as { id?: string; noteId?: string };
    if (scope.startsWith("note:")) {
      return scope === noteDownloadScope(params.id ?? "", params.noteId ?? "");
    }
    if (scope.startsWith("cert:")) {
      return scope === certDownloadScope(params.id ?? "");
    }
    if (scope.startsWith("hd:")) {
      return scope === helpdeskAttachmentDownloadScope(params.id ?? "");
    }
    return false;
  }
}
