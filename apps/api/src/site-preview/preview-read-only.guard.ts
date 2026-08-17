import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import type { ErrorCode } from "@lms/types";
import type { JwtPayload } from "../auth/jwt-payload.interface";

// Global guard that makes the admin "preview member" sessions strictly
// read-only: any state-changing request carrying a preview JWT is rejected.
// One guard covers EVERY write route (checkout, account delete, profile,
// progress, cert claim, …) so the synthetic preview users can never write a
// row — which is what keeps them free of relational data and safe to hide with
// a handful of `isPreview: false` filters.
//
// It runs on every request but stays cheap: safe verbs pass immediately, and it
// only decodes a token when a write carries an Authorization bearer. It trusts
// the signed `isPreview` claim (HMAC-unforgeable); a forged/expired/absent
// token is passed through so the route's own JWT guard produces the usual 401.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

@Injectable()
export class PreviewReadOnlyGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;

    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return true; // not our concern
    const token = header.slice("Bearer ".length).trim();
    if (!token) return true;

    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token);
    } catch {
      return true; // malformed/expired → let the route's JWT guard 401
    }
    if (payload.isPreview) {
      throw new ForbiddenException({
        code: "PREVIEW_READ_ONLY" satisfies ErrorCode,
        message: "Preview mode is read-only — changes can't be saved.",
      });
    }
    return true;
  }
}
