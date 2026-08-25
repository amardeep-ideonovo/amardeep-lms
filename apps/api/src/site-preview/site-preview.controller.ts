import {
  Body,
  Controller,
  HttpCode,
  Ip,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ProxyAwareThrottlerGuard } from "../common/proxy-aware-throttler.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequirePermission } from "../auth/require-permission.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedPrincipal } from "../auth/jwt-payload.interface";
import { AuditService } from "../audit/audit.service";
import { SitePreviewService } from "./site-preview.service";
import { ExchangePreviewDto } from "./dto/exchange-preview.dto";

// Admin no-account preview of the member site. Two admin-guarded actions
// (start / end) plus one PUBLIC exchange the member web calls with the handoff.
@Controller()
export class SitePreviewController {
  constructor(
    private readonly preview: SitePreviewService,
    private readonly audit: AuditService,
  ) {}

  // Begin a preview: ensure the hidden identities and return a 60s handoff.
  @Post("admin/site-preview")
  @HttpCode(200)
  @UseGuards(PermissionsGuard)
  @RequirePermission("sitePreview", "read")
  async start(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Ip() ip: string,
  ): Promise<{ handoff: string }> {
    const result = await this.preview.startPreview();
    await this.audit.write({
      actorAdminId: principal.sub,
      action: "site_preview.start",
      ip,
      metadata: { via: "admin_dashboard" },
    });
    return result;
  }

  // End/revoke every live preview session (kill switch).
  @Post("admin/site-preview/end")
  @HttpCode(200)
  @UseGuards(PermissionsGuard)
  @RequirePermission("sitePreview", "read")
  async end(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Ip() ip: string,
  ): Promise<{ ok: true }> {
    const result = await this.preview.endPreview();
    await this.audit.write({
      actorAdminId: principal.sub,
      action: "site_preview.end",
      ip,
    });
    return result;
  }

  // PUBLIC: the member web exchanges the handoff for the two read-only preview
  // session tokens. Tightly throttled (a handoff is single-shot in practice).
  @Post("site-preview/exchange")
  @HttpCode(200)
  @UseGuards(ProxyAwareThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  exchange(
    @Body() dto: ExchangePreviewDto,
  ): Promise<{ unlockedToken: string; lockedToken: string }> {
    return this.preview.exchange(dto.handoff);
  }
}
