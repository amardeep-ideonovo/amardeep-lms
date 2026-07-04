import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  AdminNotificationDTO,
  AdminNotificationListDTO,
  AdminNotificationSeverity,
  AdminNotificationType,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';

// Input for emitting one notification. `dedupeKey` MUST be stable for a given
// logical event so Stripe webhook replays / inline double-fires collapse to a
// single row (see BillingService for the per-event key formulas).
export interface RecordNotificationInput {
  type: AdminNotificationType;
  severity?: AdminNotificationSeverity;
  title: string;
  body: string;
  userId?: string | null;
  dedupeKey: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Idempotent emit. The unique dedupeKey makes a replay a no-op update. Callers
  // in the Stripe webhook path wrap this in try/catch so a notification failure
  // can never 500 the webhook or break reconciliation.
  async record(input: RecordNotificationInput): Promise<void> {
    await this.prisma.adminNotification.upsert({
      where: { dedupeKey: input.dedupeKey },
      update: {},
      create: {
        type: input.type,
        severity: input.severity ?? 'INFO',
        title: input.title,
        body: input.body,
        userId: input.userId ?? null,
        dedupeKey: input.dedupeKey,
      },
    });
  }

  // Paginated feed for one admin: each item carries that admin's `read` flag,
  // plus the admin's global unread total (across the whole feed, not the page).
  async list(opts: {
    adminId: string;
    page?: number;
    pageSize?: number;
  }): Promise<AdminNotificationListDTO> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 20));
    const [rows, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.adminNotification.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          reads: { where: { adminId: opts.adminId }, select: { id: true } },
        },
      }),
      this.prisma.adminNotification.count(),
      this.prisma.adminNotification.count({
        where: { reads: { none: { adminId: opts.adminId } } },
      }),
    ]);
    const items: AdminNotificationDTO[] = rows.map((r) => ({
      id: r.id,
      type: r.type,
      severity: r.severity,
      title: r.title,
      body: r.body,
      userId: r.userId,
      createdAt: r.createdAt.toISOString(),
      read: r.reads.length > 0,
    }));
    return { items, total, page, pageSize, unreadCount };
  }

  // This admin's unread total — an indexed anti-join (no read row => unread).
  async unreadCount(adminId: string): Promise<{ count: number }> {
    const count = await this.prisma.adminNotification.count({
      where: { reads: { none: { adminId } } },
    });
    return { count };
  }

  // Mark one notification read for this admin. Idempotent via the (notification,
  // admin) unique — re-marking is a no-op.
  async markRead(adminId: string, id: string): Promise<{ ok: true }> {
    const exists = await this.prisma.adminNotification.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Notification not found');
    await this.prisma.adminNotificationRead.upsert({
      where: { notificationId_adminId: { notificationId: id, adminId } },
      update: {},
      create: { notificationId: id, adminId },
    });
    return { ok: true };
  }

  // Mark every currently-unread notification read for this admin in one shot.
  async markAllRead(adminId: string): Promise<{ ok: true }> {
    const unread = await this.prisma.adminNotification.findMany({
      where: { reads: { none: { adminId } } },
      select: { id: true },
    });
    if (unread.length) {
      await this.prisma.adminNotificationRead.createMany({
        data: unread.map((n) => ({ notificationId: n.id, adminId })),
        skipDuplicates: true, // race-safe
      });
    }
    return { ok: true };
  }
}
