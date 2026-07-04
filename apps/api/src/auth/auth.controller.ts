import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateAdminPrefsDto } from './dto/update-admin-prefs.dto';
import { UpdateAdminProfileDto } from './dto/update-admin-profile.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedPrincipal } from './jwt-payload.interface';

// Rate-limit overrides via env var (see .env.example). Defaults to 5/min/IP
// for login and admin/login, which is enough for legitimate retries without
// letting a password-spray attack run unchecked. Per-IP — `trust proxy` is
// set in main.ts so req.ip resolves to the real client behind a CDN/LB.
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
    process.env.PUBLIC_API_URL?.replace(/\/$/, '') ||
    `${req.protocol}://${req.get('host')}`
  );
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Login authenticates an existing user — it doesn't create a resource, so 200
  // (not Nest's default 201 for POST).
  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: LOGIN_LIMIT, ttl: LOGIN_TTL_MS } })
  memberLogin(@Body() dto: LoginDto) {
    return this.auth.loginMember(dto.email, dto.password);
  }

  @Post('admin/login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: LOGIN_LIMIT, ttl: LOGIN_TTL_MS } })
  adminLogin(@Body() dto: LoginDto) {
    return this.auth.loginAdmin(dto.email, dto.password);
  }

  // Public signup. Returns LoginResponse<AuthUser> on 200 so the client can
  // drop straight into the authenticated app. 409 on duplicate email, 403 on
  // invalid invite code (when SIGNUP_INVITE_CODE is set), 400 on validation.
  // No 201 because the response shape is identical to login (token + user).
  @Post('signup')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: SIGNUP_LIMIT, ttl: SIGNUP_TTL_MS } })
  memberSignup(@Body() dto: SignupDto) {
    return this.auth.signupMember(dto);
  }

  // Member self-serve password reset, step 1. ALWAYS 200 with { ok: true } —
  // success and unknown-email are deliberately indistinguishable so the
  // endpoint can't enumerate accounts. Tightly throttled: each hit on a real
  // account sends an email.
  @Post('forgot-password')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: FORGOT_LIMIT, ttl: FORGOT_TTL_MS } })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  // Member self-serve password reset, step 2. The emailed signed token is the
  // credential; 400 on any invalid/expired/already-used token. Rate-limited
  // like login (the token is unguessable, but there's no reason to allow
  // hammering an unauthenticated password-writing route).
  @Post('reset-password')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: LOGIN_LIMIT, ttl: LOGIN_TTL_MS } })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.auth.me(principal);
  }

  // Member self-service: update own name + username (NOT email). Also clears
  // the profile photo when { removeAvatar: true } is sent.
  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateMe(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(principal.sub, dto);
  }

  // Member self-service: upload own profile photo (image only, max 8 MB).
  @UseGuards(JwtAuthGuard)
  @Post('me/avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
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
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: LOGIN_LIMIT, ttl: LOGIN_TTL_MS } })
  @Post('change-password')
  @HttpCode(200)
  changePassword(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(principal.sub, dto);
  }

  // Admin self-service password change (separate table from members).
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: LOGIN_LIMIT, ttl: LOGIN_TTL_MS } })
  @Post('admin/change-password')
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
  @Patch('admin/prefs')
  updateAdminPrefs(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: UpdateAdminPrefsDto,
  ) {
    return this.auth.updateAdminPrefs(principal.sub, dto);
  }

  // Admin self-service: update display name / remove avatar.
  @UseGuards(AdminGuard)
  @Patch('admin/profile')
  updateAdminProfile(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: UpdateAdminProfileDto,
  ) {
    return this.auth.updateAdminProfile(principal.sub, dto);
  }

  // Admin self-service: upload a profile photo (image only, max 8 MB).
  @UseGuards(AdminGuard)
  @Post('admin/avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
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
