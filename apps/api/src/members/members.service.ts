import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { MemberRow } from '@lms/types';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { MailchimpProducer } from '../mailchimp/mailchimp.producer';
import { ContactsService } from '../contacts/contacts.service';
import { StripeService } from '../billing/stripe.service';
import { UpdateMemberDto } from './dto/member.dto';

// A member row with its levels joined — the shape both list() and update() map.
type MemberWithLevels = Prisma.UserGetPayload<{
  include: { levels: { include: { level: true } } };
}>;

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailchimp: MailchimpProducer,
    private readonly contacts: ContactsService,
    private readonly stripe: StripeService,
  ) {}

  private static readonly WITH_LEVELS = {
    levels: { include: { level: true } },
  } as const;

  private toRow(u: MemberWithLevels): MemberRow {
    // Paid-subscription summary for the admin list, derived from STRIPE grants
    // (manual grants are not paid subscriptions). null = never subscribed.
    const stripeLevels = u.levels.filter((ul) => ul.source === 'STRIPE');
    const activePaid = stripeLevels.find(
      (ul) => ul.status === 'ACTIVE' || ul.status === 'PAST_DUE',
    );
    const summary = activePaid ?? stripeLevels[0];
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

  async list(): Promise<MemberRow[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: MembersService.WITH_LEVELS,
    });
    return users.map((u) => this.toRow(u));
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
   * Stripe Customer and the Mailchimp contact. When it changes we (1) reject a
   * duplicate, (2) sync Stripe FIRST so a failure aborts before we touch the DB
   * (a 502), (3) update the DB (P2002 backstop -> 409, reverting Stripe), then
   * (4) enqueue an async, best-effort Mailchimp re-key. Names/phone keep their
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

    // Mailchimp re-key across the member's audiences — async + best-effort.
    // Never fail the request on a queue/Mailchimp blip (eventual consistency is
    // fine for marketing data).
    if (emailChanging) {
      try {
        // Classes now link to an INTERNAL Audience, never a Mailchimp list, so we
        // can no longer collect per-level Mailchimp audiences (their ids would be
        // internal Audience ids Mailchimp would reject). Re-key Mailchimp once,
        // globally — an empty audience list lets the producer fall back to the
        // Settings audience. The in-house re-key below (changeEmail) is exhaustive
        // across all in-house audiences. (Mailchimp is gated/no-op by default.)
        await this.mailchimp.enqueueEmailChange(
          existing.email,
          newEmail as string,
          [],
        );
      } catch (err) {
        this.logger.warn(
          `[members] mailchimp email-change enqueue failed for ${existing.email}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
      // In-house list dual-write (best-effort; eventual consistency is fine).
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
   * Existing sessions stay valid until their token expires.
   */
  async setPassword(id: string, newPassword: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Member not found');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    return { ok: true };
  }

  /** Manually grant a level (source=MANUAL, status=ACTIVE) + enqueue tag add. */
  async addLevel(userId: string, levelId: string): Promise<{ ok: true }> {
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
    // this is what fixes a no-Mailchimp class adding nobody to any audience.
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
    // Mirror the tags to Mailchimp (gated/no-op by default). Pass undefined for
    // the audience — Mailchimp expects a LIST id, not our internal Audience id,
    // so it falls back to the global Settings audience. Only worth enqueuing
    // when there are tags to apply.
    if (level.audienceTags.length) {
      await this.mailchimp.enqueueTags(
        'add',
        user.email,
        level.audienceTags,
        undefined,
      );
    }
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
    // remove. Mailchimp gets undefined for the audience (internal Audience id
    // would be rejected; falls back to the global Settings audience).
    if (level.audienceTags.length && stillActive === 0) {
      await this.mailchimp.enqueueTags(
        'remove',
        user.email,
        level.audienceTags,
        undefined,
      );
      // In-house list dual-write (best-effort), keyed by the class's in-house
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
