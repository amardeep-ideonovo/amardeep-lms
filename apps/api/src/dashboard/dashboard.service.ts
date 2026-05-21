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
    const [categories, courses, activeLevels] = await Promise.all([
      this.prisma.category.findMany({ orderBy: { order: 'asc' } }),
      this.prisma.course.findMany({
        orderBy: { order: 'asc' },
        include: { courseLevels: { select: { levelId: true } } },
      }),
      this.access.activeLevelIds(userId),
    ]);

    const toCard = (c: (typeof courses)[number]) => {
      const assigned = c.courseLevels.map((cl) => cl.levelId);
      return {
        id: c.id,
        title: c.title,
        description: c.description,
        categoryId: c.categoryId,
        locked: isCourseLocked(assigned, activeLevels),
      };
    };

    const sections = categories.map((cat) => ({
      category: { id: cat.id, name: cat.name, order: cat.order },
      courses: courses.filter((c) => c.categoryId === cat.id).map(toCard),
    }));

    // Group orphan courses (no category) so they're still visible.
    const orphans = courses.filter((c) => !c.categoryId);
    if (orphans.length) {
      sections.push({
        category: { id: '', name: 'Uncategorized', order: 9999 },
        courses: orphans.map(toCard),
      });
    }

    return { categories: sections };
  }
}
