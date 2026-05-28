import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
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

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.auth.me(principal);
  }
}
