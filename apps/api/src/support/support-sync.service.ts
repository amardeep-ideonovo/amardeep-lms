import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { SupportMessage, SupportStatus, SupportTicket } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';

// Wire shapes returned by the control plane's /api/instance/support/sync. Only
// the admin-visible slice ever reaches here — the control plane filters INTERNAL
// notes and non-invited OPS messages server-side.
interface SyncMessage {
  id: string; // canonical control-plane message id (our reconcile/tombstone key)
  lane: 'MAIN' | 'OPS';
  authorKind: 'ADMIN' | 'CLIENT' | 'OPERATOR' | 'SYSTEM';
  authorEmail: string;
  authorName: string | null;
  originMessageId: string | null; // set for OUR ADMIN messages (the local id we pushed)
  body: string;
  createdAt: string;
}
interface SyncTicket {
  remoteId: string;
  originTicketId: string; // our local SupportTicket.id
  status: string;
  category: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  ownerTier: string | null;
  adminInOpsLane: boolean;
  csatPromptedAt: string | null;
  csatRating: number | null;
  csatSubmittedAt: string | null;
  lastPublicMessageAt: string | null;
  messages: SyncMessage[];
}

@Injectable()
export class SupportSyncService {
  private readonly logger = new Logger(SupportSyncService.name);
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly enabled: boolean;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {
    this.baseUrl = (process.env.CONTROL_PLANE_URL ?? '').replace(/\/+$/, '');
    this.token = process.env.INSTANCE_SERVICE_TOKEN ?? '';
    this.enabled = !!(this.baseUrl && this.token);
    if (this.token && !this.baseUrl) {
      // A token but no reachable control-plane URL = misconfiguration. Fail LOUD
      // (per the review) rather than silently never delivering tickets.
      this.logger.error(
        'support: INSTANCE_SERVICE_TOKEN is set but CONTROL_PLANE_URL is missing — ' +
          'tickets will be raised locally and NEVER delivered. Set CONTROL_PLANE_PUBLIC_URL ' +
          'in the control-plane deploy env.',
      );
    } else if (!this.enabled) {
      this.logger.log('support sync disabled (no service token) — module is inert');
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  // ---- the recurring tick ----
  // Every 30s: the instance only learns of client/operator replies by pulling,
  // so this bounds inbound latency. Paired with the admin thread's 6s UI poll,
  // a reply surfaces within ~30s even on a ticket no one has open. (A future
  // on-demand pull on thread-open would make an actively-viewed ticket instant.)
  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick(): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      await this.reconcileOutbound(); // retry unacked pushes FIRST
      await this.pullReplies(); //         then pull the admin-visible slice
    } catch (e) {
      this.logger.error(`support sync tick failed: ${this.msg(e)}`);
    } finally {
      this.running = false;
    }
  }

  // ---- outbound ----
  async pushCreate(ticket: SupportTicket, firstMsg: SupportMessage): Promise<void> {
    if (!this.enabled) return;
    try {
      const res = await this.post('/api/instance/support/ingest', {
        kind: 'ticket.create',
        originTicketId: ticket.id,
        firstMessageOriginId: firstMsg.id,
        subject: ticket.subject,
        body: firstMsg.body,
        priority: ticket.priority,
        category: ticket.category,
        raiserAdminId: ticket.raiserAdminId,
        adminEmail: ticket.raiserAdminEmail,
        adminName: firstMsg.authorName,
      });
      const j = (await res.json().catch(() => null)) as
        | { ticketId?: string; messageId?: string }
        | null;
      if (res.ok && j?.ticketId) {
        await this.prisma.supportTicket.update({
          where: { id: ticket.id },
          data: { remoteId: j.ticketId, syncedAt: new Date(), lastError: null },
        });
        if (j.messageId) {
          await this.prisma.supportMessage.update({
            where: { id: firstMsg.id },
            data: { remoteId: j.messageId, syncedAt: new Date() },
          });
        }
      } else {
        await this.markTicketError(ticket.id, `ingest ${res.status}`);
      }
    } catch (e) {
      await this.markTicketError(ticket.id, this.msg(e));
    }
  }

  async pushMessage(msg: SupportMessage, ticket: SupportTicket): Promise<void> {
    if (!this.enabled) return;
    try {
      const res = await this.post('/api/instance/support/ingest', {
        kind: 'message.create',
        remoteTicketId: ticket.remoteId ?? undefined,
        originTicketId: ticket.id,
        originMessageId: msg.id,
        body: msg.body,
        authorEmail: msg.authorEmail,
        authorName: msg.authorName,
      });
      const j = (await res.json().catch(() => null)) as { messageId?: string } | null;
      if (res.ok && j?.messageId) {
        await this.prisma.supportMessage.update({
          where: { id: msg.id },
          data: { remoteId: j.messageId, syncedAt: new Date(), lastError: null },
        });
      } else {
        await this.markMsgError(msg.id, `ingest ${res.status}`);
      }
    } catch (e) {
      await this.markMsgError(msg.id, this.msg(e));
    }
  }

  async pushCsat(ticket: SupportTicket, rating: number, comment?: string): Promise<void> {
    if (!this.enabled || !ticket.remoteId) return;
    try {
      await this.post('/api/instance/support/ingest', {
        kind: 'csat.submit',
        ticketId: ticket.remoteId,
        rating,
        comment,
      });
    } catch (e) {
      this.logger.warn(`csat push failed: ${this.msg(e)}`);
    }
  }

  private async reconcileOutbound(): Promise<void> {
    // Unacked ticket creates first (so replies can reference the CP ticket).
    const pendingTickets = await this.prisma.supportTicket.findMany({
      where: { syncedAt: null },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 1 } },
      take: 100,
    });
    for (const t of pendingTickets) {
      if (t.messages[0]) await this.pushCreate(t, t.messages[0]);
    }
    // Unacked ADMIN replies whose ticket is already synced.
    const pendingMsgs = await this.prisma.supportMessage.findMany({
      where: { remoteId: null, authorKind: 'ADMIN', syncedAt: null },
      include: { ticket: true },
      take: 200,
    });
    for (const m of pendingMsgs) {
      if (!m.ticket.syncedAt) continue; // pushCreate will carry the first message
      await this.pushMessage(m, m.ticket);
    }
  }

  // ---- inbound (per-ticket reconcile) ----
  private async pullReplies(): Promise<void> {
    const state = await this.prisma.supportSyncState.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
    // 2-minute overlap; the reconcile is idempotent so an overlapping window is
    // harmless. It bounds the query, not correctness.
    const since = new Date(state.lastPulledAt.getTime() - 2 * 60_000);
    const res = await this.get(
      `/api/instance/support/sync?since=${encodeURIComponent(since.toISOString())}`,
    );
    if (!res.ok) {
      this.logger.warn(`support sync pull failed: ${res.status}`);
      return;
    }
    const payload = (await res.json().catch(() => null)) as
      | { tickets?: SyncTicket[] }
      | null;
    for (const t of payload?.tickets ?? []) {
      await this.reconcileTicket(t).catch((e) =>
        this.logger.error(`reconcile ${t.remoteId} failed: ${this.msg(e)}`),
      );
    }
    await this.prisma.supportSyncState.update({
      where: { id: 1 },
      data: { lastPulledAt: new Date() },
    });
  }

  private async reconcileTicket(t: SyncTicket): Promise<void> {
    const local = await this.prisma.supportTicket.findFirst({
      where: { OR: [{ id: t.originTicketId }, { remoteId: t.remoteId }] },
    });
    if (!local) return; // the instance always authors its own tickets

    const wasResolved = local.status === 'RESOLVED';
    const wasInvited = local.adminInOpsLane;

    await this.prisma.supportTicket.update({
      where: { id: local.id },
      data: {
        remoteId: t.remoteId,
        status: t.status as SupportStatus,
        category: t.category,
        priority: t.priority,
        ownerTier: t.ownerTier ?? null,
        adminInOpsLane: t.adminInOpsLane,
        csatPromptedAt: t.csatPromptedAt ? new Date(t.csatPromptedAt) : null,
        csatRating: t.csatRating ?? null,
        csatSubmittedAt: t.csatSubmittedAt ? new Date(t.csatSubmittedAt) : null,
        lastMessageAt: t.lastPublicMessageAt
          ? new Date(t.lastPublicMessageAt)
          : local.lastMessageAt,
      },
    });

    // ---- reconcile the message set to EXACTLY the returned admin-visible slice ----
    const existing = await this.prisma.supportMessage.findMany({
      where: { ticketId: local.id },
    });
    const byRemote = new Map(
      existing.filter((m) => m.remoteId).map((m) => [m.remoteId as string, m]),
    );
    const byId = new Map(existing.map((m) => [m.id, m]));
    const returnedRemoteIds = new Set(t.messages.map((m) => m.id));
    const newInbound: SyncMessage[] = [];

    for (const m of t.messages) {
      if (m.authorKind === 'ADMIN' && m.originMessageId) {
        // Our own pushed message — back-fill its remoteId; never duplicate it.
        const localMsg = byId.get(m.originMessageId);
        if (localMsg && !localMsg.remoteId) {
          await this.prisma.supportMessage.update({
            where: { id: localMsg.id },
            data: { remoteId: m.id, syncedAt: new Date() },
          });
        } else if (!localMsg && !byRemote.has(m.id)) {
          await this.createMirrorMessage(local.id, m);
        }
        continue;
      }
      if (!byRemote.has(m.id)) {
        await this.createMirrorMessage(local.id, m);
        if (m.authorKind === 'OPERATOR' || m.authorKind === 'CLIENT') {
          newInbound.push(m);
        }
      }
    }

    // Tombstone: previously-synced messages no longer in the visible slice — the
    // OPS-revoke case. Never touches an unacked ADMIN message (remoteId null).
    const toDelete = existing.filter(
      (m) => m.remoteId && !returnedRemoteIds.has(m.remoteId),
    );
    if (toDelete.length) {
      await this.prisma.supportMessage.deleteMany({
        where: { id: { in: toDelete.map((m) => m.id) } },
      });
    }

    // ---- notify the instance admins (org-level bell + best-effort email) ----
    const nowResolved = t.status === 'RESOLVED' && !wasResolved;
    const nowInvited = t.adminInOpsLane && !wasInvited;
    if (newInbound.length || nowResolved || nowInvited) {
      await this.prisma.supportTicket.update({
        where: { id: local.id },
        data: { unreadForAdmins: true },
      });
    }
    if (newInbound.length) {
      const latest = newInbound[newInbound.length - 1];
      await this.notifyAdmins(
        local,
        'SUPPORT_REPLY',
        `New reply on "${local.subject}"`,
        latest.body.slice(0, 140),
        `support:reply:${latest.id}`,
      );
    }
    if (nowInvited) {
      await this.notifyAdmins(
        local,
        'SUPPORT_INVITED_OPS',
        `You were added to the support conversation: "${local.subject}"`,
        'Your client invited you into the conversation with our support team.',
        `support:invite:${t.remoteId}`,
      );
    }
    if (nowResolved) {
      await this.notifyAdmins(
        local,
        'SUPPORT_STATUS',
        `Support ticket resolved: "${local.subject}"`,
        'Your ticket was marked resolved. Reply to reopen it, or rate the support you received.',
        `support:status:${t.remoteId}:RESOLVED`,
      );
    }
  }

  private async createMirrorMessage(ticketId: string, m: SyncMessage): Promise<void> {
    await this.prisma.supportMessage.create({
      data: {
        ticketId,
        remoteId: m.id,
        lane: m.lane,
        authorKind: m.authorKind,
        authorEmail: m.authorEmail,
        authorName: m.authorName ?? null,
        body: m.body,
        createdAt: new Date(m.createdAt),
        syncedAt: new Date(),
      },
    });
  }

  private async notifyAdmins(
    ticket: SupportTicket,
    type: 'SUPPORT_REPLY' | 'SUPPORT_STATUS' | 'SUPPORT_INVITED_OPS',
    title: string,
    body: string,
    dedupeKey: string,
  ): Promise<void> {
    // In-app bell is the GUARANTEED channel (org-level: every admin sees it,
    // deep-linked to the ticket). Email is best-effort to the raiser.
    await this.notifications.record({
      type,
      title,
      body,
      entityType: 'support',
      entityId: ticket.id,
      dedupeKey,
    });
    if (ticket.raiserAdminEmail) {
      await this.email.send({
        to: ticket.raiserAdminEmail,
        subject: title,
        html: `<p>${escapeHtml(body)}</p><p>Open it in the admin dashboard under <strong>Support</strong>.</p>`,
        text: body,
        transactional: true,
        dedupeKey,
      });
    }
  }

  // ---- http + error helpers ----
  private post(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });
  }
  private get(path: string): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      headers: { authorization: `Bearer ${this.token}` },
      cache: 'no-store',
    });
  }
  private async markTicketError(id: string, err: string): Promise<void> {
    await this.prisma.supportTicket
      .update({ where: { id }, data: { lastError: err.slice(0, 300) } })
      .catch(() => undefined);
  }
  private async markMsgError(id: string, err: string): Promise<void> {
    await this.prisma.supportMessage
      .update({ where: { id }, data: { lastError: err.slice(0, 300) } })
      .catch(() => undefined);
  }
  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
