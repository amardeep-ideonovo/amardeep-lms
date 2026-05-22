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
   * Member dashboard: every category with its courses, each course carrying a
   * `locked` flag computed from the member's active levels. Courses with no
   * category are grouped under a synthetic "Uncategorized" bucket.
   */
  async build(userId: string): Promise<DashboardResponse> {
    const [categories, courses, activeLevels, completedByCourse] =
      await Promise.all([
        this.prisma.category.findMany({ orderBy: { order: 'asc' } }),
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

    const toCard = (c: (typeof courses)[number]) => {
      const assigned = c.courseLevels.map((cl) => cl.levelId);
      return {
        id: c.id,
        title: c.title,
        description: c.description,
        thumbnailUrl: c.thumbnailUrl,
        coverImageUrl: c.coverImageUrl,
        categoryId: c.categoryId,
        levelIds: assigned,
        locked: isCourseLocked(assigned, activeLevels),
        lessonCount: c._count.lessons,
        completedCount: completedByCourse.get(c.id) ?? 0,
      };
    };

    const sections = categories.map((cat) => ({
      category: {
        id: cat.id,
        name: cat.name,
        thumbnailUrl: cat.thumbnailUrl,
        order: cat.order,
      },
      courses: courses.filter((c) => c.categoryId === cat.id).map(toCard),
    }));

    // Group orphan courses (no category) so they're still visible.
    const orphans = courses.filter((c) => !c.categoryId);
    if (orphans.length) {
      sections.push({
        category: { id: '', name: 'Uncategorized', thumbnailUrl: null, order: 9999 },
        courses: orphans.map(toCard),
      });
    }

    return { categories: sections };
  }
}
