import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MemberRow } from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { MailchimpProducer } from '../mailchimp/mailchimp.producer';

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailchimp: MailchimpProducer,
  ) {}

  async list(): Promise<MemberRow[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: { levels: { include: { level: true } } },
    });
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      registeredAt: u.createdAt.toISOString(),
      levels: u.levels.map((ul) => ({
        id: ul.level.id,
        name: ul.level.name,
        status: ul.status,
      })),
    }));
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

    if (level.mailchimpTag) {
      await this.mailchimp.enqueueTag('add', user.email, level.mailchimpTag);
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
    if (level.mailchimpTag && stillActive === 0) {
      await this.mailchimp.enqueueTag('remove', user.email, level.mailchimpTag);
    }
    return { ok: true };
  }
}
