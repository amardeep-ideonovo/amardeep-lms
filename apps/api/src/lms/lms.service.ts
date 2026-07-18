import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type {
  CompleteLessonResponse,
  CourseCard,
  LessonDTO,
  LessonNoteDTO,
} from '@lms/types';
import type { LessonNote } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from './access.service';
import { isCourseLocked } from '../common/access.util';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { LESSON_NOTES_DIR } from './upload.config';
import { CertificatesService } from '../certificates/certificates.service';
import { AutomationService } from '../email/automation.service';
import {
  CreateCourseDto,
  CreateLessonDto,
  UpdateCourseDto,
  UpdateLessonDto,
} from './dto/lms.dto';

@Injectable()
export class LmsService {
  private readonly logger = new Logger(LmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly certificates: CertificatesService,
    private readonly automations: AutomationService,
  ) {}

  // ---------- Courses ----------

  /**
   * List courses. When `userId` is given (member context), compute `locked`
   * from the user's active levels; admins (no userId) see everything unlocked.
   */
  async listCourses(
    userId?: string,
    includeArchived = false,
  ): Promise<CourseCard[]> {
    const courses = await this.prisma.course.findMany({
      // Members never see archived courses; admins (includeArchived) see all so
      // they can badge + unarchive them.
      where: includeArchived ? {} : { archivedAt: null },
      orderBy: { order: 'asc' },
      include: {
        courseLevels: { select: { levelId: true } },
        _count: { select: { lessons: true } },
      },
    });

    // Resolve the three per-request access inputs together (mirrors
    // dashboard.service.build) rather than serially.
    const [activeLevels, purchased, completedByCourse] = userId
      ? await Promise.all([
          this.access.activeLevelIds(userId),
          this.access.purchasedCourseIds(userId),
          this.access.completedCountByCourse(userId),
        ])
      : [null, null, null];

    return courses.map((c) => {
      const assigned = c.courseLevels.map((cl) => cl.levelId);
      const owns = purchased?.has(c.id) ?? false;
      const locked = activeLevels
        ? isCourseLocked(assigned, activeLevels, owns)
        : false; // admin view
      // "Buy this course" is offered only to a member for whom the course is
      // LOCKED and a one-off price is configured + active. Admin view (no
      // userId → locked false) never flags purchasable.
      const hasOneOffPrice = c.priceActive && (c.priceAmount ?? 0) > 0;
      return {
        id: c.id,
        title: c.title,
        description: c.description,
        thumbnailUrl: c.thumbnailUrl,
        coverImageUrl: c.coverImageUrl,
        levelIds: assigned,
        locked,
        lessonCount: c._count.lessons,
        completedCount: completedByCourse?.get(c.id) ?? 0,
        purchasable: locked && hasOneOffPrice,
        priceAmount: c.priceAmount,
        priceCurrency: c.priceCurrency,
        priceActive: c.priceActive,
        archivedAt: c.archivedAt ? c.archivedAt.toISOString() : null,
      };
    });
  }

  async createCourse(dto: CreateCourseDto): Promise<CourseCard> {
    const course = await this.prisma.course.create({
      data: {
        title: dto.title,
        description: dto.description ?? null,
        thumbnailUrl: dto.thumbnailUrl ?? null,
        coverImageUrl: dto.coverImageUrl ?? null,
        order: dto.order ?? 0,
        priceAmount: dto.priceAmount ?? null,
        priceCurrency: dto.priceCurrency
          ? dto.priceCurrency.toLowerCase()
          : undefined,
        priceActive: dto.priceActive ?? undefined,
        // levelIds is required + non-empty (DTO-validated): always link ≥1 class.
        courseLevels: { create: dto.levelIds.map((levelId) => ({ levelId })) },
      },
    });
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      thumbnailUrl: course.thumbnailUrl,
      coverImageUrl: course.coverImageUrl,
      levelIds: dto.levelIds,
      locked: false,
      lessonCount: 0,
      completedCount: 0,
      purchasable: false,
      priceAmount: course.priceAmount,
      priceCurrency: course.priceCurrency,
      priceActive: course.priceActive,
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
          thumbnailUrl: dto.thumbnailUrl ?? undefined,
          coverImageUrl: dto.coverImageUrl ?? undefined,
          order: dto.order ?? undefined,
          // priceAmount is nullable: `undefined` leaves it unchanged, explicit
          // `null` clears the one-off price (course reverts to level-gated).
          priceAmount:
            dto.priceAmount === undefined ? undefined : dto.priceAmount,
          priceCurrency: dto.priceCurrency
            ? dto.priceCurrency.toLowerCase()
            : undefined,
          priceActive: dto.priceActive ?? undefined,
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

    const levels = await this.prisma.courseLevel.findMany({
      where: { courseId: id },
      select: { levelId: true },
    });

    return {
      id: course.id,
      title: course.title,
      description: course.description,
      thumbnailUrl: course.thumbnailUrl,
      coverImageUrl: course.coverImageUrl,
      levelIds: levels.map((l) => l.levelId),
      locked: false,
      lessonCount: 0,
      completedCount: 0,
      purchasable: false,
      priceAmount: course.priceAmount,
      priceCurrency: course.priceCurrency,
      priceActive: course.priceActive,
    };
  }

  async deleteCourse(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.course.findUnique({
      where: { id },
      include: {
        lessons: { include: { notes: { select: { filename: true } } } },
      },
    });
    if (!existing) throw new NotFoundException('Course not found');
    // Guard: refuse to hard-delete a course that members still own. UserCourse
    // is Cascade, so deleting wipes lifetime one-off purchases along with their
    // Stripe payment-correlation fields (breaking refund/chargeback handling).
    // Archive it instead.
    const active = await this.prisma.userCourse.count({
      where: { courseId: id, status: 'ACTIVE' },
    });
    if (active > 0) {
      throw new ConflictException(
        `Cannot delete: ${active} member(s) own this course. Archive it instead.`,
      );
    }
    // DB cascades lessons/levels/notes; clean up the note files on disk too.
    const files = existing.lessons.flatMap((l) =>
      l.notes.map((n) => n.filename),
    );
    await this.prisma.course.delete({ where: { id } });
    this.unlinkNoteFiles(files);
    return { ok: true };
  }

  /**
   * Soft-archive a course: hide it from members while KEEPING every lifetime
   * purchase (UserCourse) + its payment correlation. The ergonomic alternative
   * to a hard delete when members still own the course.
   */
  async archiveCourse(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.course.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Course not found');
    await this.prisma.course.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return { ok: true };
  }

  async unarchiveCourse(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.course.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Course not found');
    await this.prisma.course.update({
      where: { id },
      data: { archivedAt: null },
    });
    return { ok: true };
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
        lessons: {
          orderBy: { order: 'asc' },
          include: { notes: { orderBy: { order: 'asc' } } },
        },
      },
    });
    if (!course) throw new NotFoundException('Course not found');

    // Access gate (member context only; admins pass through). Mirrors getLesson
    // so a locked course never leaks its lesson list or content.
    if (userId) {
      const assigned = course.courseLevels.map((cl) => cl.levelId);
      const [activeLevels, owns] = await Promise.all([
        this.access.activeLevelIds(userId),
        this.access.ownsCourse(userId, courseId),
      ]);
      if (isCourseLocked(assigned, activeLevels, owns)) {
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
      thumbnailUrl: l.thumbnailUrl,
      videoUrl: l.videoUrl,
      durationSeconds: l.durationSeconds,
      order: l.order,
      completed: userId ? completedIds.has(l.id) : undefined,
      notes: l.notes.map((n) => this.toNoteDTO(n)),
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
        thumbnailUrl: dto.thumbnailUrl ?? null,
        videoUrl: dto.videoUrl ?? null,
        durationSeconds: dto.durationSeconds ?? null,
        order: dto.order ?? 0,
      },
    });
    return {
      id: lesson.id,
      courseId: lesson.courseId,
      title: lesson.title,
      content: lesson.content,
      thumbnailUrl: lesson.thumbnailUrl,
      videoUrl: lesson.videoUrl,
      durationSeconds: lesson.durationSeconds,
      order: lesson.order,
    };
  }

  async updateLesson(id: string, dto: UpdateLessonDto): Promise<LessonDTO> {
    const existing = await this.prisma.lesson.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Lesson not found');
    const lesson = await this.prisma.lesson.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        content: dto.content ?? undefined,
        thumbnailUrl: dto.thumbnailUrl ?? undefined,
        videoUrl: dto.videoUrl ?? undefined,
        durationSeconds: dto.durationSeconds ?? undefined,
        order: dto.order ?? undefined,
      },
      include: { notes: { orderBy: { order: 'asc' } } },
    });
    return {
      id: lesson.id,
      courseId: lesson.courseId,
      title: lesson.title,
      content: lesson.content,
      thumbnailUrl: lesson.thumbnailUrl,
      videoUrl: lesson.videoUrl,
      durationSeconds: lesson.durationSeconds,
      order: lesson.order,
      notes: lesson.notes.map((n) => this.toNoteDTO(n)),
    };
  }

  async deleteLesson(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.lesson.findUnique({
      where: { id },
      include: { notes: { select: { filename: true } } },
    });
    if (!existing) throw new NotFoundException('Lesson not found');
    await this.prisma.lesson.delete({ where: { id } });
    this.unlinkNoteFiles(existing.notes.map((n) => n.filename));
    return { ok: true };
  }

  /**
   * Member lesson view. 403 unless the viewer holds an active UserLevel among
   * the lesson's course's levels (open course => always allowed).
   */
  async getLesson(lessonId: string, userId: string): Promise<LessonDTO> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        course: {
          include: { courseLevels: { select: { levelId: true } } },
        },
        notes: { orderBy: { order: 'asc' } },
      },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');

    const assigned = lesson.course.courseLevels.map((cl) => cl.levelId);
    const [activeLevels, owns] = await Promise.all([
      this.access.activeLevelIds(userId),
      this.access.ownsCourse(userId, lesson.courseId),
    ]);
    if (isCourseLocked(assigned, activeLevels, owns)) {
      throw new ForbiddenException('You do not have access to this lesson');
    }

    const [completed, certificates] = await Promise.all([
      this.prisma.lessonProgress.findUnique({
        where: { userId_lessonId: { userId, lessonId } },
      }),
      // Present only when this lesson is the terminal lesson of an actively
      // held class with certificates configured — drives "Get certificate".
      this.certificates.statusForLesson(userId, lessonId, assigned, activeLevels),
    ]);

    return {
      id: lesson.id,
      courseId: lesson.courseId,
      title: lesson.title,
      content: lesson.content,
      thumbnailUrl: lesson.thumbnailUrl,
      videoUrl: lesson.videoUrl,
      durationSeconds: lesson.durationSeconds,
      order: lesson.order,
      completed: !!completed,
      notes: lesson.notes.map((n) => this.toNoteDTO(n)),
      ...(certificates.length ? { certificates } : {}),
    };
  }

  async completeLesson(
    lessonId: string,
    userId: string,
  ): Promise<CompleteLessonResponse> {
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
    const [activeLevels, owns] = await Promise.all([
      this.access.activeLevelIds(userId),
      this.access.ownsCourse(userId, lesson.courseId),
    ]);
    if (isCourseLocked(assigned, activeLevels, owns)) {
      throw new ForbiddenException('You do not have access to this lesson');
    }

    // Detect a GENUINE first completion: only fire the LESSON_COMPLETED
    // automation when no progress row existed before this write. A re-POST (the
    // upsert just bumps completedAt) is not a new completion and must NOT
    // re-trigger the mail — fire()'s per-recipient dedupeKey is a backstop, but
    // this keeps us off the send path entirely on repeats.
    const alreadyCompleted = await this.prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
      select: { id: true },
    });
    await this.prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      create: { userId, lessonId },
      update: { completedAt: new Date() },
    });
    if (!alreadyCompleted) {
      // Best-effort, off the response path: never let a misfiring automation
      // break the lesson-complete response. lesson/course titles are already
      // loaded above, so no extra query for vars; we only look up the member's
      // email (this method only carries userId).
      void this.fireLessonCompleted(
        userId,
        lesson.title,
        lesson.course.title,
      );
    }
    // Completing the FINAL lesson of a class returns the fresh certificate
    // state so clients can surface "Get certificate" without a refetch.
    const certificates = await this.certificates.statusForLesson(
      userId,
      lessonId,
      assigned,
      activeLevels,
    );
    return { ok: true, ...(certificates.length ? { certificates } : {}) };
  }

  // Fire the LESSON_COMPLETED automation for a genuine new completion. Resolves
  // the member's email + firstName (completeLesson only carries userId) and the
  // brand, then hands off to AutomationService.fire (best-effort, never throws).
  // The outer catch is belt-and-braces so a lookup/send hiccup can't surface on
  // the lesson-complete response. Mirrors the SIGNUP/CERTIFICATE_ISSUED wiring.
  private async fireLessonCompleted(
    userId: string,
    lessonTitle: string,
    courseTitle: string,
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, firstName: true },
      });
      if (!user?.email) return;
      const brand = await this.brandTitle();
      const firstName = user.firstName?.trim() || 'there';
      await this.automations.fire('LESSON_COMPLETED', {
        email: user.email,
        vars: { firstName, brand, lessonTitle, courseTitle },
      });
    } catch (err) {
      this.logger.warn(
        `[lesson] LESSON_COMPLETED automation failed for user ${userId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  // Brand title for member-facing automation emails. Read straight from the
  // AppConfig singleton (we don't inject AppConfigService — lms isn't in its
  // module); fall back to the default if the row is missing/blank.
  private async brandTitle(): Promise<string> {
    try {
      const row = await this.prisma.appConfig.findUnique({
        where: { id: 'singleton' },
      });
      const title = (row?.config as { title?: unknown } | null)?.title;
      return typeof title === 'string' && title.trim() ? title : 'LMS';
    } catch {
      return 'LMS';
    }
  }

  /** Undo a mark-complete. Idempotent — no row, no error. */
  async uncompleteLesson(
    lessonId: string,
    userId: string,
  ): Promise<{ ok: true }> {
    const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw new NotFoundException('Lesson not found');
    await this.prisma.lessonProgress.deleteMany({ where: { userId, lessonId } });
    return { ok: true };
  }

  // ---------- Lesson notes (downloadable attachments) ----------

  private toNoteDTO(n: LessonNote): LessonNoteDTO {
    return {
      id: n.id,
      lessonId: n.lessonId,
      originalName: n.originalName,
      mimeType: n.mimeType,
      size: n.size,
      order: n.order,
      // Relative API path; clients prepend their API base and send the token
      // (Authorization header on web; ?token= when opened via the browser).
      downloadUrl: `/lessons/${n.lessonId}/notes/${n.id}/download`,
    };
  }

  /** Admin: attach uploaded files to a lesson as downloadable notes. */
  async addNotes(
    lessonId: string,
    files: Express.Multer.File[],
  ): Promise<LessonNoteDTO[]> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
    });
    if (!lesson) {
      // Don't leave orphaned uploads on disk if the lesson is gone.
      this.unlinkNoteFiles((files ?? []).map((f) => f.filename));
      throw new NotFoundException('Lesson not found');
    }
    if (!files?.length) {
      throw new BadRequestException('No files provided');
    }
    const existing = await this.prisma.lessonNote.count({
      where: { lessonId },
    });
    await this.prisma.$transaction(
      files.map((f, i) =>
        this.prisma.lessonNote.create({
          data: {
            lessonId,
            filename: f.filename,
            originalName: f.originalname,
            mimeType: f.mimetype,
            size: f.size,
            order: existing + i,
          },
        }),
      ),
    );
    const notes = await this.prisma.lessonNote.findMany({
      where: { lessonId },
      orderBy: { order: 'asc' },
    });
    return notes.map((n) => this.toNoteDTO(n));
  }

  /** Admin: remove a note (db row + the file on disk). */
  async deleteNote(lessonId: string, noteId: string): Promise<{ ok: true }> {
    const note = await this.prisma.lessonNote.findUnique({
      where: { id: noteId },
    });
    if (!note || note.lessonId !== lessonId) {
      throw new NotFoundException('Note not found');
    }
    await this.prisma.lessonNote.delete({ where: { id: noteId } });
    this.unlinkNoteFiles([note.filename]);
    return { ok: true };
  }

  /** Admin: rename a note's display/download filename (stored file untouched). */
  async renameNote(
    lessonId: string,
    noteId: string,
    originalName: string,
  ): Promise<LessonNoteDTO> {
    const note = await this.prisma.lessonNote.findUnique({
      where: { id: noteId },
    });
    if (!note || note.lessonId !== lessonId) {
      throw new NotFoundException('Note not found');
    }
    // Sanitize: strip CR/LF/quotes (Content-Disposition safety) + cap length.
    const clean =
      originalName.trim().replace(/[\r\n"]/g, '').slice(0, 200) ||
      note.originalName;
    const updated = await this.prisma.lessonNote.update({
      where: { id: noteId },
      data: { originalName: clean },
    });
    return this.toNoteDTO(updated);
  }

  /**
   * Resolve a note for download under the SAME access gate as getLesson:
   * admins pass through; members must hold an active level for the lesson's
   * course (open courses always allowed). Returns the absolute path + metadata
   * for streaming.
   */
  async getDownloadableNote(
    lessonId: string,
    noteId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<{ absPath: string; originalName: string; mimeType: string }> {
    const note = await this.prisma.lessonNote.findUnique({
      where: { id: noteId },
      include: {
        lesson: {
          include: {
            course: {
              include: { courseLevels: { select: { levelId: true } } },
            },
          },
        },
      },
    });
    if (!note || note.lessonId !== lessonId) {
      throw new NotFoundException('Note not found');
    }
    if (!principal.isAdmin) {
      const assigned = note.lesson.course.courseLevels.map((cl) => cl.levelId);
      const [activeLevels, owns] = await Promise.all([
        this.access.activeLevelIds(principal.sub),
        this.access.ownsCourse(principal.sub, note.lesson.courseId),
      ]);
      if (isCourseLocked(assigned, activeLevels, owns)) {
        throw new ForbiddenException('You do not have access to this lesson');
      }
    }
    const absPath = path.join(LESSON_NOTES_DIR, note.filename);
    if (!fs.existsSync(absPath)) {
      throw new NotFoundException('File missing on server');
    }
    return { absPath, originalName: note.originalName, mimeType: note.mimeType };
  }

  // Best-effort removal of note files from disk (DB rows are handled by the
  // caller / cascade). Never throws — a missing file is fine.
  private unlinkNoteFiles(filenames: string[]): void {
    for (const name of filenames) {
      try {
        fs.unlinkSync(path.join(LESSON_NOTES_DIR, name));
      } catch {
        /* already gone — ignore */
      }
    }
  }
}
