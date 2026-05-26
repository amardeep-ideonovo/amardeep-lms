import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MemberRow } from '@lms/types';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailchimpProducer } from '../mailchimp/mailchimp.producer';
import { UpdateMemberDto } from './dto/member.dto';

// A member row with its levels joined — the shape both list() and update() map.
type MemberWithLevels = Prisma.UserGetPayload<{
  include: { levels: { include: { level: true } } };
}>;

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailchimp: MailchimpProducer,
  ) {}

  private static readonly WITH_LEVELS = {
    levels: { include: { level: true } },
  } as const;

  private toRow(u: MemberWithLevels): MemberRow {
    return {
      id: u.id,
      username: u.username,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      phone: u.phone,
      registeredAt: u.createdAt.toISOString(),
      levels: u.levels.map((ul) => ({
        id: ul.level.id,
        name: ul.level.name,
        status: ul.status,
      })),
    };
  }

  async list(): Promise<MemberRow[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: MembersService.WITH_LEVELS,
    });
    return users.map((u) => this.toRow(u));
  }

  /** Update admin-editable profile fields (first/last name, phone). */
  async update(id: string, dto: UpdateMemberDto): Promise<MemberRow> {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Member not found');

    // Provided + empty -> clear to null; provided + value -> trim & set;
    // absent (undefined) -> leave unchanged.
    const norm = (v?: string) =>
      v === undefined ? undefined : v.trim() || null;

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        firstName: norm(dto.firstName),
        lastName: norm(dto.lastName),
        phone: norm(dto.phone),
      },
      include: MembersService.WITH_LEVELS,
    });
    return this.toRow(user);
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

    // Subscribe to the level's audience (or the global one) and apply its tag.
    if (level.mailchimpTag || level.mailchimpAudienceId) {
      await this.mailchimp.enqueueTag(
        'add',
        user.email,
        level.mailchimpTag ?? '',
        level.mailchimpAudienceId ?? undefined,
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
    // Deactivate the tag on the level's audience (membership is left intact —
    // we never auto-unsubscribe). Audience-only levels have no tag to remove.
    if (level.mailchimpTag && stillActive === 0) {
      await this.mailchimp.enqueueTag(
        'remove',
        user.email,
        level.mailchimpTag,
        level.mailchimpAudienceId ?? undefined,
      );
    }
    return { ok: true };
  }
}
