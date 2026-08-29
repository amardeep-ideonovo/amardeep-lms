import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import type {
  HelpdeskAdminListDTO,
  HelpdeskAdminArticleDTO,
  HelpdeskAdminMessageDTO,
  HelpdeskAdminThreadDTO,
  HelpdeskArticleDTO,
  HelpdeskConfigDTO,
  HelpdeskConversationSummaryDTO,
  HelpdeskMessageDTO,
  HelpdeskStatsDTO,
  HelpdeskThreadDTO,
} from "@lms/types";
import type { AuthenticatedPrincipal } from "../auth/jwt-payload.interface";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { EmailService } from "../email/email.service";
import { AppConfigService } from "../site/app-config.service";
import { ConfigService } from "@nestjs/config";
import {
  AdminListQueryDto,
  AdminReplyDto,
  ArticleCreateDto,
  ArticleUpdateDto,
  RateConversationDto,
  ReplyDto,
  StartConversationDto,
  StatEventDto,
  UpdateTicketDto,
} from "./dto/helpdesk.dto";
import { slugify } from "../common/slugify";
import { redactSensitive } from "./redact";
import { isOptimizableImage, optimizeImage } from "../media/image-transform";
import { saveHelpdeskFile } from "./helpdesk-files.util";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
} from "./helpdesk.config";

const DEFAULT_GREETING =
  "Hi {firstName} 👋 — I can help with your classes, courses, lessons and payments. Pick a topic, or tell me what's going on.";

// A conversation is "open" (counts toward the per-member cap) while a human
// still owes a reply. RESOLVED is reopenable but not counted; CLOSED is
// terminal.
const OPEN_STATUSES = ["ESCALATED", "WAITING_ON_MEMBER"] as const;

interface ResolvedSettings {
  enabled: boolean;
  greeting: string;
  replyTimeNote: string | null;
  maxOpenPerMember: number;
  retentionDays: number;
}

type ConvWithMessages = Prisma.HelpdeskConversationGetPayload<{
  include: { messages: { include: { attachments: true } } };
}>;
type MsgWithAttachments = Prisma.HelpdeskMessageGetPayload<{
  include: { attachments: true };
}>;
type AdminListRow = Prisma.HelpdeskConversationGetPayload<{
  include: {
    user: { select: { email: true; firstName: true; lastName: true } };
    ticket: true;
  };
}>;
type AdminThreadRow = Prisma.HelpdeskConversationGetPayload<{
  include: {
    user: {
      select: { id: true; email: true; firstName: true; lastName: true };
    };
    ticket: true;
    messages: { include: { attachments: true } };
  };
}>;

@Injectable()
export class HelpdeskService {
  private readonly logger = new Logger(HelpdeskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly appConfig: AppConfigService,
    private readonly env: ConfigService,
  ) {}

  private async resolveSettings(): Promise<ResolvedSettings> {
    const row = await this.prisma.helpdeskSettings.findUnique({
      where: { id: "singleton" },
    });
    return {
      enabled: row?.enabled ?? true,
      greeting: row?.greeting ?? DEFAULT_GREETING,
      replyTimeNote: row?.replyTimeNote ?? null,
      maxOpenPerMember: row?.maxOpenPerMember ?? 3,
      retentionDays: row?.retentionDays ?? 365,
    };
  }

  // ---------------------------------------------------------------- member

  async config(p?: AuthenticatedPrincipal): Promise<HelpdeskConfigDTO> {
    const s = await this.resolveSettings();
    const base = {
      enabled: s.enabled,
      greeting: s.greeting,
      replyTimeNote: s.replyTimeNote,
      maxOpenPerMember: s.maxOpenPerMember,
    };
    const eligible = !!p && !p.isAdmin && !p.isPreview;
    if (!p || !eligible || !s.enabled) {
      return {
        ...base,
        requiresSignIn: !eligible,
        openConversations: [],
        unread: 0,
      };
    }
    const [convos, unread] = await Promise.all([
      this.prisma.helpdeskConversation.findMany({
        where: { userId: p.sub, status: { not: "CLOSED" } },
        orderBy: { lastMessageAt: "desc" },
        take: 20,
      }),
      this.prisma.helpdeskConversation.count({
        where: { userId: p.sub, unreadForMember: true },
      }),
    ]);
    return {
      ...base,
      requiresSignIn: false,
      openConversations: convos.map(toSummary),
      unread,
    };
  }

  async articles(): Promise<HelpdeskArticleDTO[]> {
    const rows = await this.prisma.helpdeskArticle.findMany({
      where: { published: true },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
    });
    return rows.map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      body: a.body,
      category: a.category,
      // The composer's router matches typed questions against these
      // client-side — see packages/types/helpdesk-router.ts.
      keywords: a.keywords,
    }));
  }

  async myConversations(
    userId: string,
  ): Promise<{ items: HelpdeskConversationSummaryDTO[] }> {
    const rows = await this.prisma.helpdeskConversation.findMany({
      where: { userId },
      orderBy: { lastMessageAt: "desc" },
      take: 50,
    });
    return { items: rows.map(toSummary) };
  }

  async myUnreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.helpdeskConversation.count({
      where: { userId, unreadForMember: true },
    });
    return { count };
  }

  async start(
    p: AuthenticatedPrincipal,
    dto: StartConversationDto,
  ): Promise<HelpdeskThreadDTO> {
    if (p.isAdmin || p.isPreview) {
      throw new ForbiddenException("Members only");
    }
    const s = await this.resolveSettings();
    if (!s.enabled) {
      throw new ForbiddenException({
        code: "HELPDESK_DISABLED",
        message: "Support chat is turned off.",
      });
    }
    const openCount = await this.prisma.helpdeskConversation.count({
      where: { userId: p.sub, status: { in: [...OPEN_STATUSES] } },
    });
    if (openCount >= s.maxOpenPerMember) {
      throw new ConflictException({
        code: "HELPDESK_TOO_MANY_OPEN",
        message: `You already have ${openCount} open requests. We'll reply to those first.`,
      });
    }

    const category = dto.category ?? "OTHER";
    const priority = category === "LIVE_SESSION" ? "HIGH" : "NORMAL";
    const issue = redactSensitive(dto.issue.trim());
    const subject = issue.split("\n")[0].slice(0, 200) || "Support request";
    const breadcrumb = await this.buildBreadcrumb(p.sub, dto.breadcrumbs ?? []);
    const authorName = displayName(p);

    const conv = await this.prisma.$transaction(async (tx) => {
      const c = await tx.helpdeskConversation.create({
        data: {
          userId: p.sub,
          status: "ESCALATED",
          subject,
          category,
          messageCount: 2,
          unreadForAdmins: true,
          unreadForMember: false,
          lastMessageAt: new Date(),
        },
      });
      await tx.helpdeskMessage.create({
        data: {
          conversationId: c.id,
          seq: 0,
          authorKind: "SYSTEM",
          body: breadcrumb,
        },
      });
      await tx.helpdeskMessage.create({
        data: {
          conversationId: c.id,
          seq: 1,
          authorKind: "MEMBER",
          authorName,
          body: issue,
        },
      });
      await tx.helpdeskTicket.create({
        data: { conversationId: c.id, category, priority },
      });
      return c;
    });

    // Content-free body — the deep-link (entityType/entityId) is the only handle.
    this.notifications
      .record({
        type: "HELPDESK_ESCALATED",
        severity: "WARNING",
        title: "A member asked for a human",
        body: "A member escalated a support conversation. Open it to reply.",
        entityType: "helpdesk",
        entityId: conv.id,
        dedupeKey: `helpdesk:escalated:${conv.id}`,
      })
      .catch(() => undefined);

    return this.threadForMember(p.sub, conv.id);
  }

  async threadForMember(
    userId: string,
    id: string,
  ): Promise<HelpdeskThreadDTO> {
    const conv = await this.prisma.helpdeskConversation.findFirst({
      where: { id, userId },
      include: {
        messages: {
          where: { internal: false },
          orderBy: { seq: "asc" },
          include: { attachments: true },
        },
      },
    });
    if (!conv) throw new NotFoundException("conversation not found");
    const s = await this.resolveSettings();
    return toThread(conv, s.replyTimeNote);
  }

  async replyAsMember(
    p: AuthenticatedPrincipal,
    id: string,
    dto: ReplyDto,
  ): Promise<HelpdeskThreadDTO> {
    const conv = await this.prisma.helpdeskConversation.findFirst({
      where: { id, userId: p.sub },
    });
    if (!conv) throw new NotFoundException("conversation not found");
    if (conv.status === "CLOSED") {
      throw new ConflictException({
        code: "HELPDESK_CLOSED",
        message: "This request is closed. Please start a new one.",
      });
    }
    const body = redactSensitive(dto.body.trim());
    const reopened = conv.status === "RESOLVED";
    const data: Prisma.HelpdeskConversationUpdateInput = {
      messageCount: { increment: 1 },
      lastMessageAt: new Date(),
      unreadForAdmins: true,
      unreadForMember: false,
    };
    if (reopened) {
      data.status = "ESCALATED";
      data.reopenCount = { increment: 1 };
      data.resolution = null;
      data.resolvedAt = null;
    } else if (conv.status === "WAITING_ON_MEMBER") {
      data.status = "ESCALATED";
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.helpdeskMessage.create({
        data: {
          conversationId: id,
          seq: conv.messageCount,
          authorKind: "MEMBER",
          authorName: displayName(p),
          body,
        },
      });
      await tx.helpdeskConversation.update({ where: { id }, data });
    });
    if (reopened) {
      this.notifications
        .record({
          type: "HELPDESK_ESCALATED",
          severity: "INFO",
          title: "A member reopened a request",
          body: "A member replied to a resolved support conversation.",
          entityType: "helpdesk",
          entityId: id,
          dedupeKey: `helpdesk:reopened:${id}:${conv.reopenCount + 1}`,
        })
        .catch(() => undefined);
    }
    return this.threadForMember(p.sub, id);
  }

  async markReadMember(userId: string, id: string): Promise<{ ok: true }> {
    await this.prisma.helpdeskConversation.updateMany({
      where: { id, userId },
      data: { unreadForMember: false },
    });
    return { ok: true };
  }

  /** The member closes their own request. Reversible by design — replying to a
   *  RESOLVED conversation reopens it, so no confirmation stands in the way. */
  async resolveAsMember(
    userId: string,
    id: string,
  ): Promise<HelpdeskThreadDTO> {
    const conv = await this.prisma.helpdeskConversation.findFirst({
      where: { id, userId },
    });
    if (!conv) throw new NotFoundException("conversation not found");
    if (conv.status === "CLOSED") {
      throw new ConflictException({
        code: "HELPDESK_CLOSED",
        message: "This request is closed. Please start a new one.",
      });
    }
    if (conv.status !== "RESOLVED") {
      await this.prisma.helpdeskConversation.update({
        where: { id },
        data: {
          status: "RESOLVED",
          resolution: "MEMBER_RESOLVED",
          resolvedAt: new Date(),
        },
      });
      // Good news for the queue, not an action item — so a notification, not
      // an unread flag.
      this.notifications
        .record({
          type: "HELPDESK_ESCALATED",
          severity: "INFO",
          title: "A member resolved their own request",
          body: "A member marked their support request as resolved.",
          entityType: "helpdesk",
          entityId: id,
          dedupeKey: `helpdesk:member-resolved:${id}:${conv.reopenCount}`,
        })
        .catch(() => undefined);
    }
    return this.threadForMember(userId, id);
  }

  /** Once-per-resolution CSAT. The first rating writes the day-stat counters;
   *  a flip moves the tally on the ORIGINAL rating day; a repeat with the same
   *  value may only add/refresh the note. Only ratable once resolved. */
  async rateAsMember(
    userId: string,
    id: string,
    dto: RateConversationDto,
  ): Promise<HelpdeskThreadDTO> {
    const conv = await this.prisma.helpdeskConversation.findFirst({
      where: { id, userId },
    });
    if (!conv) throw new NotFoundException("conversation not found");
    if (conv.status !== "RESOLVED" && conv.status !== "CLOSED") {
      throw new ConflictException({
        code: "HELPDESK_NOT_RESOLVED",
        message: "You can rate a request once it is resolved.",
      });
    }
    const note =
      dto.note !== undefined
        ? dto.note.trim().slice(0, 500) || null
        : undefined;
    if (conv.satisfactionUp === null) {
      const day = startOfUtcDay(new Date());
      await this.prisma.$transaction(async (tx) => {
        await tx.helpdeskConversation.update({
          where: { id },
          data: {
            satisfactionUp: dto.up,
            satisfactionAt: new Date(),
            ...(note !== undefined ? { satisfactionNote: note } : {}),
          },
        });
        await tx.helpdeskDayStat.upsert({
          where: { day_category: { day, category: conv.category } },
          create: {
            day,
            category: conv.category,
            ratedUp: dto.up ? 1 : 0,
            ratedDown: dto.up ? 0 : 1,
          },
          update: dto.up
            ? { ratedUp: { increment: 1 } }
            : { ratedDown: { increment: 1 } },
        });
      });
    } else if (conv.satisfactionUp !== dto.up) {
      // Mis-taps happen; move the tally where the rating originally landed.
      const day = startOfUtcDay(conv.satisfactionAt ?? new Date());
      await this.prisma.$transaction(async (tx) => {
        await tx.helpdeskConversation.update({
          where: { id },
          data: {
            satisfactionUp: dto.up,
            satisfactionAt: new Date(),
            ...(note !== undefined ? { satisfactionNote: note } : {}),
          },
        });
        const row = await tx.helpdeskDayStat.findUnique({
          where: { day_category: { day, category: conv.category } },
        });
        await tx.helpdeskDayStat.upsert({
          where: { day_category: { day, category: conv.category } },
          create: {
            day,
            category: conv.category,
            ratedUp: dto.up ? 1 : 0,
            ratedDown: dto.up ? 0 : 1,
          },
          update: {
            ratedUp: dto.up
              ? { increment: 1 }
              : { set: Math.max(0, (row?.ratedUp ?? 0) - 1) },
            ratedDown: dto.up
              ? { set: Math.max(0, (row?.ratedDown ?? 0) - 1) }
              : { increment: 1 },
          },
        });
      });
    } else if (note !== undefined) {
      await this.prisma.helpdeskConversation.update({
        where: { id },
        data: { satisfactionNote: note },
      });
    }
    return this.threadForMember(userId, id);
  }

  async recordStat(dto: StatEventDto): Promise<{ ok: true }> {
    const day = startOfUtcDay(new Date());
    const update: Prisma.HelpdeskDayStatUpdateInput =
      dto.event === "cardView"
        ? { cardViews: { increment: 1 } }
        : dto.event === "resolvedYes"
          ? { resolvedYes: { increment: 1 } }
          : { escalations: { increment: 1 } };
    await this.prisma.helpdeskDayStat.upsert({
      where: { day_category: { day, category: dto.category } },
      create: {
        day,
        category: dto.category,
        cardViews: dto.event === "cardView" ? 1 : 0,
        resolvedYes: dto.event === "resolvedYes" ? 1 : 0,
        escalations: dto.event === "escalation" ? 1 : 0,
      },
      update,
    });
    return { ok: true };
  }

  // Server-derived snapshot of the member's real state at escalation. The
  // client's trail chooses WHAT to note; the values here are read fresh, never
  // trusted from the request.
  private async buildBreadcrumb(
    userId: string,
    trail: string[],
  ): Promise<string> {
    const levels = await this.prisma.userLevel.findMany({
      where: { userId },
      select: { status: true },
    });
    const active = levels.filter((l) => l.status === "ACTIVE").length;
    const pastDue = levels.filter((l) => l.status === "PAST_DUE").length;
    const parts: string[] = [
      `Member holds ${levels.length} class${levels.length === 1 ? "" : "es"} (${active} active${pastDue ? `, ${pastDue} past due` : ""}).`,
    ];
    const viewed = trail.filter((t) => typeof t === "string" && t.length > 0);
    if (viewed.length > 0) {
      parts.push(`Viewed before escalating: ${viewed.join(" → ")}.`);
    }
    return parts.join(" ");
  }

  // ---------------------------------------------------------------- admin

  async adminList(q: AdminListQueryDto): Promise<HelpdeskAdminListDTO> {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(q.pageSize) || 25));
    const where: Prisma.HelpdeskConversationWhereInput = {
      // Synthetic preview members hold every published class — never triage them.
      user: { isPreview: false },
    };
    if (q.status) where.status = q.status;
    if (q.category) where.category = q.category;
    if (q.unreadOnly === "true") where.unreadForAdmins = true;
    if (q.assignee) where.ticket = { assigneeAdminId: q.assignee };
    const [rows, total] = await Promise.all([
      this.prisma.helpdeskConversation.findMany({
        where,
        orderBy: { lastMessageAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { email: true, firstName: true, lastName: true } },
          ticket: true,
        },
      }),
      this.prisma.helpdeskConversation.count({ where }),
    ]);
    return { items: rows.map(toAdminListItem), total, page, pageSize };
  }

  async adminUnreadCount(): Promise<{ count: number }> {
    const count = await this.prisma.helpdeskConversation.count({
      where: { unreadForAdmins: true },
    });
    return { count };
  }

  async adminThread(id: string): Promise<HelpdeskAdminThreadDTO> {
    const conv = await this.prisma.helpdeskConversation.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        ticket: true,
        messages: { orderBy: { seq: "asc" }, include: { attachments: true } },
      },
    });
    if (!conv) throw new NotFoundException("conversation not found");
    return toAdminThread(conv);
  }

  async adminMarkRead(id: string): Promise<{ ok: true }> {
    await this.prisma.helpdeskConversation.update({
      where: { id },
      data: { unreadForAdmins: false },
    });
    return { ok: true };
  }

  async adminReply(
    admin: AuthenticatedPrincipal,
    id: string,
    dto: AdminReplyDto,
  ): Promise<HelpdeskAdminThreadDTO> {
    const conv = await this.prisma.helpdeskConversation.findUnique({
      where: { id },
      include: {
        ticket: true,
        user: { select: { email: true, firstName: true } },
      },
    });
    if (!conv) throw new NotFoundException("conversation not found");
    if (conv.status === "CLOSED") {
      throw new ConflictException({
        code: "HELPDESK_CLOSED",
        message: "This conversation is closed.",
      });
    }
    const internal = dto.internal === true;
    // Email the member about this reply — but only the FIRST reply they have
    // not yet seen. If unreadForMember is already true they were told about an
    // earlier reply and haven't looked yet; a burst of admin messages must
    // produce one email, not one per message.
    const notifyMember = !internal && !conv.unreadForMember;
    const body = redactSensitive(dto.body.trim());
    const data: Prisma.HelpdeskConversationUpdateInput = {
      messageCount: { increment: 1 },
      lastMessageAt: new Date(),
      firstRespondedAt: conv.firstRespondedAt ?? new Date(),
    };
    if (!internal) {
      data.unreadForMember = true;
      data.unreadForAdmins = false;
      if (dto.resolve) {
        data.status = "RESOLVED";
        data.resolution = "ANSWERED_BY_ADMIN";
        data.resolvedAt = new Date();
      } else if (dto.waitingOnMember) {
        data.status = "WAITING_ON_MEMBER";
      } else if (
        conv.status === "WAITING_ON_MEMBER" ||
        conv.status === "RESOLVED"
      ) {
        data.status = "ESCALATED";
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.helpdeskMessage.create({
        data: {
          conversationId: id,
          seq: conv.messageCount,
          authorKind: "ADMIN",
          authorAdminId: admin.sub,
          authorName: admin.email,
          internal,
          body,
        },
      });
      await tx.helpdeskConversation.update({ where: { id }, data });
      // Self-assign on first touch so the queue shows who owns it.
      if (conv.ticket && !conv.ticket.assigneeAdminId) {
        await tx.helpdeskTicket.update({
          where: { conversationId: id },
          data: { assigneeAdminId: admin.sub, assignedAt: new Date() },
        });
      }
    });
    if (notifyMember) {
      // Fire-and-forget: the admin's queue UI must not wait on SMTP, and
      // sendTemplate never throws — the catch is for the config reads.
      void this.emailMemberAboutReply(
        conv.user,
        conv.subject,
        id,
        conv.messageCount + 1,
        body,
      );
    }
    return this.adminThread(id);
  }

  /** Tell the member a human replied. Fails soft in every direction: an
   *  academy with no member email configured just logs a FAILED EmailLog row
   *  (the admin dashboard already surfaces that state), and nothing here can
   *  reach the admin's request. */
  private async emailMemberAboutReply(
    user: { email: string; firstName: string | null },
    subject: string,
    conversationId: string,
    seq: number,
    replyBody: string,
  ): Promise<void> {
    try {
      const cfg = await this.appConfig.read();
      const url =
        this.env.get<string>("WEB_APP_URL") || "http://localhost:3002";
      const preview =
        replyBody.length > 240
          ? `${replyBody.slice(0, 240).trimEnd()}\u2026`
          : replyBody;
      await this.email.sendTemplate({
        to: user.email,
        templateKey: "helpdesk-reply",
        vars: {
          firstName: user.firstName?.trim() || "there",
          brand: cfg.title,
          requestSubject: subject,
          replyPreview: preview,
          url,
        },
        // A support reply must reach even an unsubscribed member — it is a
        // direct response to something they asked us, not marketing.
        transactional: true,
        // Idempotent per message, so a retried admin request can't double-send.
        dedupeKey: `helpdesk-reply:${conversationId}:${seq}`,
      });
    } catch (err) {
      this.logger.warn(
        `[helpdesk] reply email failed for conversation ${conversationId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  async adminAssign(
    id: string,
    assigneeAdminId: string | null,
  ): Promise<HelpdeskAdminThreadDTO> {
    await this.requireTicket(id);
    await this.prisma.helpdeskTicket.update({
      where: { conversationId: id },
      data: {
        assigneeAdminId: assigneeAdminId || null,
        assignedAt: assigneeAdminId ? new Date() : null,
      },
    });
    return this.adminThread(id);
  }

  async adminUpdateTicket(
    id: string,
    dto: UpdateTicketDto,
  ): Promise<HelpdeskAdminThreadDTO> {
    await this.requireTicket(id);
    await this.prisma.helpdeskTicket.update({
      where: { conversationId: id },
      data: {
        ...(dto.priority ? { priority: dto.priority } : {}),
        ...(dto.category ? { category: dto.category } : {}),
      },
    });
    if (dto.category) {
      await this.prisma.helpdeskConversation.update({
        where: { id },
        data: { category: dto.category },
      });
    }
    return this.adminThread(id);
  }

  async adminResolve(id: string): Promise<HelpdeskAdminThreadDTO> {
    const conv = await this.requireConversation(id);
    if (conv.status !== "CLOSED") {
      await this.prisma.helpdeskConversation.update({
        where: { id },
        data: {
          status: "RESOLVED",
          resolution: "ANSWERED_BY_ADMIN",
          resolvedAt: new Date(),
          unreadForAdmins: false,
        },
      });
    }
    return this.adminThread(id);
  }

  async adminClose(id: string): Promise<HelpdeskAdminThreadDTO> {
    await this.requireConversation(id);
    await this.prisma.helpdeskConversation.update({
      where: { id },
      data: {
        status: "CLOSED",
        resolution: "ADMIN_CLOSED",
        closedAt: new Date(),
        unreadForAdmins: false,
      },
    });
    return this.adminThread(id);
  }

  async adminStats(days: number): Promise<HelpdeskStatsDTO> {
    const d = Math.min(365, Math.max(1, Math.floor(days) || 30));
    const since = startOfUtcDay(new Date());
    since.setUTCDate(since.getUTCDate() - (d - 1));
    const rows = await this.prisma.helpdeskDayStat.findMany({
      where: { day: { gte: since } },
    });
    const byCategory = new Map<
      string,
      { cardViews: number; resolvedYes: number; escalations: number }
    >();
    let cardViews = 0;
    let resolvedYes = 0;
    let escalations = 0;
    let ratedUp = 0;
    let ratedDown = 0;
    for (const r of rows) {
      cardViews += r.cardViews;
      resolvedYes += r.resolvedYes;
      escalations += r.escalations;
      ratedUp += r.ratedUp;
      ratedDown += r.ratedDown;
      const agg = byCategory.get(r.category) ?? {
        cardViews: 0,
        resolvedYes: 0,
        escalations: 0,
      };
      agg.cardViews += r.cardViews;
      agg.resolvedYes += r.resolvedYes;
      agg.escalations += r.escalations;
      byCategory.set(r.category, agg);
    }
    return {
      days: d,
      cardViews,
      resolvedYes,
      escalations,
      ratedUp,
      ratedDown,
      byCategory: [...byCategory.entries()].map(([category, v]) => ({
        category:
          category as HelpdeskStatsDTO["byCategory"][number]["category"],
        ...v,
      })),
    };
  }

  private async requireConversation(id: string) {
    const conv = await this.prisma.helpdeskConversation.findUnique({
      where: { id },
    });
    if (!conv) throw new NotFoundException("conversation not found");
    return conv;
  }

  private async requireTicket(id: string) {
    const ticket = await this.prisma.helpdeskTicket.findUnique({
      where: { conversationId: id },
    });
    if (!ticket) throw new NotFoundException("ticket not found");
    return ticket;
  }

  // ---------------------------------------------------------------- articles (admin)

  async listArticlesAdmin(): Promise<HelpdeskAdminArticleDTO[]> {
    const rows = await this.prisma.helpdeskArticle.findMany({
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
    });
    return rows.map(toAdminArticle);
  }

  async createArticle(dto: ArticleCreateDto): Promise<HelpdeskAdminArticleDTO> {
    const slug = await this.uniqueSlug(dto.title);
    const row = await this.prisma.helpdeskArticle.create({
      data: {
        slug,
        title: dto.title,
        body: dto.body,
        category: dto.category ?? "OTHER",
        keywords: dto.keywords ?? [],
        published: dto.published ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    return toAdminArticle(row);
  }

  async updateArticle(
    id: string,
    dto: ArticleUpdateDto,
  ): Promise<HelpdeskAdminArticleDTO> {
    await this.requireArticle(id);
    const row = await this.prisma.helpdeskArticle.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.category ? { category: dto.category } : {}),
        ...(dto.keywords !== undefined ? { keywords: dto.keywords } : {}),
        ...(dto.published !== undefined ? { published: dto.published } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
    return toAdminArticle(row);
  }

  async deleteArticle(id: string): Promise<{ ok: true }> {
    await this.requireArticle(id);
    await this.prisma.helpdeskArticle.delete({ where: { id } });
    return { ok: true };
  }

  private async requireArticle(id: string) {
    const a = await this.prisma.helpdeskArticle.findUnique({ where: { id } });
    if (!a) throw new NotFoundException("article not found");
    return a;
  }

  private async uniqueSlug(title: string): Promise<string> {
    const base = slugify(title) || "article";
    let slug = base;
    let n = 2;
    while (await this.prisma.helpdeskArticle.findUnique({ where: { slug } })) {
      slug = `${base}-${n++}`;
    }
    return slug;
  }

  // ---------------------------------------------------------------- attachments

  async addMemberAttachments(
    userId: string,
    conversationId: string,
    messageId: string,
    files: Express.Multer.File[],
  ): Promise<HelpdeskThreadDTO> {
    const msg = await this.prisma.helpdeskMessage.findFirst({
      where: {
        id: messageId,
        conversationId,
        authorKind: "MEMBER",
        conversation: { userId },
      },
      select: { id: true },
    });
    if (!msg) throw new NotFoundException("message not found");
    await this.persistAttachments(messageId, files);
    return this.threadForMember(userId, conversationId);
  }

  async addAdminAttachments(
    conversationId: string,
    messageId: string,
    files: Express.Multer.File[],
  ): Promise<HelpdeskAdminThreadDTO> {
    const msg = await this.prisma.helpdeskMessage.findFirst({
      where: { id: messageId, conversationId, authorKind: "ADMIN" },
      select: { id: true },
    });
    if (!msg) throw new NotFoundException("message not found");
    await this.persistAttachments(messageId, files);
    return this.adminThread(conversationId);
  }

  // Look up an attachment for the token-mint / download path. `allowAdmin`
  // false scopes to the owning member (the 404-not-403 existence guard);
  // true (from the permission-gated admin routes) allows any.
  async attachmentForDownload(
    attachmentId: string,
    opts: { userId: string; allowAdmin: boolean },
  ): Promise<{ fileKey: string; originalName: string }> {
    const att = await this.prisma.helpdeskAttachment.findFirst({
      where: {
        id: attachmentId,
        ...(opts.allowAdmin
          ? {}
          : { message: { conversation: { userId: opts.userId } } }),
      },
      select: { fileKey: true, originalName: true },
    });
    if (!att) throw new NotFoundException("attachment not found");
    return att;
  }

  private async persistAttachments(
    messageId: string,
    files: Express.Multer.File[],
  ): Promise<void> {
    if (!files || files.length === 0) return;
    if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new BadRequestException(
        `At most ${MAX_ATTACHMENTS_PER_MESSAGE} images per message.`,
      );
    }
    for (const file of files) {
      if (!isOptimizableImage(file.mimetype)) {
        throw new BadRequestException(
          "Please attach a JPG, PNG or WebP image.",
        );
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        throw new BadRequestException("Image too large (max 8 MB).");
      }
      let opt;
      try {
        // Re-encode: strips EXIF/GPS, downscales, and rejects a non-image.
        opt = await optimizeImage(file.buffer);
      } catch {
        throw new BadRequestException(
          "That image couldn't be read — it may be corrupt or not an image.",
        );
      }
      const fileKey = `hd-${messageId}-${randomUUID()}${opt.ext}`;
      await saveHelpdeskFile(fileKey, opt.buffer);
      await this.prisma.helpdeskAttachment.create({
        data: {
          messageId,
          fileKey,
          originalName: (file.originalname || "image").slice(0, 120),
          mimeType: opt.mimeType,
          size: opt.buffer.length,
          width: opt.width,
          height: opt.height,
        },
      });
    }
  }
}

// ---------------------------------------------------------------- helpers

function displayName(p: AuthenticatedPrincipal): string {
  return p.username ?? p.email;
}

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function toSummary(
  c: Prisma.HelpdeskConversationGetPayload<object>,
): HelpdeskConversationSummaryDTO {
  return {
    id: c.id,
    subject: c.subject,
    status: c.status,
    category: c.category,
    unread: c.unreadForMember,
    lastMessageAt: c.lastMessageAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
  };
}

function toMessage(m: MsgWithAttachments): HelpdeskMessageDTO {
  return {
    id: m.id,
    seq: m.seq,
    authorKind: m.authorKind,
    authorName: m.authorName,
    body: m.body,
    attachments: m.attachments.map((a) => ({
      id: a.id,
      originalName: a.originalName,
      mimeType: a.mimeType,
      width: a.width,
      height: a.height,
    })),
    createdAt: m.createdAt.toISOString(),
  };
}

function toAdminMessage(m: MsgWithAttachments): HelpdeskAdminMessageDTO {
  return { ...toMessage(m), internal: m.internal };
}

function toThread(
  c: ConvWithMessages,
  replyTimeNote: string | null,
): HelpdeskThreadDTO {
  return {
    id: c.id,
    subject: c.subject,
    status: c.status,
    category: c.category,
    replyTimeNote,
    messages: c.messages.map(toMessage),
    satisfactionUp: c.satisfactionUp ?? null,
    createdAt: c.createdAt.toISOString(),
    lastMessageAt: c.lastMessageAt.toISOString(),
  };
}

function memberName(u: { firstName: string | null; lastName: string | null }) {
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || null;
}

function toAdminListItem(r: AdminListRow) {
  return {
    id: r.id,
    subject: r.subject,
    status: r.status,
    category: r.category,
    priority: r.ticket?.priority ?? "NORMAL",
    memberEmail: r.user.email,
    memberName: memberName(r.user),
    assigneeAdminId: r.ticket?.assigneeAdminId ?? null,
    unreadForAdmins: r.unreadForAdmins,
    reopenCount: r.reopenCount,
    lastMessageAt: r.lastMessageAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

function toAdminThread(r: AdminThreadRow): HelpdeskAdminThreadDTO {
  return {
    id: r.id,
    subject: r.subject,
    status: r.status,
    category: r.category,
    priority: r.ticket?.priority ?? "NORMAL",
    resolution: r.resolution,
    assigneeAdminId: r.ticket?.assigneeAdminId ?? null,
    reopenCount: r.reopenCount,
    member: { id: r.user.id, email: r.user.email, name: memberName(r.user) },
    messages: r.messages.map(toAdminMessage),
    satisfactionUp: r.satisfactionUp ?? null,
    satisfactionNote: r.satisfactionNote ?? null,
    createdAt: r.createdAt.toISOString(),
    lastMessageAt: r.lastMessageAt.toISOString(),
  };
}

function toAdminArticle(a: {
  id: string;
  slug: string;
  title: string;
  body: string;
  category: HelpdeskAdminArticleDTO["category"];
  keywords: string[];
  published: boolean;
  sortOrder: number;
  updatedAt: Date;
}): HelpdeskAdminArticleDTO {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    body: a.body,
    category: a.category,
    keywords: a.keywords,
    published: a.published,
    sortOrder: a.sortOrder,
    updatedAt: a.updatedAt.toISOString(),
  };
}
