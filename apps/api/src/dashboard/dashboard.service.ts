import { Injectable } from '@nestjs/common';
import type { DashboardResponse } from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../lms/access.service';
import { isCourseLocked } from '../common/access.util';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  /**
   * Member dashboard: all courses, each carrying a `locked` flag computed from
   * the member's active levels. Courses are no longer grouped by category — they
   * are returned in a single section (empty category id) so the web/mobile
   * clients render a flat course list.
   */
  async build(userId: string): Promise<DashboardResponse> {
    const [courses, activeLevels, completedByCourse] = await Promise.all([
      this.prisma.course.findMany({
        orderBy: { order: 'asc' },
        include: {
          courseLevels: { select: { levelId: true } },
          _count: { select: { lessons: true } },
        },
      }),
      this.access.activeLevelIds(userId),
      this.access.completedCountByCourse(userId),
    ]);

    const courseCards = courses.map((c) => {
      const assigned = c.courseLevels.map((cl) => cl.levelId);
      return {
        id: c.id,
        title: c.title,
        description: c.description,
        thumbnailUrl: c.thumbnailUrl,
        coverImageUrl: c.coverImageUrl,
        levelIds: assigned,
        locked: isCourseLocked(assigned, activeLevels),
        lessonCount: c._count.lessons,
        completedCount: completedByCourse.get(c.id) ?? 0,
      };
    });

    return {
      categories: courseCards.length
        ? [
            {
              category: { id: '', name: '', thumbnailUrl: null, order: 0 },
              courses: courseCards,
            },
          ]
        : [],
    };
  }
}
