import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CategoryDTO,
  CourseCard,
  LessonDTO,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from './access.service';
import { MuxService } from './mux.service';
import { isCourseLocked } from '../common/access.util';
import {
  CreateCategoryDto,
  CreateCourseDto,
  CreateLessonDto,
  UpdateCourseDto,
} from './dto/lms.dto';

@Injectable()
export class LmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly mux: MuxService,
  ) {}

  // ---------- Categories ----------

  async listCategories(): Promise<CategoryDTO[]> {
    const cats = await this.prisma.category.findMany({
      orderBy: { order: 'asc' },
    });
    return cats.map((c) => ({ id: c.id, name: c.name, order: c.order }));
  }

  async createCategory(dto: CreateCategoryDto): Promise<CategoryDTO> {
    const cat = await this.prisma.category.create({
      data: { name: dto.name, order: dto.order ?? 0 },
    });
    return { id: cat.id, name: cat.name, order: cat.order };
  }

  // ---------- Courses ----------

  /**
   * List courses. When `userId` is given (member context), compute `locked`
   * from the user's active levels; admins (no userId) see everything unlocked.
   */
  async listCourses(userId?: string): Promise<CourseCard[]> {
    const courses = await this.prisma.course.findMany({
      orderBy: { order: 'asc' },
      include: {
        courseLevels: { select: { levelId: true } },
        _count: { select: { lessons: true } },
      },
    });

    const activeLevels = userId
      ? await this.access.activeLevelIds(userId)
      : null;
    const completedByCourse = userId
      ? await this.access.completedCountByCourse(userId)
      : null;

    return courses.map((c) => {
      const assigned = c.courseLevels.map((cl) => cl.levelId);
      const locked = activeLevels
        ? isCourseLocked(assigned, activeLevels)
        : false; // admin view
      return {
        id: c.id,
        title: c.title,
        description: c.description,
        categoryId: c.categoryId,
        locked,
        lessonCount: c._count.lessons,
        completedCount: completedByCourse?.get(c.id) ?? 0,
      };
    });
  }

  async createCourse(dto: CreateCourseDto): Promise<CourseCard> {
    const course = await this.prisma.course.create({
      data: {
        title: dto.title,
        description: dto.description ?? null,
        categoryId: dto.categoryId ?? null,
        order: dto.order ?? 0,
        courseLevels: dto.levelIds?.length
          ? { create: dto.levelIds.map((levelId) => ({ levelId })) }
          : undefined,
      },
    });
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      categoryId: course.categoryId,
      locked: false,
      lessonCount: 0,
      completedCount: 0,
    };
  }

  async updateCourse(id: string, dto: UpdateCourseDto): Promise<CourseCard> {
    const existing = await this.prisma.course.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Course not found');

    const course = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.course.update({
        where: { id },
        data: {
          title: dto.title ?? undefined,
          description: dto.description ?? undefined,
          categoryId: dto.categoryId ?? undefined,
          order: dto.order ?? undefined,
        },
      });
      // Replace level assignments wholesale when provided.
      if (dto.levelIds) {
        await tx.courseLevel.deleteMany({ where: { courseId: id } });
        if (dto.levelIds.length) {
          await tx.courseLevel.createMany({
            data: dto.levelIds.map((levelId) => ({ courseId: id, levelId })),
            skipDuplicates: true,
          });
        }
      }
      return updated;
    });

    return {
      id: course.id,
      title: course.title,
      description: course.description,
      categoryId: course.categoryId,
      locked: false,
      lessonCount: 0,
      completedCount: 0,
    };
  }

  // ---------- Lessons ----------

  async listCourseLessons(
    courseId: string,
    userId?: string,
  ): Promise<LessonDTO[]> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: {
        courseLevels: { select: { levelId: true } },
        lessons: { orderBy: { order: 'asc' } },
      },
    });
    if (!course) throw new NotFoundException('Course not found');

    // Access gate (member context only; admins pass through). Mirrors getLesson
    // so a locked course never leaks its lesson list or content.
    if (userId) {
      const assigned = course.courseLevels.map((cl) => cl.levelId);
      const activeLevels = await this.access.activeLevelIds(userId);
      if (isCourseLocked(assigned, activeLevels)) {
        throw new ForbiddenException('You do not have access to this course');
      }
    }

    let completedIds = new Set<string>();
    if (userId) {
      const progress = await this.prisma.lessonProgress.findMany({
        where: { userId, lesson: { courseId } },
        select: { lessonId: true },
      });
      completedIds = new Set(progress.map((p) => p.lessonId));
    }

    return course.lessons.map((l) => ({
      id: l.id,
      courseId: l.courseId,
      title: l.title,
      content: l.content,
      order: l.order,
      completed: userId ? completedIds.has(l.id) : undefined,
    }));
  }

  async createLesson(
    courseId: string,
    dto: CreateLessonDto,
  ): Promise<LessonDTO> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) throw new NotFoundException('Course not found');
    const lesson = await this.prisma.lesson.create({
      data: {
        courseId,
        title: dto.title,
        content: dto.content ?? null,
        muxAssetId: dto.muxAssetId ?? null,
        videoUrl: dto.videoUrl ?? null,
        order: dto.order ?? 0,
      },
    });
    return {
      id: lesson.id,
      courseId: lesson.courseId,
      title: lesson.title,
      content: lesson.content,
      videoUrl: lesson.videoUrl,
      order: lesson.order,
    };
  }

  /**
   * Member lesson view. 403 unless the viewer holds an active UserLevel among
   * the lesson's course's levels (open course => always allowed). When allowed
   * and the lesson has video, attach a signed Mux playback token.
   */
  async getLesson(lessonId: string, userId: string): Promise<LessonDTO> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        course: {
          include: { courseLevels: { select: { levelId: true } } },
        },
      },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');

    const assigned = lesson.course.courseLevels.map((cl) => cl.levelId);
    const activeLevels = await this.access.activeLevelIds(userId);
    if (isCourseLocked(assigned, activeLevels)) {
      throw new ForbiddenException('You do not have access to this lesson');
    }

    const completed = await this.prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
    });

    const muxPlaybackToken = lesson.muxAssetId
      ? this.mux.signPlaybackToken(lesson.muxAssetId)
      : undefined;

    return {
      id: lesson.id,
      courseId: lesson.courseId,
      title: lesson.title,
      content: lesson.content,
      muxPlaybackToken,
      videoUrl: lesson.videoUrl,
      order: lesson.order,
      completed: !!completed,
    };
  }

  async completeLesson(
    lessonId: string,
    userId: string,
  ): Promise<{ ok: true }> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        course: {
          include: { courseLevels: { select: { levelId: true } } },
        },
      },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');

    // Same access gate as viewing.
    const assigned = lesson.course.courseLevels.map((cl) => cl.levelId);
    const activeLevels = await this.access.activeLevelIds(userId);
    if (isCourseLocked(assigned, activeLevels)) {
      throw new ForbiddenException('You do not have access to this lesson');
    }

    await this.prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      create: { userId, lessonId },
      update: { completedAt: new Date() },
    });
    return { ok: true };
  }
}
