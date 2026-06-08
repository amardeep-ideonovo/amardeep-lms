import { Injectable } from '@nestjs/common';
import type {
  AdminSearchGroup,
  AdminSearchResponse,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { CouponsService } from '../coupons/coupons.service';
import type { AuthenticatedPrincipal } from '../auth/jwt-payload.interface';

// Per-type result cap in the dropdown. Small on purpose — the topbar shows a
// quick preview, not an exhaustive list.
const TAKE = 5;
const MIN_LEN = 2;

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coupons: CouponsService,
  ) {}

  /**
   * Global admin search across the entities the requesting admin may READ.
   * Super admins see everything; permission-scoped admins only get groups for
   * sections they have `read` on (so search never leaks records they couldn't
   * otherwise open). Each entity type is queried in parallel and capped.
   */
  async search(
    principal: AuthenticatedPrincipal,
    qRaw: string,
  ): Promise<AdminSearchResponse> {
    const q = (qRaw || '').trim();
    if (q.length < MIN_LEN) return { query: q, groups: [] };

    const isSuper = principal.role === 'SUPER_ADMIN';
    const perms = principal.permissions ?? {};
    const can = (section: string): boolean =>
      isSuper || (perms as Record<string, { read?: boolean }>)[section]?.read === true;

    // Case-insensitive "contains" filter reused across string fields.
    const like = { contains: q, mode: 'insensitive' as const };

    const tasks: Promise<AdminSearchGroup | null>[] = [];

    if (can('members')) {
      tasks.push(
        this.prisma.user
          .findMany({
            where: {
              OR: [
                { email: like },
                { firstName: like },
                { lastName: like },
                { username: like },
              ],
            },
            take: TAKE,
            orderBy: { createdAt: 'desc' },
            select: { id: true, email: true, firstName: true, lastName: true },
          })
          .then((rows) =>
            rows.length
              ? {
                  type: 'member' as const,
                  label: 'Members',
                  items: rows.map((u) => ({
                    type: 'member' as const,
                    id: u.id,
                    title:
                      [u.firstName, u.lastName].filter(Boolean).join(' ') ||
                      u.email,
                    subtitle: u.email,
                    href: `/members/${u.id}`,
                  })),
                }
              : null,
          ),
      );
    }

    if (can('classes')) {
      tasks.push(
        this.prisma.level
          .findMany({
            where: { name: like },
            take: TAKE,
            orderBy: { createdAt: 'desc' },
            select: { id: true, name: true },
          })
          .then((rows) =>
            rows.length
              ? {
                  type: 'class' as const,
                  label: 'Classes',
                  items: rows.map((l) => ({
                    type: 'class' as const,
                    id: l.id,
                    title: l.name,
                    subtitle: 'Class',
                    href: '/classes',
                  })),
                }
              : null,
          ),
      );
    }

    if (can('courses')) {
      tasks.push(
        this.prisma.course
          .findMany({
            where: { title: like },
            take: TAKE,
            orderBy: { order: 'asc' },
            select: { id: true, title: true },
          })
          .then((rows) =>
            rows.length
              ? {
                  type: 'course' as const,
                  label: 'Courses',
                  items: rows.map((c) => ({
                    type: 'course' as const,
                    id: c.id,
                    title: c.title,
                    subtitle: 'Course',
                    href: '/courses',
                  })),
                }
              : null,
          ),
      );
    }

    if (can('blog')) {
      tasks.push(
        this.prisma.post
          .findMany({
            where: { OR: [{ title: like }, { slug: like }] },
            take: TAKE,
            orderBy: { createdAt: 'desc' },
            select: { id: true, title: true },
          })
          .then((rows) =>
            rows.length
              ? {
                  type: 'blog' as const,
                  label: 'Blog posts',
                  items: rows.map((p) => ({
                    type: 'blog' as const,
                    id: p.id,
                    title: p.title,
                    subtitle: 'Blog post',
                    href: '/blog',
                  })),
                }
              : null,
          ),
      );
    }

    if (can('pages')) {
      tasks.push(
        this.prisma.page
          .findMany({
            where: { OR: [{ title: like }, { slug: like }] },
            take: TAKE,
            orderBy: { updatedAt: 'desc' },
            select: { id: true, title: true, slug: true },
          })
          .then((rows) =>
            rows.length
              ? {
                  type: 'page' as const,
                  label: 'Pages',
                  items: rows.map((p) => ({
                    type: 'page' as const,
                    id: p.id,
                    title: p.title,
                    subtitle: `/${p.slug}`,
                    href: `/pages/${p.id}/edit`,
                  })),
                }
              : null,
          ),
      );
    }

    if (can('popups')) {
      tasks.push(
        this.prisma.popup
          .findMany({
            where: { name: like },
            take: TAKE,
            orderBy: { createdAt: 'desc' },
            select: { id: true, name: true },
          })
          .then((rows) =>
            rows.length
              ? {
                  type: 'popup' as const,
                  label: 'Popups',
                  items: rows.map((p) => ({
                    type: 'popup' as const,
                    id: p.id,
                    title: p.name,
                    subtitle: 'Popup',
                    href: `/popups/${p.id}/edit`,
                  })),
                }
              : null,
          ),
      );
    }

    if (can('forms')) {
      tasks.push(
        this.prisma.form
          .findMany({
            where: { name: like },
            take: TAKE,
            orderBy: { createdAt: 'desc' },
            select: { id: true, name: true },
          })
          .then((rows) =>
            rows.length
              ? {
                  type: 'form' as const,
                  label: 'Forms',
                  items: rows.map((f) => ({
                    type: 'form' as const,
                    id: f.id,
                    title: f.name,
                    subtitle: 'Form',
                    href: '/forms',
                  })),
                }
              : null,
          ),
      );
    }

    if (can('gallery')) {
      tasks.push(
        this.prisma.mediaAsset
          .findMany({
            where: {
              OR: [
                { originalName: like },
                { title: like },
                { altText: like },
                { caption: like },
              ],
            },
            take: TAKE,
            orderBy: { createdAt: 'desc' },
            select: { id: true, originalName: true, title: true },
          })
          .then((rows) =>
            rows.length
              ? {
                  type: 'media' as const,
                  label: 'Gallery',
                  items: rows.map((m) => ({
                    type: 'media' as const,
                    id: m.id,
                    title: m.title || m.originalName,
                    subtitle: 'Media',
                    href: '/gallery',
                  })),
                }
              : null,
          ),
      );
    }

    // Coupons live in Stripe (no DB table) — reuse CouponsService and filter in
    // memory. Tolerate Stripe hiccups: a failure just omits the coupons group
    // rather than failing the whole search.
    if (can('coupons')) {
      const ql = q.toLowerCase();
      tasks.push(
        this.coupons
          .list()
          .then((list) => {
            const items = list
              .filter(
                (c) =>
                  c.code.toLowerCase().includes(ql) ||
                  (c.levelName ?? '').toLowerCase().includes(ql),
              )
              .slice(0, TAKE)
              .map((c) => ({
                type: 'coupon' as const,
                id: c.id,
                title: c.code,
                subtitle: c.levelName ? `Coupon · ${c.levelName}` : 'Coupon',
                href: '/coupons',
              }));
            return items.length
              ? { type: 'coupon' as const, label: 'Coupons', items }
              : null;
          })
          .catch(() => null),
      );
    }

    const groups = (await Promise.all(tasks)).filter(
      (g): g is AdminSearchGroup => g !== null,
    );
    return { query: q, groups };
  }
}
