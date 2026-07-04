import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  HeaderAudience,
  HeaderConditions,
  HeaderConfig,
  HeaderCta,
  HeaderDTO,
  HeaderPageMode,
  HeaderSection,
  HeaderSummary,
  MenuItemType,
  ResolvedHeader,
  ResolvedHeaderCta,
  UpdateHeaderInput,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildHrefMaps,
  resolveHref,
  type HrefTarget,
} from '../menus/menu-href.util';

// Canonical value sets (the API consumes @lms/types as TYPES only).
const LAYOUTS = ['TWO_COL', 'THREE_COL'] as const;
const WIDTHS = ['BOXED', 'FULL'] as const;
const ITEM_TYPES = [
  'PAGE',
  'CLASS',
  'CLASS_INDEX',
  'COURSE',
  'COURSE_INDEX',
  'BLOG_INDEX',
  'BLOG_POST',
  'ROUTE',
  'CUSTOM',
] as const;
const AUDIENCES = ['ALL', 'AUTHED', 'GUEST', 'LEVEL'] as const;
const SECTIONS = [
  'HOME',
  'DASHBOARD',
  'BLOG',
  'PRICING',
  'CLASSES',
  'COURSES',
] as const;
const PAGE_MODES = ['ALL', 'INCLUDE'] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;

// Top-level web path segments that are NOT CMS pages (so `/{slug}` only maps to
// a CMS page when the first segment isn't one of these). Mirrors apps/web/app/*.
const RESERVED_SEGMENTS = new Set([
  'account',
  'blog',
  'checkout',
  'classes',
  'courses',
  'dashboard',
  'forms',
  'lessons',
  'login',
  'pricing',
  'signup',
]);

// Defaults equal the pre-feature header look, so an unconfigured (or partial)
// config renders identically to before this feature.
const DEFAULT_HEADER: HeaderConfig = {
  layout: 'TWO_COL',
  width: 'BOXED',
  maxWidth: 1080,
  bgColor: '#ffffff',
  paddingX: 24,
  paddingY: 0,
  logoUrl: null,
  menuId: null,
  linkColor: '#475569',
  menuActiveColor: '#4f46e5',
  ctas: [],
};

const DEFAULT_CONDITIONS: HeaderConditions = {
  audience: 'ALL',
  audienceLevelId: null,
  pageMode: 'ALL',
  includePageIds: [],
  includeSections: [],
  excludePageIds: [],
  excludeSections: [],
};

@Injectable()
export class SiteService {
  constructor(private readonly prisma: PrismaService) {}

  // --- sanitizers (also re-applied on read, so a hand-edited row can't inject
  // bad CSS values that would reach the browser) ---
  private clampInt(v: unknown, min: number, max: number, fb: number): number {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fb;
    return Math.min(max, Math.max(min, n));
  }
  private color(v: unknown, fb: string): string {
    return typeof v === 'string' && HEX.test(v) ? v : fb;
  }
  private str(v: unknown, max: number): string | null {
    return typeof v === 'string' && v ? v.slice(0, max) : null;
  }
  private idArray(v: unknown): string[] {
    return Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === 'string' && !!x)
          .map((x) => x.slice(0, 80))
          .slice(0, 200)
      : [];
  }
  private sectionArray(v: unknown): HeaderSection[] {
    return Array.isArray(v)
      ? (v.filter((s) =>
          (SECTIONS as readonly string[]).includes(s as string),
        ) as HeaderSection[])
      : [];
  }

  private sanitizeCta(raw: any): HeaderCta | null {
    if (!raw || typeof raw !== 'object') return null;
    const link = raw.link ?? {};
    const type = (ITEM_TYPES as readonly string[]).includes(link.type)
      ? (link.type as MenuItemType)
      : null;
    const id = this.str(raw.id, 80);
    if (!type || !id) return null;
    return {
      id,
      label: typeof raw.label === 'string' ? raw.label.slice(0, 120) : '',
      bgColor: this.color(raw.bgColor, '#4f46e5'),
      textColor: this.color(raw.textColor, '#ffffff'),
      paddingX: this.clampInt(raw.paddingX, 0, 200, 16),
      paddingY: this.clampInt(raw.paddingY, 0, 200, 8),
      borderRadius: this.clampInt(raw.borderRadius, 0, 100, 8),
      link: {
        type,
        url: this.str(link.url, 2000),
        pageId: this.str(link.pageId, 80),
        levelId: this.str(link.levelId, 80),
        courseId: this.str(link.courseId, 80),
        postId: this.str(link.postId, 80),
        openNewTab: !!link.openNewTab,
      },
    };
  }

  private sanitizeConfig(raw: any): HeaderConfig {
    const r = raw && typeof raw === 'object' ? raw : {};
    const layout = (LAYOUTS as readonly string[]).includes(r.layout)
      ? (r.layout as HeaderConfig['layout'])
      : DEFAULT_HEADER.layout;
    const width = (WIDTHS as readonly string[]).includes(r.width)
      ? (r.width as HeaderConfig['width'])
      : DEFAULT_HEADER.width;
    const ctas = Array.isArray(r.ctas)
      ? r.ctas
          .map((c: unknown) => this.sanitizeCta(c))
          .filter((c: HeaderCta | null): c is HeaderCta => c !== null)
      : [];
    return {
      layout,
      width,
      maxWidth:
        r.maxWidth == null
          ? DEFAULT_HEADER.maxWidth
          : this.clampInt(r.maxWidth, 320, 4000, 1080),
      bgColor: this.color(r.bgColor, DEFAULT_HEADER.bgColor),
      paddingX: this.clampInt(r.paddingX, 0, 200, DEFAULT_HEADER.paddingX),
      paddingY: this.clampInt(r.paddingY, 0, 200, DEFAULT_HEADER.paddingY),
      logoUrl: this.str(r.logoUrl, 2000),
      menuId: this.str(r.menuId, 80),
      linkColor: this.color(r.linkColor, DEFAULT_HEADER.linkColor),
      menuActiveColor:
        r.menuActiveColor == null
          ? DEFAULT_HEADER.menuActiveColor
          : this.color(
              r.menuActiveColor,
              DEFAULT_HEADER.menuActiveColor as string,
            ),
      ctas,
    };
  }

  private sanitizeConditions(raw: any): HeaderConditions {
    const r = raw && typeof raw === 'object' ? raw : {};
    const audience = (AUDIENCES as readonly string[]).includes(r.audience)
      ? (r.audience as HeaderAudience)
      : DEFAULT_CONDITIONS.audience;
    const pageMode = (PAGE_MODES as readonly string[]).includes(r.pageMode)
      ? (r.pageMode as HeaderPageMode)
      : DEFAULT_CONDITIONS.pageMode;
    return {
      audience,
      audienceLevelId: this.str(r.audienceLevelId, 80),
      pageMode,
      includePageIds: this.idArray(r.includePageIds),
      includeSections: this.sectionArray(r.includeSections),
      excludePageIds: this.idArray(r.excludePageIds),
      excludeSections: this.sectionArray(r.excludeSections),
    };
  }

  // ---------- admin CRUD ----------
  private toDTO(row: {
    id: string;
    name: string;
    enabled: boolean;
    priority: number;
    config: Prisma.JsonValue;
    conditions: Prisma.JsonValue;
    updatedAt: Date;
  }): HeaderDTO {
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      priority: row.priority,
      config: this.sanitizeConfig(row.config),
      conditions: this.sanitizeConditions(row.conditions),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listHeaders(): Promise<HeaderSummary[]> {
    const rows = await this.prisma.header.findMany({
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => {
      const c = this.sanitizeConditions(r.conditions);
      return {
        id: r.id,
        name: r.name,
        enabled: r.enabled,
        priority: r.priority,
        audience: c.audience,
        pageMode: c.pageMode,
      };
    });
  }

  async getHeader(id: string): Promise<HeaderDTO> {
    const row = await this.prisma.header.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Header not found');
    return this.toDTO(row);
  }

  async createHeader(name: string): Promise<HeaderDTO> {
    const max = await this.prisma.header.aggregate({ _max: { priority: true } });
    const row = await this.prisma.header.create({
      data: {
        name: (name || 'Untitled header').slice(0, 120),
        config: this.sanitizeConfig({}) as unknown as Prisma.InputJsonValue,
        conditions: this.sanitizeConditions(
          {},
        ) as unknown as Prisma.InputJsonValue,
        priority: (max._max.priority ?? 0) + 1,
        enabled: true,
      },
    });
    return this.toDTO(row);
  }

  async updateHeader(id: string, input: UpdateHeaderInput): Promise<HeaderDTO> {
    const existing = await this.prisma.header.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Header not found');
    const data: Prisma.HeaderUpdateInput = {};
    if (input.name !== undefined)
      data.name = (String(input.name) || 'Untitled header').slice(0, 120);
    if (input.enabled !== undefined) data.enabled = !!input.enabled;
    if (input.config !== undefined)
      data.config = this.sanitizeConfig(
        input.config,
      ) as unknown as Prisma.InputJsonValue;
    if (input.conditions !== undefined)
      data.conditions = this.sanitizeConditions(
        input.conditions,
      ) as unknown as Prisma.InputJsonValue;
    const row = await this.prisma.header.update({ where: { id }, data });
    return this.toDTO(row);
  }

  async deleteHeader(id: string): Promise<{ ok: true }> {
    await this.prisma.header.delete({ where: { id } }).catch(() => undefined);
    return { ok: true };
  }

  async reorderHeaders(ids: string[]): Promise<HeaderSummary[]> {
    const clean = this.idArray(ids);
    const n = clean.length;
    await this.prisma.$transaction(
      clean.map((id, i) =>
        this.prisma.header.update({
          where: { id },
          data: { priority: n - i },
        }),
      ),
    );
    return this.listHeaders();
  }

  // ---------- public matching ----------
  private sectionForPath(path: string): HeaderSection | null {
    const p = (path || '/').split('?')[0].split('#')[0];
    if (p === '/' || p === '') return 'HOME';
    if (p.startsWith('/dashboard')) return 'DASHBOARD';
    if (p.startsWith('/blog')) return 'BLOG';
    if (p.startsWith('/pricing')) return 'PRICING';
    if (p.startsWith('/classes')) return 'CLASSES';
    if (p.startsWith('/courses')) return 'COURSES';
    return null;
  }

  private cmsSlugForPath(path: string): string | null {
    const p = (path || '/').split('?')[0].split('#')[0].replace(/\/+$/, '');
    const segs = p.split('/').filter(Boolean);
    if (segs.length !== 1) return null;
    const slug = segs[0];
    return RESERVED_SEGMENTS.has(slug) ? null : slug;
  }

  private async ownedLevels(userId: string): Promise<Set<string>> {
    const uls = await this.prisma.userLevel.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { levelId: true },
    });
    return new Set(uls.map((u) => u.levelId));
  }

  /** Resolve a config into a render-ready header (CTA hrefs computed). */
  private async resolveConfig(cfg: HeaderConfig): Promise<ResolvedHeader> {
    const links: HrefTarget[] = cfg.ctas.map((c) => c.link);
    const maps = await buildHrefMaps(this.prisma, links);
    const ctas: ResolvedHeaderCta[] = cfg.ctas
      .map((c): ResolvedHeaderCta | null => {
        const href = resolveHref(c.link, maps);
        if (!href) return null;
        return {
          id: c.id,
          label: c.label,
          href,
          newTab: !!c.link.openNewTab,
          bgColor: c.bgColor,
          textColor: c.textColor,
          paddingX: c.paddingX,
          paddingY: c.paddingY,
          borderRadius: c.borderRadius,
        };
      })
      .filter((x): x is ResolvedHeaderCta => x !== null);
    return {
      layout: cfg.layout,
      width: cfg.width,
      maxWidth: cfg.maxWidth ?? null,
      bgColor: cfg.bgColor,
      paddingX: cfg.paddingX,
      paddingY: cfg.paddingY,
      logoUrl: cfg.logoUrl ?? null,
      menuId: cfg.menuId ?? null,
      linkColor: cfg.linkColor,
      menuActiveColor: cfg.menuActiveColor ?? null,
      ctas,
    };
  }

  /** The highest-priority enabled header that applies to the given path + visitor. */
  async matchHeader(
    path: string,
    userId?: string,
  ): Promise<ResolvedHeader | null> {
    const rows = await this.prisma.header.findMany({
      where: { enabled: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    if (rows.length === 0) return null;

    const section = this.sectionForPath(path);
    const slug = section ? null : this.cmsSlugForPath(path);
    let pageId: string | null = null;
    if (slug) {
      const page = await this.prisma.page.findFirst({
        where: { slug },
        select: { id: true },
      });
      pageId = page?.id ?? null;
    }

    const authed = !!userId;
    let owned: Set<string> | null = null;

    for (const row of rows) {
      const c = this.sanitizeConditions(row.conditions);
      // audience
      if (c.audience === 'AUTHED' && !authed) continue;
      if (c.audience === 'GUEST' && authed) continue;
      if (c.audience === 'LEVEL') {
        if (!authed || !c.audienceLevelId) continue;
        if (!owned) owned = await this.ownedLevels(userId as string);
        if (!owned.has(c.audienceLevelId)) continue;
      }
      // page exclude wins over include
      if (section && c.excludeSections.includes(section)) continue;
      if (pageId && c.excludePageIds.includes(pageId)) continue;
      // page include
      if (c.pageMode === 'INCLUDE') {
        const included =
          (!!section && c.includeSections.includes(section)) ||
          (!!pageId && c.includePageIds.includes(pageId));
        if (!included) continue;
      }
      return this.resolveConfig(this.sanitizeConfig(row.config));
    }
    return null;
  }

  /** Site-wide guest default (no path/auth) — used for the SSR initial paint. */
  async guestDefault(): Promise<ResolvedHeader | null> {
    const rows = await this.prisma.header.findMany({
      where: { enabled: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    for (const row of rows) {
      const c = this.sanitizeConditions(row.conditions);
      if (
        (c.audience === 'ALL' || c.audience === 'GUEST') &&
        c.pageMode === 'ALL'
      ) {
        return this.resolveConfig(this.sanitizeConfig(row.config));
      }
    }
    return null;
  }
}
