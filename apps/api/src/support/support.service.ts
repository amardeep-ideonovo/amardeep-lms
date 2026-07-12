import { Injectable, NotFoundException } from '@nestjs/common';
import type { SupportMessage, SupportTicket } from '@prisma/client';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { SupportSyncService } from './support-sync.service';
import { CsatDto, RaiseTicketDto, ReplyDto } from './dto/support.dto';

// The instance-side mirror. Tickets are ORG-LEVEL: every admin sees every ticket
// (raiserAdminId is a label only). Writes are pushed to the control plane
// best-effort inline; the sync cron retries anything that didn't ack and pulls
// the admin-visible slice back.
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SupportSyncService,
  ) {}

  async raise(p: AuthenticatedPrincipal, dto: RaiseTicketDto) {
    const ticket = await this.prisma.supportTicket.create({
      data: {
        raiserAdminId: p.sub,
        raiserAdminEmail: p.email,
        subject: dto.subject,
        category: dto.category ?? 'OTHER',
        priority: dto.priority ?? 'NORMAL',
        status: 'OPEN',
        lastMessageAt: new Date(),
        messages: {
          create: {
            lane: 'MAIN',
            authorKind: 'ADMIN',
            authorEmail: p.email,
            authorName: p.username ?? null,
            body: dto.body,
          },
        },
      },
      include: { messages: true },
    });
    await this.sync.pushCreate(ticket, ticket.messages[0]).catch(() => undefined);
    return this.thread(ticket.id);
  }

  async list() {
    const tickets = await this.prisma.supportTicket.findMany({
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    });
    return { items: tickets.map(toListItem) };
  }

  async unreadCount() {
    const count = await this.prisma.supportTicket.count({
      where: { unreadForAdmins: true },
    });
    return { count };
  }

  async thread(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) throw new NotFoundException('ticket not found');
    if (ticket.unreadForAdmins) {
      await this.prisma.supportTicket.update({
        where: { id },
        data: { unreadForAdmins: false },
      });
    }
    return toThread(ticket);
  }

  async reply(p: AuthenticatedPrincipal, id: string, dto: ReplyDto) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('ticket not found');
    const msg = await this.prisma.supportMessage.create({
      data: {
        ticketId: id,
        lane: 'MAIN',
        authorKind: 'ADMIN',
        authorEmail: p.email,
        authorName: p.username ?? null,
        body: dto.body,
      },
    });
    await this.prisma.supportTicket.update({
      where: { id },
      data: {
        lastMessageAt: new Date(),
        ...(ticket.status === 'RESOLVED' || ticket.status === 'CLOSED'
          ? { status: 'OPEN' }
          : {}),
      },
    });
    await this.sync.pushMessage(msg, ticket).catch(() => undefined);
    return this.thread(id);
  }

  async csat(p: AuthenticatedPrincipal, id: string, dto: CsatDto) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('ticket not found');
    // Optimistic local set; the control plane is authoritative (validates
    // resolved + set-once) and the next pull reconciles the true value.
    await this.prisma.supportTicket.update({
      where: { id },
      data: { csatRating: dto.rating, csatSubmittedAt: new Date() },
    });
    await this.sync.pushCsat(ticket, dto.rating, dto.comment).catch(() => undefined);
    return this.thread(id);
  }
}

function toListItem(t: SupportTicket) {
  return {
    id: t.id,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    category: t.category,
    ownerTier: t.ownerTier,
    adminInOpsLane: t.adminInOpsLane,
    unread: t.unreadForAdmins,
    raiserAdminEmail: t.raiserAdminEmail,
    lastMessageAt: t.lastMessageAt.toISOString(),
    createdAt: t.createdAt.toISOString(),
  };
}

function toThread(t: SupportTicket & { messages: SupportMessage[] }) {
  return {
    ...toListItem(t),
    csatPromptedAt: t.csatPromptedAt?.toISOString() ?? null,
    csatRating: t.csatRating ?? null,
    csatSubmittedAt: t.csatSubmittedAt?.toISOString() ?? null,
    messages: t.messages.map((m) => ({
      id: m.id,
      lane: m.lane,
      authorKind: m.authorKind,
      authorEmail: m.authorEmail,
      authorName: m.authorName,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}
