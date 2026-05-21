import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Resolves the set of levelIds a user currently holds with status ACTIVE.
// Centralized so the access rule is computed identically for dashboard,
// course list and lesson access.
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async activeLevelIds(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.userLevel.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { levelId: true },
    });
    return new Set(rows.map((r) => r.levelId));
  }
}
