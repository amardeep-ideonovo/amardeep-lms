import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { PushService, type PushCategory } from "../push/push.service";

// One scheduled session with the fields the reminder cron needs.
type ReminderSession = {
  id: string;
  title: string;
  audience: "ALL_ACTIVE" | "LEVELS";
  startsAt: Date;
  joinLeadMin: number;
  targets: { levelId: string }[];
};

// Fires the two live-session member pushes off a minute cron:
//   - live-starting-soon  at startsAt - joinLeadMin (dedupe: reminderSentAt)
//   - live-now            at startsAt                (dedupe: liveNowSentAt)
// Each fire is guarded by an atomic marker claim (updateMany where marker IS NULL),
// so an overlapping tick / second instance can't double-send. The push itself
// goes through the PushOutbox fan-out (dispatchToLevels), deep-linking the in-app
// join bar — NEVER credentials, which the live service releases only in-window.
@Injectable()
export class LiveReminderService {
  private readonly logger = new Logger(LiveReminderService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.running) return; // per-process overlap guard (the DB claim is the real one)
    this.running = true;
    try {
      const now = new Date();
      await this.fireStartingSoon(now);
      await this.fireLiveNow(now);
    } catch (err) {
      this.logger.warn(
        `[live] reminder tick failed: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.running = false;
    }
  }

  // "Starting soon": the session is still in the future and we've crossed its
  // per-session lead window. joinLeadMin is per-row so the window check is in JS.
  private async fireStartingSoon(now: Date): Promise<void> {
    const candidates = await this.prisma.liveSession.findMany({
      where: {
        status: "SCHEDULED",
        reminderSentAt: null,
        startsAt: { gt: now },
      },
      include: { targets: { select: { levelId: true } } },
    });
    for (const s of candidates) {
      const leadMs = s.joinLeadMin * 60_000;
      if (now.getTime() < s.startsAt.getTime() - leadMs) continue; // not yet
      const claim = await this.prisma.liveSession.updateMany({
        where: { id: s.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (claim.count !== 1) continue; // lost the race
      await this.enqueue(s, "starting-soon");
    }
  }

  // "Live now": the session has started and hasn't ended. The endsAt gate keeps
  // a cron outage from firing a stale "live now" for a session already over.
  private async fireLiveNow(now: Date): Promise<void> {
    const candidates = await this.prisma.liveSession.findMany({
      where: {
        status: "SCHEDULED",
        liveNowSentAt: null,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      include: { targets: { select: { levelId: true } } },
    });
    for (const s of candidates) {
      const claim = await this.prisma.liveSession.updateMany({
        where: { id: s.id, liveNowSentAt: null },
        data: { liveNowSentAt: now },
      });
      if (claim.count !== 1) continue;
      await this.enqueue(s, "now");
    }
  }

  private async enqueue(
    s: ReminderSession,
    kind: "starting-soon" | "now",
  ): Promise<void> {
    const broadcast = s.audience === "ALL_ACTIVE";
    // LEVELS with no targets fails closed (invisible to all) — matching access
    // semantics; broadcast reaches every member with >=1 active grant.
    const levelIds = broadcast ? [] : s.targets.map((t) => t.levelId);
    const category: PushCategory =
      kind === "starting-soon" ? "live-starting-soon" : "live-now";
    const body =
      kind === "starting-soon"
        ? `"${s.title}" starts soon — tap to join.`
        : `"${s.title}" is live now — tap to join.`;
    await this.push.dispatchToLevels(levelIds, {
      category,
      body,
      href: `live/${s.id}`,
      dedupePrefix: `${category}:${s.id}`,
      broadcast,
    });
  }
}
