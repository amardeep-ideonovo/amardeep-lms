import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
// Relative on purpose — see packages/types/constants.ts (API value imports).
import { MAX_AVATAR_UPLOAD_BYTES } from "../../../../packages/types/constants";
import type { Request, Response } from "express";
import { setAuthCookies, clearAuthCookies } from "./cookie.util";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { SignupDto } from "./dto/signup.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { UpdateAdminPrefsDto } from "./dto/update-admin-prefs.dto";
import { UpdateAdminProfileDto } from "./dto/update-admin-profile.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { AdminGuard } from "./guards/admin.guard";
import { CurrentUser } from "./current-user.decorator";
import type { AuthenticatedPrincipal } from "./jwt-payload.interface";

// Rate-limit overrides via env var (see .env.example). Defaults to 5/min/IP
// for login and admin/login, which is enough for legitimate retries without
// letting a password-spray attack run unchecked.
//
// ENFORCEMENT: the global GlobalThrottlerGuard (APP_GUARD, see app.module)
// applies these @Throttle overrides on every route, keyed on the REAL client
// IP (rightmost X-Forwarded-For — see ProxyAwareThrottlerGuard). Do NOT also
// attach a ThrottlerGuard per-route "for safety": it evaluates the same
// throttler name against the same route context and tracker, so every request
// is counted twice and the effective limit silently halves (observed live
// 2026-08-25 — the old per-route stock guards additionally keyed on bare
// req.ip, which behind Caddy fused the whole academy into ONE bucket: five
// stranger requests a minute locked login/signup/reset for everyone).
const LOGIN_LIMIT = Number(process.env.THROTTLE_LOGIN_LIMIT) || 5;
const LOGIN_TTL_MS = 60_000;
// Signup is tighter — 3/min/IP — because each call creates a row and can
// be used to enumerate which emails are registered (409 vs 200).
const SIGNUP_LIMIT = Number(process.env.THROTTLE_SIGNUP_LIMIT) || 3;
const SIGNUP_TTL_MS = 60_000;
// Forgot-password matches signup's 3/min/IP: every hit on a real account
// sends a mail, so the cap keeps the endpoint useless as a mail cannon and
// slows probing (the response itself never reveals whether an account exists).
const FORGOT_LIMIT = Number(process.env.THROTTLE_FORGOT_LIMIT) || 3;
const FORGOT_TTL_MS = 60_000;

// Absolute base for the embeddable avatar URL. Mirrors media.controller.
function baseUrlOf(req: Request): string {
  return (
    process.env.PUBLIC_API_URL?.replace(/\/$/, "") ||
    `${req.protocol}://${req.get("host")}`
  );
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Login authenticates an existing user — it doesn't create a resource, so 200
  // (not Nest's default 201 for POST).
  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { limit: LOGIN_LIMIT, ttl: LOGIN_TTL_MS } })
  async memberLogin(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.loginMember(dto.email, dto.password);
    // Web reads the httpOnly session cookie; the response body still carries
    // `token` for the mobile app (Bearer + secure-store) and the BDD suite.
    setAuthCookies(res, result.token);
    return result;
  }

  @Post("admin/login")
  @HttpCode(200)
  @Throttle({ default: { limit: LOGIN_LIMIT, ttl: LOGIN_TTL_MS } })
  adminLogin(@Body() dto: LoginDto) {
    return this.auth.loginAdmin(dto.email, dto.password);
  }

  // Public signup. Returns LoginResponse<AuthUser> on 200 so the client can
  // drop straight into the authenticated app. 409 on duplicate email, 403 on
  // invalid invite code (when SIGNUP_INVITE_CODE is set), 400 on validation.
  // No 201 because the response shape is identical to login (token + user).
  @Post("signup")
  @HttpCode(200)
  @Throttle({ default: { limit: SIGNUP_LIMIT, ttl: SIGNUP_TTL_MS } })
  async memberSignup(
    @Body() dto: SignupDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.signupMember(dto);
    setAuthCookies(res, result.token);
    return result;
  }

  // Member self-serve password reset, step 1. ALWAYS 200 with { ok: true } —
  // success and unknown-email are deliberately indistinguishable so the
  // endpoint can't enumerate accounts. Tightly throttled: each hit on a real
  // account sends an email.
  @Post("forgot-password")
  @HttpCode(200)
  @Throttle({ default: { limit: FORGOT_LIMIT, ttl: FORGOT_TTL_MS } })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  // Member self-serve password reset, step 2. The emailed signed token is the
  // credential; 400 on any invalid/expired/already-used token. Rate-limited
  // like login (the token is unguessable, but there's no reason to allow
  // hammering an unauthenticated password-writing route).
  @Post("reset-password")
  @HttpCode(200)
  @Throttle({ default: { limit: LOGIN_LIMIT, ttl: LOGIN_TTL_MS } })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  me(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.auth.me(principal);
  }

  // Member self-service: update own name + username (NOT email). Also clears
  // the profile photo when { removeAvatar: true } is sent.
  @UseGuards(JwtAuthGuard)
  @Patch("me")
  updateMe(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(principal.sub, dto);
  }

  // Member self-service: upload own profile photo (image only, max 8 MB).
  @UseGuards(JwtAuthGuard)
  @Post("me/avatar")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MAX_AVATAR_UPLOAD_BYTES },
    }),
  )
  uploadMyAvatar(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.auth.setUserAvatar(principal.sub, file, baseUrlOf(req));
  }

  // Change own password. Requires the current password; rate-limited (5/min/IP)
  // to slow brute-forcing it. 200 (not 201) — no resource is created.
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: LOGIN_LIMIT, ttl: LOGIN_TTL_MS } })
  @Post("change-password")
  @HttpCode(200)
  async changePassword(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.changePassword(principal.sub, dto);
    // A password change bumps tokenVersion, so the OLD session cookie is now
    // stale — re-issue cookies with the rotated token so the web member stays
    // signed in instead of 401-ing on the next request.
    setAuthCookies(res, result.token);
    return result;
  }

  // Member logout: clear the session/CSRF/hint cookies (JS can't delete an
  // httpOnly cookie). No auth guard so an already-expired session can still
  // clear its cookies; the CSRF guard still applies (the web sends the token).
  @Post("logout")
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    clearAuthCookies(res);
  }

  // Admin self-service password change (separate table from members).
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: LOGIN_LIMIT, ttl: LOGIN_TTL_MS } })
  @Post("admin/change-password")
  @HttpCode(200)
  changeAdminPassword(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changeAdminPassword(principal.sub, dto);
  }

  // Admin self-service: save personal UI preferences (e.g. a custom sidebar
  // order). Every admin manages their OWN prefs — AdminGuard only requires a
  // valid admin token (no per-section permission needed). Returns the refreshed
  // AuthAdmin so the client can update its cached `me` in place.
  @UseGuards(AdminGuard)
  @Patch("admin/prefs")
  updateAdminPrefs(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: UpdateAdminPrefsDto,
  ) {
    return this.auth.updateAdminPrefs(principal.sub, dto);
  }

  // Admin self-service: update display name / remove avatar.
  @UseGuards(AdminGuard)
  @Patch("admin/profile")
  updateAdminProfile(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: UpdateAdminProfileDto,
  ) {
    return this.auth.updateAdminProfile(principal.sub, dto);
  }

  // Admin self-service: upload a profile photo (image only, max 8 MB).
  @UseGuards(AdminGuard)
  @Post("admin/avatar")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MAX_AVATAR_UPLOAD_BYTES },
    }),
  )
  uploadAvatar(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.auth.setAdminAvatar(principal.sub, file, baseUrlOf(req));
  }
}
