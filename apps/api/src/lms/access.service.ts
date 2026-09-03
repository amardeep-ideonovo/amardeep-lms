import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SitePreviewService } from "../site-preview/site-preview.service";

// Resolves the set of levelIds a user currently holds with status ACTIVE.
// Centralized so the access rule is computed identically for dashboard,
// course list and lesson access.
@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sitePreview: SitePreviewService,
  ) {}

  async activeLevelIds(userId: string): Promise<Set<string>> {
    // The UNLOCKED admin preview member "holds" every published class, so all
    // paid/level-gated content resolves as a paying member's would — with no
    // change to isCourseLocked or any of its call sites (getLesson, dashboard,
    // my-classes, live). The LOCKED preview identity is deliberately NOT matched
    // here → it falls through to the real query below (holds nothing) and sees
    // the paywalled/upsell view.
    if (await this.sitePreview.isUnlockedPreviewUser(userId)) {
      const levels = await this.prisma.level.findMany({
        where: { published: true, archivedAt: null },
        select: { id: true },
      });
      return new Set(levels.map((l) => l.id));
    }
    // A grant counts only while it is ACTIVE *and* not past its expiry. expiresAt
    // is the period-end / dunning-grace deadline (billing keeps a grant ACTIVE
    // with expiresAt set while access is on borrowed time); enforcing it at read
    // time closes access the moment grace or the paid period lapses, without
    // waiting for the hourly sweep to flip the row's status.
    const rows = await this.prisma.userLevel.findMany({
      where: {
        userId,
        status: "ACTIVE",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
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
    session: { audience: "ALL_ACTIVE" | "LEVELS"; levelIds: string[] },
  ): boolean {
    if (session.audience === "ALL_ACTIVE") return activeLevelIds.size > 0;
    return session.levelIds.some((id) => activeLevelIds.has(id));
  }

  // Map of courseId -> number of lessons the user has COMPLETED, for progress
  // bars. One query, aggregated in memory. A LessonProgress row can now be
  // started-but-not-completed, so completion requires a non-null completedAt.
  async completedCountByCourse(userId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.lessonProgress.findMany({
      where: { userId, completedAt: { not: null } },
      select: { lesson: { select: { courseId: true } } },
    });
    const map = new Map<string, number>();
    for (const r of rows) {
      const cid = r.lesson.courseId;
      map.set(cid, (map.get(cid) ?? 0) + 1);
    }
    return map;
  }

  // Map of courseId -> number of lessons the user has STARTED (any progress
  // row exists — opened at least once). Drives the "In progress" course badge.
  async startedCountByCourse(userId: string): Promise<Map<string, number>> {
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
