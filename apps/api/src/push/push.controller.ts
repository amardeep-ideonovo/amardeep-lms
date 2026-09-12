import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedPrincipal } from "../auth/jwt-payload.interface";
import {
  RegisterDeviceTokenDto,
  UnregisterDeviceTokenDto,
} from "./dto/register-device-token.dto";
import { PushService } from "./push.service";

// Member-facing device-token registration for push. Same JWT guard members and
// admins share (NOT the admin RBAC guard). Bearer requests bypass the global
// CsrfGuard, and preview-member sessions are blocked from writes by the global
// PreviewReadOnlyGuard — no extra work here. Member id is principal.sub.
@UseGuards(JwtAuthGuard)
@Controller("push")
export class PushController {
  constructor(private readonly push: PushService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("register")
  @HttpCode(200)
  async register(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Body() dto: RegisterDeviceTokenDto,
  ): Promise<{ ok: true }> {
    // The member app is the only push surface; an admin principal has no User
    // row, so a DeviceToken FK would 500. No-op it.
    if (p.isAdmin) return { ok: true };
    return this.push.register(p.sub, dto);
  }

  @Delete("register")
  @HttpCode(204)
  async unregister(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Body() dto: UnregisterDeviceTokenDto,
  ): Promise<void> {
    if (p.isAdmin) return;
    return this.push.unregister(p.sub, dto.token);
  }
}
