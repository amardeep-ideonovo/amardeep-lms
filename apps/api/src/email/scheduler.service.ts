import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CampaignService } from './campaign.service';

// The single recurring tick that drives campaign delivery. Every minute it asks
// CampaignService to dispatch any campaign whose nextRunAt has arrived. Wrapped
// so a transient DB/send error in one tick is logged and never crashes the
// scheduler (the next minute retries). CampaignService.runDueCampaigns already
// isolates per-campaign failures; this guard covers the tick as a whole.
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  // Guard against overlap: if a tick is still running when the next fires
  // (e.g. a large/slow broadcast), skip rather than double-dispatch.
  private running = false;

  constructor(private readonly campaigns: CampaignService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.running) {
      this.logger.debug('campaign tick skipped — previous run still in progress');
      return;
    }
    this.running = true;
    try {
      const dispatched = await this.campaigns.runDueCampaigns();
      if (dispatched > 0) {
        this.logger.log(`campaign tick dispatched ${dispatched} campaign(s)`);
      }
    } catch (err) {
      this.logger.error(
        `campaign tick failed: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.running = false;
    }
  }
}
