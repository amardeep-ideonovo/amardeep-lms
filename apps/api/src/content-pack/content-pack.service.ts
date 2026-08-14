 
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { MEDIA_ROOT, resolveMediaExt, isSvg, sanitizeSvg } from '../media/media.config';
import { IMAGES_ROOT, imageExt } from '../blog/upload.config';
import { LESSON_NOTES_DIR, noteFileExt } from '../lms/upload.config';
import {
  deserializePack,
  isSafeRelPath,
  normalizeOrigin,
  normalizeRowForImport,
  rewriteRowOrigin,
  scrubFooterAudience,
  serializePack,
  PACK_FORMAT,
  PACK_FORMAT_VERSION,
} from './content-pack.transform';
import type {
  ContentPack,
  ImportResult,
  PackContent,
  PackFile,
  PackFileStore,
  PackRow,
  PackStatus,
} from './content-pack.types';

// The single row that records an imported pack (see the ContentPackState model).
const STATE_ID = 'singleton';

// Refuse to build a pack whose file payloads exceed this — the whole archive is
// held in memory (base64 in JSON). Demo content is single-digit MB; a much
// larger figure means someone uploaded raw video into the demo, which belongs on
// Vimeo/YouTube. Failing loudly beats an OOM.
const EXPORT_MAX_FILE_BYTES = 128 * 1024 * 1024;

// The three on-disk stores an operator-authored pack draws from. Rendered
// certificate PDFs (CERT_FILES_DIR) and bundled fonts are intentionally absent.
const STORE_ROOTS: Record<PackFileStore, string> = {
  media: MEDIA_ROOT,
  images: IMAGES_ROOT,
  'lesson-notes': LESSON_NOTES_DIR,
};

// Capture the key/path a URL points at within a store, stopping at the first
// delimiter or query/hash. Used to discover which files the exported content
// actually references (so we ship those and NOT, say, member avatar files that
// also live under MEDIA_ROOT).
const MEDIA_REF = /\/media\/([^"'\\\s)<>?#]+)/g;
const IMAGES_REF = /\/images\/([^"'\\\s)<>?#]+)/g;

@Injectable()
export class ContentPackService {
  private readonly log = new Logger('ContentPack');

  constructor(private readonly prisma: PrismaService) {}

  // ---------- status ----------

  async status(): Promise<PackStatus> {
    const row = await this.prisma.contentPackState.findUnique({
      where: { id: STATE_ID },
    });
    return {
      imported: !!row,
      packVersion: row?.packVersion ?? null,
      packLabel: row?.packLabel ?? null,
      sourceOrigin: row?.sourceOrigin ?? null,
      importedAt: row?.importedAt?.toISOString() ?? null,
    };
  }

  // ---------- export ----------

  async export(): Promise<Buffer> {
    const content = await this.gatherContent();
    const files = this.gatherFiles(content);

    const manifest = {
      format: PACK_FORMAT,
      formatVersion: PACK_FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      sourceOrigin: normalizeOrigin(process.env.PUBLIC_API_URL),
      imageTag: process.env.APP_VERSION ?? null,
      counts: {
        levels: content.levels.length,
        courses: content.courses.length,
        lessons: content.lessons.length,
        pages: content.pages.length,
        posts: content.posts.length,
        popups: content.popups.length,
        mediaAssets: content.mediaAssets.length,
        files: files.length,
      },
    };

    const pack: ContentPack = { manifest, content, files };
    const buf = serializePack(pack);
    this.log.log(
      `exported content pack: ${manifest.counts.levels} classes, ` +
        `${manifest.counts.courses} courses, ${manifest.counts.lessons} lessons, ` +
        `${files.length} files — ${(buf.length / 1024).toFixed(0)}KB gzipped`,
    );
    return buf;
  }

  private async gatherContent(): Promise<PackContent> {
    const [
      levelCategories,
      certificateTemplates,
      courses,
      levelsRaw,
      prices,
      courseLevels,
      lessons,
      lessonNotes,
      mediaAssets,
      menus,
      menuLocationAssignments,
      menuItems,
      postCategories,
      postsRaw,
      pages,
      forms,
      popups,
      headers,
      footer,
      appConfig,
    ] = await Promise.all([
      this.prisma.levelCategory.findMany(),
      this.prisma.certificateTemplate.findMany(),
      this.prisma.course.findMany(),
      this.prisma.level.findMany({
        include: { categories: { select: { id: true } } },
      }),
      this.prisma.price.findMany(),
      this.prisma.courseLevel.findMany(),
      this.prisma.lesson.findMany(),
      this.prisma.lessonNote.findMany(),
      this.prisma.mediaAsset.findMany(),
      this.prisma.menu.findMany(),
      this.prisma.menuLocationAssignment.findMany(),
      this.prisma.menuItem.findMany(),
      this.prisma.postCategory.findMany(),
      this.prisma.post.findMany({
        include: { categories: { select: { id: true } } },
      }),
      this.prisma.page.findMany(),
      this.prisma.form.findMany(),
      this.prisma.popup.findMany(),
      this.prisma.header.findMany(),
      this.prisma.footer.findUnique({ where: { id: 'singleton' } }),
      this.prisma.appConfig.findUnique({ where: { id: 'singleton' } }),
    ]);

    // Flatten the implicit many-to-many into a plain id array so the pack rows
    // stay scalar (createMany can't set relations; import reconnects these).
    const levels = (levelsRaw as any[]).map(({ categories, ...rest }) => ({
      ...rest,
      categoryIds: (categories as Array<{ id: string }>).map((c) => c.id),
    }));
    const posts = (postsRaw as any[]).map(({ categories, ...rest }) => ({
      ...rest,
      categoryIds: (categories as Array<{ id: string }>).map((c) => c.id),
    }));

    return {
      levelCategories,
      certificateTemplates,
      courses,
      levels,
      prices,
      courseLevels,
      lessons,
      lessonNotes,
      mediaAssets,
      menus,
      menuLocationAssignments,
      menuItems,
      postCategories,
      posts,
      pages,
      forms,
      popups,
      headers,
      footer: footer ?? null,
      appConfig: appConfig ?? null,
    };
  }

  // Ship ONLY files the exported content references. Sweeping the raw store dirs
  // would also pick up member/admin avatar files — which live under MEDIA_ROOT
  // with no MediaAsset row (see auth.service.ts) and are tenant PII. So the set
  // of files is derived from the content itself: MediaAsset keys + every
  // /media|/images URL embedded in any row, plus LessonNote filenames.
  private gatherFiles(content: PackContent): PackFile[] {
    const wanted = referencedFilePaths(content);
    const files: PackFile[] = [];
    let totalBytes = 0;

    for (const store of Object.keys(STORE_ROOTS) as PackFileStore[]) {
      const root = STORE_ROOTS[store];
      const want = wanted[store];
      for (const abs of walkFiles(root)) {
        const rel = path.relative(root, abs).split(path.sep).join('/');
        if (!want.has(rel)) continue; // unreferenced (avatars, orphans) — skip
        const buf = fs.readFileSync(abs);
        totalBytes += buf.length;
        if (totalBytes > EXPORT_MAX_FILE_BYTES) {
          throw new ConflictException(
            `content pack files exceed ${(EXPORT_MAX_FILE_BYTES / 1024 / 1024) | 0}MB — ` +
              `trim large uploads (host videos on Vimeo/YouTube) before publishing`,
          );
        }
        files.push({ store, relpath: rel, b64: buf.toString('base64') });
      }
    }
    return files;
  }

  // ---------- import ----------

  async import(
    gz: Buffer,
    opts: { version?: number; label?: string | null } = {},
  ): Promise<ImportResult> {
    const pack = deserializePack(gz);

    // Idempotent: a pack already landed → this is a retried push, report success
    // without touching anything.
    const existing = await this.prisma.contentPackState.findUnique({
      where: { id: STATE_ID },
    });
    if (existing) {
      this.log.log(`import skipped — pack v${existing.packVersion} already imported`);
      return {
        imported: false,
        alreadyImported: true,
        packVersion: existing.packVersion,
        counts: {},
      };
    }

    // Only seed an EMPTY instance. Never overwrite content a client already has —
    // this endpoint is a provisioning-time seed, not a sync.
    await this.assertEmpty();

    const from = normalizeOrigin(pack.manifest.sourceOrigin);
    const to = normalizeOrigin(process.env.PUBLIC_API_URL);
    const ownerAdminId = await this.resolveOwnerAdminId();

    // Files first: idempotent overwrite by key, so a retry after a failed DB
    // transaction simply rewrites them. Path-confined + type-checked per store.
    this.writeFiles(pack.files);

    let counts: Record<string, number>;
    try {
      counts = await this.insertContent(pack.content, from, to, ownerAdminId, {
        version: opts.version ?? 0,
        label: opts.label ?? null,
        sourceOrigin: from || null,
      });
    } catch (e) {
      // A concurrent import can win the race: its transaction commits content +
      // marker while ours rolls back atomically on a unique-key collision. Report
      // the idempotent result rather than a 500. (The CP pushes serially, so this
      // is a belt-and-suspenders path.)
      if (isUniqueViolation(e)) {
        const now = await this.prisma.contentPackState.findUnique({ where: { id: STATE_ID } });
        if (now) {
          return {
            imported: false,
            alreadyImported: true,
            packVersion: now.packVersion,
            counts: {},
          };
        }
      }
      throw e;
    }

    this.log.log(
      `imported content pack${opts.version ? ` v${opts.version}` : ''}: ` +
        Object.entries(counts)
          .map(([k, v]) => `${v} ${k}`)
          .join(', '),
    );
    return { imported: true, alreadyImported: false, packVersion: opts.version ?? 0, counts };
  }

  private async assertEmpty(): Promise<void> {
    const counts = await Promise.all([
      this.prisma.level.count(),
      this.prisma.course.count(),
      this.prisma.page.count(),
      this.prisma.post.count(),
      this.prisma.menu.count(),
      this.prisma.mediaAsset.count(),
      this.prisma.header.count(),
      this.prisma.popup.count(),
      this.prisma.form.count(),
      this.prisma.certificateTemplate.count(),
      // Singletons the import upserts (overwrites) — count them too, so a client
      // who customized ONLY their footer/branding isn't silently clobbered.
      this.prisma.footer.count(),
      this.prisma.appConfig.count(),
    ]);
    if (counts.reduce((a, b) => a + b, 0) > 0) {
      throw new ConflictException(
        'instance already has content — refusing to import a content pack over it',
      );
    }
  }

  // The earliest SUPER_ADMIN (the one seeded at provisioning) owns imported
  // authored content — mirrors AdminsService.setOwnerPasswordFromControlPlane.
  private async resolveOwnerAdminId(): Promise<string | null> {
    const owner = await this.prisma.admin.findFirst({
      where: { role: 'SUPER_ADMIN' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return owner?.id ?? null;
  }

  private writeFiles(files: PackFile[]): void {
    for (const f of files) {
      const root = STORE_ROOTS[f.store];
      if (!root) {
        this.log.warn(`skipping file with unknown store "${f.store}"`);
        continue;
      }
      if (!isSafeRelPath(f.relpath)) {
        this.log.warn(`skipping unsafe file path "${f.relpath}"`);
        continue;
      }
      const abs = path.resolve(root, f.relpath);
      if (abs !== root && !abs.startsWith(root + path.sep)) {
        this.log.warn(`skipping file escaping its store: "${f.relpath}"`);
        continue;
      }
      // Re-apply the upload path's type allow-list. Import bytes bypass the
      // multer validators, and /media + /images are served publicly, so a
      // disallowed type (script/markup/exe) must never be written from a pack.
      const ext = validateFileExt(f.store, f.relpath);
      if (ext === null) {
        this.log.warn(`skipping disallowed file type "${f.relpath}"`);
        continue;
      }
      let bytes = Buffer.from(f.b64, 'base64');
      // SVGs are served publicly and can carry script — sanitize like the upload
      // path does (defense in depth alongside the /media nosniff header).
      if (f.store === 'media' && isSvg('', ext)) {
        bytes = Buffer.from(sanitizeSvg(bytes.toString('utf8')), 'utf8');
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, bytes);
    }
  }

  private async insertContent(
    content: PackContent,
    from: string,
    to: string,
    ownerAdminId: string | null,
    marker: { version: number; label: string | null; sourceOrigin: string | null },
  ): Promise<Record<string, number>> {
    // rewrite the demo origin, then apply the per-model scrub/remap/reset rules.
    const norm = (model: string, rows: PackRow[]): PackRow[] =>
      rows.map((r) =>
        normalizeRowForImport(model, rewriteRowOrigin(r, from, to), ownerAdminId),
      );

    const levelCategories = norm('levelCategory', content.levelCategories);
    const certificateTemplates = norm('certificateTemplate', content.certificateTemplates);
    const courses = norm('course', content.courses);

    // Levels carry categoryIds for the implicit m2m — pull it out for a 2nd pass.
    const levels = norm('level', content.levels);
    const levelCats = levels.map((l) => ({ id: l.id, categoryIds: (l.categoryIds ?? []) as string[] }));
    levels.forEach((l) => delete l.categoryIds);

    const prices = norm('price', content.prices);
    const courseLevels = norm('courseLevel', content.courseLevels);
    const lessons = norm('lesson', content.lessons);
    const lessonNotes = norm('lessonNote', content.lessonNotes);
    const mediaAssets = norm('mediaAsset', content.mediaAssets);
    const menus = norm('menu', content.menus);
    const menuLocs = norm('menuLocationAssignment', content.menuLocationAssignments);

    // Menu items self-reference via parentId; insert with parentId cleared, then
    // re-link — avoids ordering a non-deferrable self-FK inside one createMany.
    const menuItems = norm('menuItem', content.menuItems);
    const menuLinks = menuItems
      .filter((m) => m.parentId)
      .map((m) => ({ id: m.id as string, parentId: m.parentId as string }));
    menuItems.forEach((m) => (m.parentId = null));

    const postCategories = norm('postCategory', content.postCategories);
    const posts = norm('post', content.posts);
    const postCats = posts.map((p) => ({ id: p.id, categoryIds: (p.categoryIds ?? []) as string[] }));
    posts.forEach((p) => delete p.categoryIds);

    const pages = norm('page', content.pages);
    const forms = norm('form', content.forms);
    const popups = norm('popup', content.popups);
    const headers = norm('header', content.headers);

    const footer = content.footer
      ? normalizeRowForImport('footer', rewriteRowOrigin(content.footer, from, to), ownerAdminId)
      : null;
    if (footer) footer.config = scrubFooterAudience(footer.config);
    const appConfig = content.appConfig
      ? normalizeRowForImport('appConfig', rewriteRowOrigin(content.appConfig, from, to), ownerAdminId)
      : null;

    await this.prisma.$transaction(
      async (tx) => {
        // Parents before children, so every FK resolves as it is written.
        await createMany(tx.levelCategory, levelCategories);
        await createMany(tx.certificateTemplate, certificateTemplates);
        await createMany(tx.course, courses); // before Level (Level.featuredCourseId)
        await createMany(tx.level, levels); // after Course + CertificateTemplate
        for (const { id, categoryIds } of levelCats) {
          if (categoryIds.length) {
            await tx.level.update({
              where: { id },
              data: { categories: { connect: categoryIds.map((cid) => ({ id: cid })) } },
            });
          }
        }
        await createMany(tx.price, prices);
        await createMany(tx.courseLevel, courseLevels);
        await createMany(tx.lesson, lessons);
        await createMany(tx.lessonNote, lessonNotes);
        await createMany(tx.mediaAsset, mediaAssets);
        await createMany(tx.menu, menus);
        await createMany(tx.menuLocationAssignment, menuLocs);
        await createMany(tx.menuItem, menuItems);
        for (const { id, parentId } of menuLinks) {
          await tx.menuItem.update({ where: { id }, data: { parentId } });
        }
        await createMany(tx.postCategory, postCategories);
        await createMany(tx.post, posts);
        for (const { id, categoryIds } of postCats) {
          if (categoryIds.length) {
            await tx.post.update({
              where: { id },
              data: { categories: { connect: categoryIds.map((cid) => ({ id: cid })) } },
            });
          }
        }
        await createMany(tx.page, pages);
        await createMany(tx.form, forms);
        await createMany(tx.popup, popups);
        await createMany(tx.header, headers);
        if (footer) {
          const cfg = jsonOrNull(footer.config);
          await tx.footer.upsert({
            where: { id: 'singleton' },
            update: { config: cfg },
            create: { id: 'singleton', config: cfg },
          });
        }
        if (appConfig) {
          const cfg = jsonOrNull(appConfig.config);
          await tx.appConfig.upsert({
            where: { id: 'singleton' },
            update: { config: cfg },
            create: { id: 'singleton', config: cfg },
          });
        }
        // The marker lands INSIDE the transaction: content + marker commit
        // atomically, so a crash can never leave imported content that the
        // status endpoint reports as un-imported (and that re-import refuses).
        await tx.contentPackState.create({
          data: {
            id: STATE_ID,
            packVersion: marker.version,
            packLabel: marker.label,
            sourceOrigin: marker.sourceOrigin,
          },
        });
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    return {
      classes: levels.length,
      courses: courses.length,
      lessons: lessons.length,
      pages: pages.length,
      posts: posts.length,
      popups: popups.length,
      menus: menus.length,
      mediaAssets: mediaAssets.length,
    };
  }
}

// Which files the exported content actually points at, per store. Over-inclusion
// is harmless (a phantom key just isn't found on disk); under-inclusion is what
// we guard against, so MediaAsset keys and LessonNote filenames are added
// explicitly on top of the URL scan.
function referencedFilePaths(
  content: PackContent,
): Record<PackFileStore, Set<string>> {
  const blob = JSON.stringify(content);
  const media = collectRefs(blob, MEDIA_REF);
  for (const m of content.mediaAssets) if (m.key) media.add(m.key as string);
  const images = collectRefs(blob, IMAGES_REF);
  const notes = new Set<string>();
  for (const n of content.lessonNotes) if (n.filename) notes.add(n.filename as string);
  return { media, images, 'lesson-notes': notes };
}

function collectRefs(blob: string, re: RegExp): Set<string> {
  const out = new Set<string>();
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob)) !== null) out.add(m[1]);
  return out;
}

// A Json? column: a genuine null must be written as the Prisma.JsonNull sentinel,
// not JS null (which Prisma 5 rejects with a validation error). Anything else is
// a normal JSON value.
function jsonOrNull(v: unknown): Prisma.InputJsonValue {
  return (v == null ? Prisma.JsonNull : v) as Prisma.InputJsonValue;
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

// The upload path's per-store type allow-list, re-applied on import.
function validateFileExt(store: PackFileStore, relpath: string): string | null {
  switch (store) {
    case 'media':
      return resolveMediaExt(relpath, '');
    case 'images':
      return imageExt('', relpath);
    case 'lesson-notes':
      return noteFileExt('', relpath);
    default:
      return null;
  }
}

// Recursively list absolute paths of every regular file under `root`, skipping
// dot-files. Returns [] when the directory is absent.
function walkFiles(root: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out; // missing store dir — nothing to ship
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(root, e.name);
    if (e.isDirectory()) out.push(...walkFiles(abs));
    else if (e.isFile()) out.push(abs);
  }
  return out;
}

// Thin wrapper so the insert order reads cleanly. Rows are dynamic (built from
// the pack), so the delegate + data are intentionally loosely typed here.
async function createMany(
  delegate: { createMany: (args: { data: any[] }) => Promise<unknown> },
  rows: PackRow[],
): Promise<void> {
  if (rows.length) await delegate.createMany({ data: rows });
}
