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
//   - live-starting-soon  at startsAt - joinLeadMin (marker: reminderSentAt)
//   - live-now            at startsAt                (marker: liveNowSentAt)
// The push is ENQUEUED first (PushService.enqueueFanout -> PushOutbox), and the
// marker is stamped only on a confirmed enqueue (see fireOnce) so a transient
// failure retries next tick. The unique dedupePrefix — not the marker — is the
// real dedupe: concurrent ticks/instances collapse to one outbox row => one
// push. Deep-links the in-app join bar, NEVER credentials (released in-window).
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
      orderBy: { startsAt: "asc" }, // imminent first; take bounds a large backlog
      take: 500,
    });
    for (const s of candidates) {
      // No advance reminder when there's no lead time — "live now" fires at
      // start, so a zero-lead session gets exactly one push (not none, not two).
      if (s.joinLeadMin <= 0) continue;
      const leadMs = s.joinLeadMin * 60_000;
      if (now.getTime() < s.startsAt.getTime() - leadMs) continue; // window not open
      await this.fireOnce(s, "starting-soon", now);
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
      orderBy: { startsAt: "asc" },
      take: 500,
    });
    for (const s of candidates) {
      await this.fireOnce(s, "now", now);
    }
  }

  // Enqueue FIRST, then stamp the marker ONLY on a confirmed enqueue. A transient
  // enqueue failure (or a crash before the stamp) leaves the marker null so the
  // next tick retries — and the unique dedupePrefix makes that retry idempotent
  // (one outbox row => one push), which is also what keeps concurrent instances
  // safe without the marker being the race gate.
  private async fireOnce(
    s: ReminderSession,
    kind: "starting-soon" | "now",
    now: Date,
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
    const ok = await this.push.enqueueFanout(levelIds, {
      category,
      body,
      href: `live/${s.id}`,
      dedupePrefix: `${category}:${s.id}`,
      broadcast,
    });
    if (!ok) return; // leave the marker null — next tick retries
    const marker =
      kind === "starting-soon" ? "reminderSentAt" : "liveNowSentAt";
    await this.prisma.liveSession.updateMany({
      where: { id: s.id, [marker]: null },
      data: { [marker]: now },
    });
  }
}
