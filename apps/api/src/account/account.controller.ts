import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ProxyAwareThrottlerGuard } from "../common/proxy-aware-throttler.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedPrincipal } from "../auth/jwt-payload.interface";
import { AccountDeletionService } from "./account-deletion.service";
import { DeleteAccountDto } from "./dto/delete-account.dto";

// Member self-service account deletion. Lives under /auth/me/* alongside the
// other member self-service routes but in its own controller so the deletion
// orchestration (which pulls in Billing + Certificates) doesn't couple into
// AuthModule.
@Controller("auth")
export class AccountController {
  constructor(private readonly deletion: AccountDeletionService) {}

  // What the member will irrecoverably lose — shown before they confirm.
  @UseGuards(JwtAuthGuard)
  @Get("me/delete-summary")
  summary(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.deletion.summaryFor(principal.sub);
  }

  // Permanently delete the caller's own account. Password re-auth required;
  // rate-limited like login (it verifies a password, so it must not be a
  // brute-force oracle). 200 — no resource created; the account is gone.
  @UseGuards(JwtAuthGuard, ProxyAwareThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("me/delete")
  @HttpCode(200)
  deleteMe(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: DeleteAccountDto,
  ) {
    return this.deletion.deleteMember(principal.sub, {
      password: dto.password,
      actor: { kind: "self" },
    });
  }
}
