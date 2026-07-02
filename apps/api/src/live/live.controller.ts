import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { LiveService } from './live.service';
import { LiveThrottlerGuard } from './live.throttler.guard';

// Member-facing live-session routes. Every route requires a logged-in member and
// is gated by entitlement; the dashboard bar and shell never carry credentials.
@UseGuards(JwtAuthGuard)
@Controller('live')
export class LiveController {
  constructor(private readonly live: LiveService) {}

  // The dashboard bar: current + soonest-upcoming sessions this member can see.
  @Get('current')
  current(@CurrentUser() p: AuthenticatedPrincipal) {
    return this.live.currentForUser(p.sub);
  }

  // The join-page shell (no credentials): 403 not-entitled, 404 draft/unknown,
  // 410 canceled (for an entitled member who could previously see it).
  @Get(':id')
  get(@CurrentUser() p: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.live.barForUser(p.sub, id);
  }

  // The only endpoint that decrypts + returns the join URL/passcode — entitled +
  // inside the window + SCHEDULED, throttled per member, and audited.
  @UseGuards(LiveThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get(':id/credentials')
  credentials(@CurrentUser() p: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.live.credentialsForUser(p.sub, id);
  }
}
