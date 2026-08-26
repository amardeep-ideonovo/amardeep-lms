import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { removeHelpdeskFiles } from "./helpdesk-files.util";

// Admin notifications have NO FK and no other purge path, and the sidebar's 30s
// unread anti-join counts every row — so member-volume helpdesk notifications
// would grow that table forever without this.
const NOTIFICATION_RETENTION_DAYS = 90;

// Bound the per-run delete so one sweep can't lock the table on a huge backlog;
// the daily cadence drains the rest over subsequent runs.
const MAX_PER_RUN = 500;

@Injectable()
export class HelpdeskRetentionService {
  private readonly logger = new Logger(HelpdeskRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Daily sweep: purge terminal conversations past the academy's retention
  // window, then prune old helpdesk admin-notifications. Auto-discovered by the
  // ScheduleModule explorer (registered app-wide in EmailModule).
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async sweep(): Promise<void> {
    try {
      await this.purgeTerminalConversations();
      await this.pruneNotifications();
    } catch (err) {
      this.logger.warn(
        `helpdesk retention sweep failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private async purgeTerminalConversations(): Promise<void> {
    const settings = await this.prisma.helpdeskSettings.findUnique({
      where: { id: "singleton" },
    });
    const days = settings?.retentionDays ?? 365;
    if (!days || days <= 0) return; // 0 = keep forever

    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - days);

    // Terminal (RESOLVED or CLOSED) and untouched since the cutoff. Open threads
    // are never purged, however old.
    const stale = await this.prisma.helpdeskConversation.findMany({
      where: {
        status: { in: ["RESOLVED", "CLOSED"] },
        updatedAt: { lt: cutoff },
      },
      select: { id: true },
      take: MAX_PER_RUN,
    });
    if (stale.length === 0) return;
    const ids = stale.map((c) => c.id);

    // Collect attachment file keys BEFORE the rows cascade away.
    const attachments = await this.prisma.helpdeskAttachment.findMany({
      where: { message: { conversationId: { in: ids } } },
      select: { fileKey: true },
    });

    // Drop the now-dead deep-link on any admin notifications pointing here
    // (notifications have no FK, so a cascade won't touch them).
    await this.prisma.adminNotification.updateMany({
      where: { entityType: "helpdesk", entityId: { in: ids } },
      data: { entityType: null, entityId: null },
    });

    // Delete conversations — cascades messages, attachments and tickets.
    const { count } = await this.prisma.helpdeskConversation.deleteMany({
      where: { id: { in: ids } },
    });

    // Then the on-disk files (a row delete never removes bytes).
    await removeHelpdeskFiles(attachments.map((a) => a.fileKey));

    this.logger.log(
      `[helpdesk-retention] purged ${count} terminal conversations older than ${days}d`,
    );
  }

  private async pruneNotifications(): Promise<void> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - NOTIFICATION_RETENTION_DAYS);
    const { count } = await this.prisma.adminNotification.deleteMany({
      where: {
        type: { in: ["HELPDESK_ESCALATED", "HELPDESK_UNANSWERED"] },
        createdAt: { lt: cutoff },
      },
    });
    if (count > 0) {
      this.logger.log(
        `[helpdesk-retention] pruned ${count} old helpdesk notifications`,
      );
    }
  }
}
