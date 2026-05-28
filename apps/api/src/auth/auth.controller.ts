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
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedPrincipal } from './jwt-payload.interface';

// Rate-limit overrides via env var (see .env.example). Defaults to 5/min/IP
// for login and admin/login, which is enough for legitimate retries without
// letting a password-spray attack run unchecked. Per-IP — `trust proxy` is
// set in main.ts so req.ip resolves to the real client behind a CDN/LB.
const LOGIN_LIMIT = Number(process.env.THROTTLE_LOGIN_LIMIT) || 5;
const LOGIN_TTL_MS = 60_000;

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

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.auth.me(principal);
  }
}
