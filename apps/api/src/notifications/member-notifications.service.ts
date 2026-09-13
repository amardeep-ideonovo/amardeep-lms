import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type {
  MemberNotificationDTO,
  MemberNotificationListDTO,
} from "@lms/types";
import { PrismaService } from "../prisma/prisma.service";

// Input for one durable inbox row. dedupeKey is per-recipient and mirrors the
// push key so one logical event yields exactly one inbox row (a replay is a
// no-op via the @unique).
export interface RecordMemberNotificationInput {
  userId: string;
  category: string;
  title: string;
  body: string;
  href: string;
  dedupeKey: string;
}

// Inbox rows older than this are pruned (read or not) so the table stays bounded
// under high-fan-out events.
const RETENTION_DAYS = 90;

@Injectable()
export class MemberNotificationsService {
  private readonly logger = new Logger(MemberNotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Write one inbox row. Best-effort and idempotent (duplicate dedupeKey is a
  // no-op) — callers (the push paths) invoke this regardless of push opt-out, so
  // it must never throw into a webhook / cron / reply flow.
  async record(input: RecordMemberNotificationInput): Promise<void> {
    try {
      await this.prisma.memberNotification.create({
        data: {
          userId: input.userId,
          category: input.category,
          title: input.title,
          body: input.body,
          href: input.href,
          dedupeKey: input.dedupeKey,
        },
      });
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      if (code === "P2002") return; // already recorded — idempotent
      this.logger.warn(
        `[member-notif] record failed (${input.dedupeKey}): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  // Write inbox rows for many recipients at once (fan-out). createMany +
  // skipDuplicates makes a re-drain a no-op. Unlike record(), this THROWS on a
  // DB error — the fan-out drain relies on that to retry (its content/live
  // categories have no email fallback, so the inbox must be durable).
  async recordMany(
    userIds: string[],
    base: Omit<RecordMemberNotificationInput, "userId" | "dedupeKey"> & {
      dedupePrefix: string;
    },
  ): Promise<void> {
    if (userIds.length === 0) return;
    await this.prisma.memberNotification.createMany({
      data: userIds.map((userId) => ({
        userId,
        category: base.category,
        title: base.title,
        body: base.body,
        href: base.href,
        dedupeKey: `${base.dedupePrefix}:${userId}`,
      })),
      skipDuplicates: true,
    });
  }

  // Paginated feed for one member, newest first, with the member's global unread
  // total (across the whole feed, not the page).
  async list(opts: {
    userId: string;
    page?: number;
    pageSize?: number;
  }): Promise<MemberNotificationListDTO> {
    // Coerce-and-clamp with finite guards: a non-numeric/fractional ?page or
    // ?pageSize would otherwise reach Prisma as skip/take NaN and 500.
    const rawPage = Number(opts.page);
    const rawSize = Number(opts.pageSize);
    const page = Number.isFinite(rawPage)
      ? Math.max(1, Math.floor(rawPage))
      : 1;
    const pageSize = Number.isFinite(rawSize)
      ? Math.min(50, Math.max(1, Math.floor(rawSize)))
      : 20;
    const [rows, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.memberNotification.findMany({
        where: { userId: opts.userId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.memberNotification.count({ where: { userId: opts.userId } }),
      this.prisma.memberNotification.count({
        where: { userId: opts.userId, readAt: null },
      }),
    ]);
    const items: MemberNotificationDTO[] = rows.map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      body: r.body,
      href: r.href,
      read: r.readAt != null,
      createdAt: r.createdAt.toISOString(),
    }));
    return { items, total, page, pageSize, unreadCount };
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.memberNotification.count({
      where: { userId, readAt: null },
    });
    return { count };
  }

  // Mark one of THIS member's notifications read. Scoped by userId so a member
  // can only touch their own rows; idempotent (updateMany, no-op if already read
  // or not theirs).
  async markRead(userId: string, id: string): Promise<{ ok: true }> {
    const res = await this.prisma.memberNotification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (res.count === 0) {
      // Distinguish "not mine / missing" from "already read": a matching row that
      // was already read is fine (idempotent); a truly absent row is a 404.
      const exists = await this.prisma.memberNotification.findFirst({
        where: { id, userId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException("Notification not found");
    }
    return { ok: true };
  }

  async markAllRead(userId: string): Promise<{ ok: true }> {
    await this.prisma.memberNotification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  // Age-based prune so a high-fan-out event (one row per entitled member) can't
  // grow the table without bound. Mirrors helpdesk-retention.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune(): Promise<void> {
    try {
      const cutoff = new Date(
        Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      const { count } = await this.prisma.memberNotification.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (count > 0) {
        this.logger.log(
          `[member-notif] pruned ${count} rows older than ${RETENTION_DAYS}d`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[member-notif] prune failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
