import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ServiceTokenGuard } from '../auth/guards/service-token.guard';
import { SupportSyncService } from './support-sync.service';

// Cross-plane push-back receiver. The control plane POSTs here — authenticated
// with the per-instance service token — the instant an operator/client changes a
// ticket, so we pull the update NOW instead of waiting up to 30s for the cron.
// The push is best-effort on the sender's side (the cron is the safety net), so
// we just kick a pull and return 202 immediately without holding the connection.
@UseGuards(ServiceTokenGuard)
@Controller('support')
export class SupportSyncController {
  constructor(private readonly sync: SupportSyncService) {}

  @Post('push')
  @HttpCode(202)
  push(): { ok: true } {
    // Fire-and-forget: don't make the control plane wait on our reconcile (which
    // itself calls back to the control plane). requestSync coalesces with any
    // in-flight sync so a change that landed mid-sync is still picked up.
    void this.sync.requestSync();
    return { ok: true };
  }
}
