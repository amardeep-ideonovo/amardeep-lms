import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedPrincipal } from './jwt-payload.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Login authenticates an existing user — it doesn't create a resource, so 200
  // (not Nest's default 201 for POST).
  @Post('login')
  @HttpCode(200)
  memberLogin(@Body() dto: LoginDto) {
    return this.auth.loginMember(dto.email, dto.password);
  }

  @Post('admin/login')
  @HttpCode(200)
  adminLogin(@Body() dto: LoginDto) {
    return this.auth.loginAdmin(dto.email, dto.password);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.auth.me(principal);
  }
}
