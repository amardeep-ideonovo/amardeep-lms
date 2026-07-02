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

  // Pure entitlement predicate for a live session, evaluated against a
  // pre-resolved ACTIVE level set (resolve once per request via activeLevelIds,
  // exactly like course/lesson gating — never one query per session). A session
  // with audience ALL_ACTIVE is visible to any member holding >=1 active level;
  // LEVELS is visible only when the member's active set intersects a targeted
  // Level. An empty targets array therefore fails closed (invisible to all).
  canAccessLiveSessionWith(
    activeLevelIds: Set<string>,
    session: { audience: 'ALL_ACTIVE' | 'LEVELS'; levelIds: string[] },
  ): boolean {
    if (session.audience === 'ALL_ACTIVE') return activeLevelIds.size > 0;
    return session.levelIds.some((id) => activeLevelIds.has(id));
  }

  // Map of courseId -> number of lessons the user has completed, for progress
  // bars. One query, aggregated in memory.
  async completedCountByCourse(userId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.lessonProgress.findMany({
      where: { userId },
      select: { lesson: { select: { courseId: true } } },
    });
    const map = new Map<string, number>();
    for (const r of rows) {
      const cid = r.lesson.courseId;
      map.set(cid, (map.get(cid) ?? 0) + 1);
    }
    return map;
  }
}
