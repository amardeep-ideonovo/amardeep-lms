import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Prisma } from '@prisma/client';
import type {
  AdminCertificateListDTO,
  CertificateFieldKind,
  CertificateVerifyDTO,
  ClassCertificateStatusDTO,
  MyCertificateDTO,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AutomationService } from '../email/automation.service';
import { AppConfigService } from '../site/app-config.service';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';
import { MEDIA_ROOT, MEDIA_ROUTE } from '../media/media.config';
import { CERT_FILES_DIR, newSerial } from './certificates.config';
import { formatIssueDate, renderCertificatePdf } from './certificate-renderer';
import type { CertificateFieldLayout } from '@lms/types';

// Eligibility + claim/issue flows for class-completion certificates.
//
// RULES (single source of truth):
// - A level is ELIGIBLE for a user when it has >= 1 lesson across its courses
//   and the user has a LessonProgress row for EVERY one of those lessons.
// - The TERMINAL lesson of a level is the last lesson (order, createdAt, id)
//   of the last course WITH lessons (same tie-break) — empty trailing courses
//   don't hide the lesson-page button.
// - Status/claim require a CURRENTLY ACTIVE grant on the level (a canceled
//   member keeps any already-issued certificate but can't claim new ones).
// - A template must resolve (level override, else the default row); when none
//   resolves the feature is dormant and member surfaces omit certificate state.

interface LevelCompletion {
  levelId: string;
  totalLessons: number;
  lessonIds: string[];
  terminalLessonId: string | null;
}

type CertRow = Prisma.CertificateGetPayload<Record<string, never>>;

@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly automations: AutomationService,
    private readonly appConfig: AppConfigService,
  ) {}

  // ---------- completion math ----------

  // One query: every course (with lesson ids, ordered) of every given level.
  private async levelCompletionData(levelIds: string[]): Promise<Map<string, LevelCompletion>> {
    const map = new Map<string, LevelCompletion>();
    if (!levelIds.length) return map;
    const joins = await this.prisma.courseLevel.findMany({
      where: { levelId: { in: levelIds } },
      select: {
        levelId: true,
        course: {
          select: {
            id: true,
            order: true,
            createdAt: true,
            lessons: {
              select: { id: true },
              orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
    });
    for (const levelId of levelIds) {
      const courses = joins
        .filter((j) => j.levelId === levelId)
        .map((j) => j.course)
        .sort(
          (a, b) =>
            a.order - b.order ||
            a.createdAt.getTime() - b.createdAt.getTime() ||
            a.id.localeCompare(b.id),
        );
      const lessonIds = courses.flatMap((c) => c.lessons.map((l) => l.id));
      const lastWithLessons = [...courses].reverse().find((c) => c.lessons.length > 0);
      map.set(levelId, {
        levelId,
        totalLessons: lessonIds.length,
        lessonIds,
        terminalLessonId: lastWithLessons
          ? lastWithLessons.lessons[lastWithLessons.lessons.length - 1].id
          : null,
      });
    }
    return map;
  }

  private async completedCounts(
    userId: string,
    completions: LevelCompletion[],
  ): Promise<Map<string, number>> {
    const allIds = [...new Set(completions.flatMap((c) => c.lessonIds))];
    const out = new Map<string, number>();
    if (!allIds.length) return out;
    const rows = await this.prisma.lessonProgress.findMany({
      where: { userId, lessonId: { in: allIds } },
      select: { lessonId: true },
    });
    const done = new Set(rows.map((r) => r.lessonId));
    for (const c of completions) {
      out.set(c.levelId, c.lessonIds.reduce((n, id) => n + (done.has(id) ? 1 : 0), 0));
    }
    return out;
  }

  // Level override else the default template. null => feature dormant.
  private async resolveTemplateId(certificateTemplateId: string | null): Promise<string | null> {
    if (certificateTemplateId) {
      const row = await this.prisma.certificateTemplate.findUnique({
        where: { id: certificateTemplateId },
        select: { id: true },
      });
      if (row) return row.id;
      // Stale override (template deleted) — fall through to the default.
    }
    const dflt = await this.prisma.certificateTemplate.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    return dflt?.id ?? null;
  }

  private async needsName(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    return !`${user?.firstName ?? ''}${user?.lastName ?? ''}`.trim();
  }

  // ---------- member surfaces ----------

  /**
   * Certificate state for a lesson view: one entry per level (among the
   * lesson's course's levels that the user ACTIVELY holds) for which this
   * lesson is the terminal lesson and a template resolves. Cheap exit when
   * the lesson is terminal nowhere.
   */
  async statusForLesson(
    userId: string,
    lessonId: string,
    assignedLevelIds: string[],
    activeLevelIds: Set<string>,
  ): Promise<ClassCertificateStatusDTO[]> {
    const candidates = assignedLevelIds.filter((id) => activeLevelIds.has(id));
    if (!candidates.length) return [];
    const completions = await this.levelCompletionData(candidates);
    const terminalHere = [...completions.values()].filter(
      (c) => c.terminalLessonId === lessonId,
    );
    if (!terminalHere.length) return [];

    const [counts, levels, certs, defaultExists, needsName] = await Promise.all([
      this.completedCounts(userId, terminalHere),
      this.prisma.level.findMany({
        where: { id: { in: terminalHere.map((c) => c.levelId) } },
        select: { id: true, name: true, certificateTemplateId: true },
      }),
      this.prisma.certificate.findMany({
        where: { userId, levelId: { in: terminalHere.map((c) => c.levelId) } },
      }),
      this.prisma.certificateTemplate
        .findFirst({ where: { isDefault: true }, select: { id: true } })
        .then((r) => !!r),
      this.needsName(userId),
    ]);

    const out: ClassCertificateStatusDTO[] = [];
    for (const completion of terminalHere) {
      const level = levels.find((l) => l.id === completion.levelId);
      if (!level) continue;
      // Inline template resolution using the prefetched default flag (avoids a
      // query per level); stale overrides are caught at claim time anyway.
      const templateResolves = level.certificateTemplateId !== null || defaultExists;
      if (!templateResolves) continue;
      const cert = certs.find((c) => c.levelId === level.id) ?? null;
      out.push({
        levelId: level.id,
        levelName: level.name,
        eligible:
          completion.totalLessons >= 1 &&
          (counts.get(level.id) ?? 0) === completion.totalLessons,
        claimed: !!cert,
        certificateId: cert?.id ?? null,
        serial: cert?.serial ?? null,
        needsName,
      });
    }
    return out;
  }

  /**
   * Certificate state for an OWNED class page. Lesson totals arrive from the
   * caller (myClassCourses already aggregates them) so this only adds claim
   * state + template resolution.
   */
  async statusForLevel(
    userId: string,
    level: { id: string; name: string; certificateTemplateId: string | null },
    totals: { total: number; done: number },
  ): Promise<ClassCertificateStatusDTO | null> {
    const templateId = await this.resolveTemplateId(level.certificateTemplateId);
    if (!templateId) return null;
    const [cert, needsName] = await Promise.all([
      this.prisma.certificate.findUnique({
        where: { userId_levelId: { userId, levelId: level.id } },
      }),
      this.needsName(userId),
    ]);
    return {
      levelId: level.id,
      levelName: level.name,
      eligible: totals.total >= 1 && totals.done === totals.total,
      claimed: !!cert,
      certificateId: cert?.id ?? null,
      serial: cert?.serial ?? null,
      needsName,
    };
  }

  // ---------- claim ----------

  async claim(
    userId: string,
    dto: { levelId: string; name?: string },
  ): Promise<MyCertificateDTO> {
    // Idempotent fast path.
    const existing = await this.prisma.certificate.findUnique({
      where: { userId_levelId: { userId, levelId: dto.levelId } },
    });
    if (existing) return this.toMyDTO(existing);

    const level = await this.prisma.level.findUnique({
      where: { id: dto.levelId },
      select: { id: true, name: true, certificateTemplateId: true },
    });
    if (!level) throw new NotFoundException('Class not found');

    // Must currently hold the class.
    const active = await this.prisma.userLevel.findFirst({
      where: { userId, levelId: level.id, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!active) throw new NotFoundException('Class not found');

    // Server-side completion revalidation — the button is UX, this is the gate.
    const completion = (await this.levelCompletionData([level.id])).get(level.id);
    const done = completion
      ? ((await this.completedCounts(userId, [completion])).get(level.id) ?? 0)
      : 0;
    if (!completion || completion.totalLessons < 1 || done !== completion.totalLessons) {
      throw new ConflictException('Class is not fully complete');
    }

    const templateId = await this.resolveTemplateId(level.certificateTemplateId);
    if (!templateId) {
      throw new ConflictException('No certificate template is configured');
    }
    const template = await this.prisma.certificateTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template) throw new ConflictException('No certificate template is configured');

    // Name: profile first, claim-supplied fallback (NEVER written back).
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true },
    });
    const profileName = [user?.firstName, user?.lastName]
      .filter((p) => p && p.trim())
      .join(' ')
      .trim();
    const memberName = profileName || dto.name?.trim() || '';
    if (!memberName) throw new BadRequestException('NAME_REQUIRED');

    // Render BEFORE any row exists — artwork problems abort with nothing persisted.
    const issuedAt = new Date();
    const pdf = await this.renderForTemplate(template, {
      memberName,
      className: level.name,
      issueDate: formatIssueDate(issuedAt),
      serial: '', // re-rendered below once the serial survives the unique check
    });

    // Serial collisions are ~impossible (30^6/year) but retried anyway; the
    // (userId, levelId) unique turns claim races into "return the winner".
    for (let attempt = 0; attempt < 3; attempt++) {
      const serial = newSerial(issuedAt);
      const fileKey = `${serial}.pdf`;
      const finalPdf = await this.renderForTemplate(template, {
        memberName,
        className: level.name,
        issueDate: formatIssueDate(issuedAt),
        serial,
      });
      await fs.promises.mkdir(CERT_FILES_DIR, { recursive: true });
      const absPath = path.join(CERT_FILES_DIR, fileKey);
      await fs.promises.writeFile(absPath, finalPdf);
      try {
        const row = await this.prisma.certificate.create({
          data: {
            serial,
            userId,
            levelId: level.id,
            templateId: template.id,
            memberName,
            className: level.name,
            issuedAt,
            fileKey,
          },
        });
        this.notifications
          .record({
            type: 'CERTIFICATE_ISSUED',
            severity: 'INFO',
            title: 'Certificate issued',
            body: `${user?.email ?? memberName} earned "${level.name}" (${serial})`,
            userId,
            dedupeKey: `certificate:${userId}:${level.id}`,
          })
          .catch(() => undefined);
        // Member-facing automation hook (best-effort): fires the
        // CERTIFICATE_ISSUED trigger so an admin-created automation can email
        // the member their certificate. Nothing is seeded for this trigger, so
        // this is a no-op until an admin wires one up — it proves the hook. We
        // need an email to send to; skip silently if the user has none.
        if (user?.email) {
          const firstName = user.firstName?.trim() || 'there';
          void this.appConfig
            .read()
            .then((cfg) =>
              this.automations.fire('CERTIFICATE_ISSUED', {
                email: user.email,
                vars: { firstName, brand: cfg.title, className: level.name },
              }),
            )
            .catch((err) =>
              this.logger.warn(
                `[certificate] CERTIFICATE_ISSUED automation failed: ${
                  err instanceof Error ? err.message : err
                }`,
              ),
            );
        }
        return this.toMyDTO(row);
      } catch (err) {
        await fs.promises.unlink(absPath).catch(() => undefined);
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const target = (err.meta?.target as string[] | undefined) ?? [];
          if (target.includes('serial')) continue; // regenerate and retry
          // (userId, levelId) race — another request won; return its row.
          const winner = await this.prisma.certificate.findUnique({
            where: { userId_levelId: { userId, levelId: level.id } },
          });
          if (winner) return this.toMyDTO(winner);
        }
        throw err;
      }
    }
    throw new ConflictException('Could not allocate a certificate serial — try again');
  }

  // pdf bytes for a template row + values; artwork is re-read from the media
  // store every render (immutable once written; missing file -> 409).
  private async renderForTemplate(
    template: { artworkUrl: string; imageWidth: number; imageHeight: number; fields: unknown },
    values: Partial<Record<CertificateFieldKind, string>>,
  ): Promise<Buffer> {
    const prefix = `${MEDIA_ROUTE}/`;
    if (!template.artworkUrl.startsWith(prefix)) {
      throw new ConflictException('Certificate template artwork is invalid');
    }
    const key = template.artworkUrl.slice(prefix.length);
    if (!/^[A-Za-z0-9._-]+$/.test(key)) {
      throw new ConflictException('Certificate template artwork is invalid');
    }
    let artwork: Buffer;
    try {
      artwork = await fs.promises.readFile(path.join(MEDIA_ROOT, key));
    } catch {
      throw new ConflictException('Certificate template artwork file is missing');
    }
    try {
      return await renderCertificatePdf({
        artwork,
        imageWidth: template.imageWidth,
        imageHeight: template.imageHeight,
        fields: (Array.isArray(template.fields)
          ? template.fields
          : []) as unknown as CertificateFieldLayout[],
        values,
      });
    } catch (err) {
      this.logger.error(`certificate render failed: ${(err as Error).message}`);
      throw new ConflictException('Certificate could not be rendered');
    }
  }

  // ---------- member reads ----------

  private toMyDTO(row: CertRow): MyCertificateDTO {
    return {
      id: row.id,
      serial: row.serial,
      levelId: row.levelId,
      className: row.className,
      memberName: row.memberName,
      issuedAt: row.issuedAt.toISOString(),
      downloadUrl: `/certificates/${row.id}/download`,
    };
  }

  async mine(userId: string): Promise<MyCertificateDTO[]> {
    const rows = await this.prisma.certificate.findMany({
      where: { userId },
      orderBy: { issuedAt: 'desc' },
    });
    return rows.map((r) => this.toMyDTO(r));
  }

  // Owner or admin; 404 (not 403) for foreign ids so the route isn't an
  // existence oracle. Same contract as lesson-note downloads.
  async getDownloadableFile(
    certificateId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<{ absPath: string; filename: string }> {
    const row = await this.prisma.certificate.findUnique({ where: { id: certificateId } });
    if (!row || (row.userId !== principal.sub && !principal.isAdmin)) {
      throw new NotFoundException('Certificate not found');
    }
    const absPath = path.join(CERT_FILES_DIR, row.fileKey);
    if (!fs.existsSync(absPath)) {
      throw new NotFoundException('File missing on server');
    }
    return { absPath, filename: `Certificate - ${row.className}.pdf` };
  }

  // ---------- public verify ----------

  async verify(serial: string): Promise<CertificateVerifyDTO> {
    const row = await this.prisma.certificate.findUnique({
      where: { serial: serial.trim().toUpperCase() },
    });
    if (!row) return { valid: false };
    return {
      valid: true,
      memberName: row.memberName,
      className: row.className,
      issuedAt: row.issuedAt.toISOString(),
    };
  }

  // ---------- admin ----------

  async adminList(q?: string, page = 1, pageSize = 20): Promise<AdminCertificateListDTO> {
    const take = Math.min(100, Math.max(1, pageSize));
    const skip = (Math.max(1, page) - 1) * take;
    const where: Prisma.CertificateWhereInput = q?.trim()
      ? {
          OR: [
            { serial: { contains: q.trim(), mode: 'insensitive' } },
            { memberName: { contains: q.trim(), mode: 'insensitive' } },
            { className: { contains: q.trim(), mode: 'insensitive' } },
            { user: { email: { contains: q.trim(), mode: 'insensitive' } } },
          ],
        }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.certificate.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        skip,
        take,
        include: {
          user: { select: { email: true } },
          template: { select: { name: true } },
        },
      }),
      this.prisma.certificate.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        serial: r.serial,
        memberName: r.memberName,
        memberEmail: r.user.email,
        className: r.className,
        templateName: r.template?.name ?? null,
        issuedAt: r.issuedAt.toISOString(),
      })),
      total,
      page: Math.max(1, page),
      pageSize: take,
    };
  }

  // Revoke: remove the row AND the rendered file (the public verify link dies
  // with it). Used by admins and the BDD cleanup hook.
  async adminRemove(id: string): Promise<{ ok: true }> {
    const row = await this.prisma.certificate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Certificate not found');
    await this.prisma.certificate.delete({ where: { id } });
    await fs.promises
      .unlink(path.join(CERT_FILES_DIR, row.fileKey))
      .catch(() => undefined);
    return { ok: true };
  }

  // Best-effort PDF cleanup before a Level delete cascades its certificates.
  async unlinkFilesForLevel(levelId: string): Promise<void> {
    const rows = await this.prisma.certificate.findMany({
      where: { levelId },
      select: { fileKey: true },
    });
    await Promise.all(
      rows.map((r) =>
        fs.promises.unlink(path.join(CERT_FILES_DIR, r.fileKey)).catch(() => undefined),
      ),
    );
  }
}
