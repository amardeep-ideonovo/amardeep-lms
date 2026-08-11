import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  MemberListDTO,
  MemberRow,
  MemberStatsDTO,
  MemberStatusFilter,
} from '@lms/types';
import { Prisma, type UserLevelStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

type ActorContext = { adminId?: string | null; ip?: string | null };
import { ContactsService } from '../contacts/contacts.service';
import { StripeService } from '../billing/stripe.service';
import { ListMembersQueryDto, UpdateMemberDto } from './dto/member.dto';

// A member row with its levels joined — the shape both list() and update() map.
type MemberWithLevels = Prisma.UserGetPayload<{
  include: { levels: { include: { level: { select: { id: true; name: true } } } } };
}>;

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly stripe: StripeService,
    private readonly audit: AuditService,
  ) {}

  // toRow only reads level.id + level.name, so select just those two instead of
  // the full Level row (description, skills JSON, image URLs, …) per grant.
  // The relation order is pinned so the chip order — and the summary tie-break
  // below — are stable rather than whatever Postgres happened to return.
  // `satisfies`, not `as const`: a readonly orderBy tuple does not assign to
  // Prisma's mutable arg types.
  private static readonly WITH_LEVELS = {
    levels: {
      include: { level: { select: { id: true, name: true } } },
      orderBy: [{ grantedAt: 'desc' }, { id: 'desc' }],
    },
  } satisfies Prisma.UserInclude;

  private toRow(u: MemberWithLevels): MemberRow {
    // Paid-subscription summary for the admin list, derived from STRIPE grants
    // (manual grants are not paid subscriptions). null = never subscribed.
    //
    // The pick is by explicit PRECEDENCE, not by relation order: it used to be
    // find()/[0] over an unordered include, so a member holding several STRIPE
    // grants got a non-deterministic answer. That is also what makes the status
    // filter in list() expressible as a WHERE — you cannot filter on a
    // non-deterministic function.
    const stripeLevels = u.levels.filter((ul) => ul.source === 'STRIPE');
    const summary = MembersService.SUB_STATUS_ORDER.map((s) =>
      stripeLevels.find((ul) => ul.status === s),
    ).find(Boolean);
    const activePaid =
      summary && (summary.status === 'ACTIVE' || summary.status === 'PAST_DUE')
        ? summary
        : undefined;
    return {
      id: u.id,
      username: u.username,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      phone: u.phone,
      registeredAt: u.createdAt.toISOString(),
      // Only classes the member CURRENTLY holds (ACTIVE). Canceled/expired/paused
      // grants are history — the Subscription column still surfaces paid status.
      levels: u.levels
        .filter((ul) => ul.status === 'ACTIVE')
        .map((ul) => ({
          id: ul.level.id,
          name: ul.level.name,
          source: ul.source,
          status: ul.status,
          lifetime: ul.lifetime,
        })),
      subscription: summary
        ? {
            active: !!activePaid,
            status: summary.status,
            planName: summary.level.name,
          }
        : null,
    };
  }

  // Precedence used to pick the ONE grant that represents a member's paid
  // status. Highest first; ties inside a status fall back to the pinned
  // grantedAt-desc relation order.
  private static readonly SUB_STATUS_ORDER = [
    'ACTIVE',
    'PAST_DUE',
    'PAUSED',
    'CANCELED',
    'EXPIRED',
  ] as const;

  // Translate a rendered status pill into a WHERE over STRIPE grants, using the
  // same precedence toRow applies: "this status wins" == has one AND has none
  // that outrank it.
  private statusWhere(status: MemberStatusFilter): Prisma.UserWhereInput {
    const has = (s: string): Prisma.UserWhereInput => ({
      levels: { some: { source: 'STRIPE', status: s as UserLevelStatus } },
    });
    const hasNoneOf = (ss: readonly string[]): Prisma.UserWhereInput => ({
      levels: {
        none: { source: 'STRIPE', status: { in: ss as UserLevelStatus[] } },
      },
    });
    const outranking = (s: string) =>
      MembersService.SUB_STATUS_ORDER.slice(
        0,
        MembersService.SUB_STATUS_ORDER.indexOf(
          s as (typeof MembersService.SUB_STATUS_ORDER)[number],
        ),
      );
    switch (status) {
      case 'active':
        // A member with NO paid grant renders as "Active" too — they
        // registered. Missing this would drop most of the table.
        return {
          OR: [
            { levels: { none: { source: 'STRIPE' } } },
            has('ACTIVE'),
          ],
        };
      case 'past_due':
        return { AND: [has('PAST_DUE'), hasNoneOf(outranking('PAST_DUE'))] };
      case 'paused':
        return { AND: [has('PAUSED'), hasNoneOf(outranking('PAUSED'))] };
      case 'canceled':
        return { AND: [has('CANCELED'), hasNoneOf(outranking('CANCELED'))] };
      case 'expired':
        return { AND: [has('EXPIRED'), hasNoneOf(outranking('EXPIRED'))] };
    }
  }

  // The WHERE for the members list — extracted so the members Excel export
  // (ReportsService) applies the EXACT same class/status/search filters as the
  // on-screen list (ignoring pagination). Kept in one place so parity can't drift.
  buildListWhere(query: ListMembersQueryDto = {}): Prisma.UserWhereInput {
    const and: Prisma.UserWhereInput[] = [];

    const q = query.q?.trim();
    if (q) {
      and.push({
        OR: [
          { email: { contains: q, mode: 'insensitive' } },
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { username: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    if (query.levelId) {
      // Scoped to ACTIVE grants to match MemberRow.levels (and the chips the
      // admin sees) — a canceled grant must not make a member match a class.
      and.push(
        query.levelId === '__none__'
          ? { levels: { none: { status: 'ACTIVE' } } }
          : { levels: { some: { levelId: query.levelId, status: 'ACTIVE' } } },
      );
    }
    if (query.status) and.push(this.statusWhere(query.status));

    return and.length ? { AND: and } : {};
  }

  async list(query: ListMembersQueryDto = {}): Promise<MemberListDTO> {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 100);
    const where = this.buildListWhere(query);
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        // id is the tiebreaker: createdAt is neither unique nor indexed, so on
        // its own rows could repeat or vanish between pages.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: MembersService.WITH_LEVELS,
      }),
    ]);
    return { items: users.map((u) => this.toRow(u)), total, page, pageSize };
  }

  /**
   * Whole-table KPIs for the dashboard and reports. These are counts, never a
   * page: paginating the list would otherwise silently turn "total members"
   * into "members on this page".
   */
  async stats(): Promise<MemberStatsDTO> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [total, activeSubs, pastDue, newThisWeek] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({
        where: {
          levels: {
            some: { source: 'STRIPE', status: { in: ['ACTIVE', 'PAST_DUE'] } },
          },
        },
      }),
      this.prisma.user.count({ where: this.statusWhere('past_due') }),
      this.prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    ]);
    return { total, activeSubs, pastDue, newThisWeek };
  }

  async get(id: string): Promise<MemberRow> {
    const u = await this.prisma.user.findUnique({
      where: { id },
      include: MembersService.WITH_LEVELS,
    });
    if (!u) throw new NotFoundException('Member not found');
    return this.toRow(u);
  }

  /**
   * Update admin-editable profile fields (email, first/last name, phone).
   *
   * Email is special: it is the member's login identity and is mirrored to the
   * Stripe Customer and the in-house contact. When it changes we (1) reject a
   * duplicate, (2) sync Stripe FIRST so a failure aborts before we touch the DB
   * (a 502), (3) update the DB (P2002 backstop -> 409, reverting Stripe), then
   * (4) run a best-effort in-house contact re-key. Names/phone keep their
   * "empty string clears, absent leaves unchanged" semantics; email is never
   * cleared (required + unique).
   */
  async update(id: string, dto: UpdateMemberDto): Promise<MemberRow> {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Member not found');

    const norm = (v?: string) =>
      v === undefined ? undefined : v.trim() || null;

    const newEmail =
      dto.email === undefined ? undefined : dto.email.trim().toLowerCase();
    const emailChanging =
      newEmail !== undefined && newEmail !== '' && newEmail !== existing.email;

    if (emailChanging) {
      // Fast-path uniqueness check; a P2002 backstop below covers the race.
      const taken = await this.prisma.user.findUnique({
        where: { email: newEmail },
      });
      if (taken && taken.id !== id) {
        throw new ConflictException(
          'Another member already uses that email address',
        );
      }
      // Sync Stripe first — payments are keyed on the customer id, but receipts
      // and the dashboard must stay correct, and a failure here is a real signal.
      if (existing.stripeCustomerId) {
        try {
          await this.stripe.updateCustomerEmail(
            existing.stripeCustomerId,
            newEmail as string,
          );
        } catch (err) {
          this.logger.error(
            `[members] Stripe customer email sync failed for ${existing.email}: ${
              err instanceof Error ? err.message : err
            }`,
          );
          throw new BadGatewayException(
            'Could not sync the new email to Stripe; email was not changed.',
          );
        }
      }
    }

    let user: MemberWithLevels;
    try {
      user = await this.prisma.user.update({
        where: { id },
        data: {
          ...(emailChanging ? { email: newEmail } : {}),
          firstName: norm(dto.firstName),
          lastName: norm(dto.lastName),
          phone: norm(dto.phone),
        },
        include: MembersService.WITH_LEVELS,
      });
    } catch (err) {
      // Lost the unique-email race between the pre-check and the write.
      if (
        emailChanging &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        if (existing.stripeCustomerId) {
          try {
            await this.stripe.updateCustomerEmail(
              existing.stripeCustomerId,
              existing.email,
            );
          } catch {
            /* best-effort revert; nothing else to do */
          }
        }
        throw new ConflictException(
          'Another member already uses that email address',
        );
      }
      throw err;
    }

    // In-house re-key across the member's audiences — best-effort. Never fail
    // the request on a contacts blip (eventual consistency is fine for marketing
    // data). changeEmail() is exhaustive across all in-house audiences.
    if (emailChanging) {
      try {
        await this.contacts.changeEmail(existing.email, newEmail as string);
      } catch (err) {
        this.logger.warn(
          `[members] contacts email-change failed for ${existing.email}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    return this.toRow(user);
  }

  /**
   * Admin override: set a member's password directly. Unlike the member's own
   * change-password flow, no current password is required (the admin is trusted).
   * Bumps tokenVersion so every outstanding JWT for the member is revoked — an
   * admin-forced reset is typically for a locked-out or compromised account, so
   * any attacker session must die immediately (mirrors AdminsService.setPassword
   * and the self-service password paths).
   */
  async setPassword(
    id: string,
    newPassword: string,
    actor?: ActorContext,
  ): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Member not found');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    await this.audit.write({
      actorAdminId: actor?.adminId,
      action: 'member.password_reset',
      targetType: 'user',
      targetId: id,
      ip: actor?.ip,
    });
    return { ok: true };
  }

  /** Manually grant a level (source=MANUAL, status=ACTIVE) + enqueue tag add. */
  async addLevel(
    userId: string,
    levelId: string,
    actor?: ActorContext,
  ): Promise<{ ok: true }> {
    const [user, level] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.level.findUnique({ where: { id: levelId } }),
    ]);
    if (!user) throw new NotFoundException('Member not found');
    if (!level) throw new NotFoundException('Level not found');

    await this.prisma.userLevel.upsert({
      where: {
        userId_levelId_source: { userId, levelId, source: 'MANUAL' },
      },
      create: { userId, levelId, source: 'MANUAL', status: 'ACTIVE' },
      update: { status: 'ACTIVE' },
    });

    // ALWAYS capture the granted member into the class's in-house audience
    // (null audienceId → default "Members" audience). syncTags upserts the
    // contact first, so it lands the member even when audienceTags is empty —
    // this is what ensures a tagless class still adds members to an audience.
    // Best-effort: a contacts blip must not fail the grant.
    try {
      await this.contacts.syncTags(
        'add',
        user.email,
        level.audienceTags,
        level.audienceId ?? undefined,
        { userId: user.id ?? userId, source: 'ADMIN' },
      );
    } catch (err) {
      this.logger.warn(
        `[members] contacts add-tags failed for ${user.email}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
    await this.audit.write({
      actorAdminId: actor?.adminId,
      action: 'member.level_grant',
      targetType: 'user',
      targetId: userId,
      metadata: { levelId },
      ip: actor?.ip,
    });
    return { ok: true };
  }

  /** Remove a manual grant + enqueue tag remove (if no other active grant). */
  async removeLevel(userId: string, levelId: string): Promise<{ ok: true }> {
    const [user, level] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.level.findUnique({ where: { id: levelId } }),
    ]);
    if (!user) throw new NotFoundException('Member not found');
    if (!level) throw new NotFoundException('Level not found');

    const existing = await this.prisma.userLevel.findUnique({
      where: {
        userId_levelId_source: { userId, levelId, source: 'MANUAL' },
      },
    });
    if (!existing) {
      throw new BadRequestException('No manual grant to remove for this level');
    }
    await this.prisma.userLevel.delete({ where: { id: existing.id } });

    // Only drop the tag if the user has no OTHER active grant for this level
    // (e.g. a Stripe-sourced one).
    const stillActive = await this.prisma.userLevel.count({
      where: { userId, levelId, status: 'ACTIVE' },
    });
    // Deactivate the tags on the level's in-house audience (membership is left
    // intact — we never auto-unsubscribe). A level with no tags has nothing to
    // remove.
    if (level.audienceTags.length && stillActive === 0) {
      // In-house list write (best-effort), keyed by the class's in-house
      // audience (null → default "Members" audience).
      try {
        await this.contacts.syncTags(
          'remove',
          user.email,
          level.audienceTags,
          level.audienceId ?? undefined,
        );
      } catch (err) {
        this.logger.warn(
          `[members] contacts remove-tags failed for ${user.email}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
    return { ok: true };
  }
}
