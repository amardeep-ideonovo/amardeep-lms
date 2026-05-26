import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  PageAdminRow,
  PageAuthorDTO,
  PageListItem,
  PagePublicDTO,
  PageStatus,
  PuckComponentData,
  PuckDocument,
} from '@lms/types';
import type { Prisma } from '@prisma/client';
import sanitizeHtml from 'sanitize-html';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePageDto, UpdatePageDto } from './dto/page.dto';

// Pages render on PUBLIC (logged-out) URLs, so any rich-text HTML embedded in
// the Puck document (the RichText block's `html` prop) is sanitized on write —
// the same defense-in-depth policy used for blog posts. Structural blocks
// render through known React components in @lms/puck, so they need no
// sanitization (their text props are escaped by React at render time).
const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'a', 'ul', 'ol',
    'li', 'b', 'i', 'strong', 'em', 's', 'strike', 'code', 'pre', 'hr', 'br',
    'span', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr',
    'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    '*': ['style'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  transformTags: {
    a: sanitizeHtml.simpleTransform(
      'a',
      { rel: 'noopener noreferrer', target: '_blank' },
      true,
    ),
  },
};

// Slugs that must never resolve to a CMS page because the member web app owns
// these top-level routes. The Next.js catch-all already defers to its static
// routes, but refusing to mint a colliding slug gives the admin a clear error
// instead of a silently-unreachable page.
const RESERVED_SLUGS = new Set([
  'blog', 'courses', 'lessons', 'dashboard', 'account', 'login', 'logout',
  'admin', 'api', 'images', 'health', 'billing', 'pages', '_next',
  'favicon.ico', 'robots.txt', 'sitemap.xml',
]);

const EMPTY_DOC: PuckDocument = { content: [], root: { props: {} } };

// Shape we read back for mapping. Author is narrowed to non-secret fields.
type PageRow = {
  id: string;
  slug: string;
  title: string;
  data: Prisma.JsonValue;
  status: PageStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; email: string } | null;
};

@Injectable()
export class PagesService {
  constructor(private readonly prisma: PrismaService) {}

  // Only ever load non-secret author fields alongside a page.
  private static readonly REL = {
    author: { select: { id: true, email: true } },
  } as const;

  // ---------- public reads ----------

  async listPublished(): Promise<PageListItem[]> {
    const pages = await this.prisma.page.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
      include: PagesService.REL,
    });
    return pages.map((p: PageRow) => this.toListItem(p));
  }

  async getPublishedBySlug(slug: string): Promise<PagePublicDTO> {
    const page = await this.prisma.page.findUnique({
      where: { slug },
      include: PagesService.REL,
    });
    // Drafts and unknown slugs are indistinguishable to the public: both 404.
    if (!page || page.status !== 'PUBLISHED') {
      throw new NotFoundException('Page not found');
    }
    return this.toPublic(page);
  }

  // ---------- admin ----------

  async adminList(): Promise<PageListItem[]> {
    const pages = await this.prisma.page.findMany({
      orderBy: { updatedAt: 'desc' },
      include: PagesService.REL,
    });
    return pages.map((p: PageRow) => this.toListItem(p));
  }

  async adminGet(id: string): Promise<PageAdminRow> {
    const page = await this.prisma.page.findUnique({
      where: { id },
      include: PagesService.REL,
    });
    if (!page) throw new NotFoundException('Page not found');
    return this.toAdminRow(page);
  }

  async adminCreate(dto: CreatePageDto, authorId: string): Promise<PageAdminRow> {
    const wantsCustom = !!dto.slug?.trim();
    const base = this.slugify(dto.slug?.trim() || dto.title);
    const slug = await this.resolveSlug(base, wantsCustom);
    const status: PageStatus = dto.status ?? 'DRAFT';
    const page = await this.prisma.page.create({
      data: {
        slug,
        title: dto.title.trim(),
        data: this.sanitizeDoc(dto.data),
        status,
        publishedAt: status === 'PUBLISHED' ? new Date() : null,
        authorId,
      },
      include: PagesService.REL,
    });
    return this.toAdminRow(page);
  }

  async adminUpdate(id: string, dto: UpdatePageDto): Promise<PageAdminRow> {
    const existing = await this.prisma.page.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Page not found');

    // Stamp publishedAt the first time the page goes live; keep it stable after.
    let publishedAt = existing.publishedAt;
    if (dto.status === 'PUBLISHED' && !existing.publishedAt) {
      publishedAt = new Date();
    }

    // Slug only changes when explicitly provided (stable URLs, like WordPress).
    let slug: string | undefined;
    if (dto.slug !== undefined) {
      const base = this.slugify(dto.slug);
      slug =
        base === existing.slug
          ? existing.slug
          : await this.resolveSlug(base, true, id);
    }

    const page = await this.prisma.page.update({
      where: { id },
      data: {
        title: dto.title?.trim() ?? undefined,
        slug,
        data: dto.data !== undefined ? this.sanitizeDoc(dto.data) : undefined,
        status: dto.status ?? undefined,
        publishedAt,
      },
      include: PagesService.REL,
    });
    return this.toAdminRow(page);
  }

  async adminDelete(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.page.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Page not found');
    await this.prisma.page.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- sanitization ----------

  // Deep-copy the Puck document and sanitize any `html` string prop (the
  // RichText block). Everything else is structural data rendered by trusted
  // React components, so it passes through untouched. Re-building the envelope
  // also guarantees we only ever store the {root, content, zones} shape.
  // Deep-walk the Puck document and sanitize any `html` string (the RichText
  // block's prop) wherever it appears — including blocks nested inside slots
  // (Section/Columns store children in props), not just the top level.
  private sanitizeHtmlDeep(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((v) => this.sanitizeHtmlDeep(v));
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] =
          k === 'html' && typeof v === 'string'
            ? sanitizeHtml(v, SANITIZE_OPTS)
            : this.sanitizeHtmlDeep(v);
      }
      return out;
    }
    return value;
  }

  // Sanitize embedded HTML everywhere, then normalize the {root, content, zones}
  // envelope so only a well-formed Puck document is ever stored.
  private sanitizeDoc(input: unknown): Prisma.InputJsonValue {
    const doc = (
      input && typeof input === 'object' ? input : EMPTY_DOC
    ) as PuckDocument;
    const cleaned = this.sanitizeHtmlDeep(doc) as Partial<PuckDocument>;
    return {
      root:
        cleaned.root && typeof cleaned.root === 'object'
          ? cleaned.root
          : { props: {} },
      content: Array.isArray(cleaned.content) ? cleaned.content : [],
      zones:
        cleaned.zones && typeof cleaned.zones === 'object' ? cleaned.zones : {},
    } as unknown as Prisma.InputJsonValue;
  }

  // ---------- mappers ----------

  private toAuthor(
    a: { id: string; email: string } | null,
  ): PageAuthorDTO | null {
    if (!a) return null;
    return { id: a.id, name: a.email.split('@')[0] || a.email };
  }

  // Normalize whatever JSON is in the column back into a valid Puck envelope so
  // <Puck>/<Render> always receive { root, content, zones }.
  private asDoc(data: Prisma.JsonValue): PuckDocument {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const d = data as { content?: unknown; root?: unknown; zones?: unknown };
      return {
        content: Array.isArray(d.content)
          ? (d.content as PuckComponentData[])
          : [],
        root: (d.root && typeof d.root === 'object'
          ? d.root
          : { props: {} }) as PuckDocument['root'],
        zones: (d.zones && typeof d.zones === 'object'
          ? d.zones
          : {}) as PuckDocument['zones'],
      };
    }
    return { content: [], root: { props: {} } };
  }

  private toListItem(p: PageRow): PageListItem {
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      status: p.status,
      publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private toPublic(p: PageRow): PagePublicDTO {
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      data: this.asDoc(p.data),
      publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
    };
  }

  private toAdminRow(p: PageRow): PageAdminRow {
    return {
      ...this.toListItem(p),
      data: this.asDoc(p.data),
      author: this.toAuthor(p.author),
      createdAt: p.createdAt.toISOString(),
    };
  }

  // ---------- slugs ----------

  private slugify(input: string): string {
    return (
      input
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '') // strip diacritics
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'page'
    );
  }

  // Resolve a free, non-reserved slug. `strict` (explicit custom slug) errors on
  // conflict; otherwise (derived from title) it auto-suffixes -2, -3, … `ignoreId`
  // lets a page keep its own slug on update.
  private async resolveSlug(
    base: string,
    strict: boolean,
    ignoreId?: string,
  ): Promise<string> {
    const taken = async (s: string): Promise<boolean> => {
      if (RESERVED_SLUGS.has(s)) return true;
      const hit = await this.prisma.page.findUnique({ where: { slug: s } });
      return !!hit && hit.id !== ignoreId;
    };
    if (!(await taken(base))) return base;
    if (strict) {
      throw new BadRequestException(
        `The slug "${base}" is reserved or already in use`,
      );
    }
    let n = 1;
    let slug = base;
    while (await taken(slug)) {
      n += 1;
      slug = `${base}-${n}`;
    }
    return slug;
  }
}
