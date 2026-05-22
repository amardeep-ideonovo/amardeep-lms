import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  PostAdminRow,
  PostAuthorDTO,
  PostCategoryDTO,
  PostDetailDTO,
  PostListItem,
  PostStatus,
} from '@lms/types';
import sanitizeHtml from 'sanitize-html';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatePostCategoryDto,
  CreatePostDto,
  UpdatePostDto,
} from './dto/blog.dto';

// Posts are authored by admins but rendered on a PUBLIC (logged-out) page, so
// the HTML is sanitized on write as defense-in-depth: a stored-XSS payload must
// never reach a visitor's browser. Allow a blog-appropriate tag/attr set only.
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
  // No data: in <a href> (phishing/JS vector); data: only for inline images.
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

// Shape we read back for mapping. Author is narrowed to non-secret fields.
type PostRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  coverImageUrl: string | null;
  status: PostStatus;
  publishedAt: Date | null;
  categoryId: string | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; email: string } | null;
  category: { id: string; name: string; slug: string; order: number } | null;
};

@Injectable()
export class BlogService {
  constructor(private readonly prisma: PrismaService) {}

  // Only ever load non-secret author fields alongside a post.
  private static readonly REL = {
    author: { select: { id: true, email: true } },
    category: true,
  } as const;

  // ---------- public reads ----------

  async listPublished(): Promise<PostListItem[]> {
    const posts = await this.prisma.post.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
      include: BlogService.REL,
    });
    return posts.map((p: PostRow) => this.toListItem(p));
  }

  async getPublishedBySlug(slug: string): Promise<PostDetailDTO> {
    const post = await this.prisma.post.findUnique({
      where: { slug },
      include: BlogService.REL,
    });
    // Drafts and unknown slugs are indistinguishable to the public: both 404.
    if (!post || post.status !== 'PUBLISHED') {
      throw new NotFoundException('Post not found');
    }
    return this.toDetail(post);
  }

  async listCategories(): Promise<PostCategoryDTO[]> {
    const cats = await this.prisma.postCategory.findMany({
      orderBy: { order: 'asc' },
    });
    return cats.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      order: c.order,
    }));
  }

  // ---------- admin ----------

  async adminList(): Promise<PostAdminRow[]> {
    const posts = await this.prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      include: BlogService.REL,
    });
    return posts.map((p: PostRow) => this.toAdminRow(p));
  }

  async adminCreate(dto: CreatePostDto, authorId: string): Promise<PostAdminRow> {
    const slug = await this.uniquePostSlug(this.slugify(dto.title));
    const status: PostStatus = dto.status ?? 'DRAFT';
    const post = await this.prisma.post.create({
      data: {
        slug,
        title: dto.title.trim(),
        excerpt: dto.excerpt?.trim() || null,
        content: dto.content ? sanitizeHtml(dto.content, SANITIZE_OPTS) : '',
        coverImageUrl: dto.coverImageUrl?.trim() || null,
        status,
        publishedAt: status === 'PUBLISHED' ? new Date() : null,
        categoryId: dto.categoryId || null,
        tags: dto.tags ?? [],
        authorId,
      },
      include: BlogService.REL,
    });
    return this.toAdminRow(post);
  }

  async adminUpdate(id: string, dto: UpdatePostDto): Promise<PostAdminRow> {
    const existing = await this.prisma.post.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Post not found');

    // Stamp publishedAt the first time a post goes live; keep it stable after.
    let publishedAt = existing.publishedAt;
    if (dto.status === 'PUBLISHED' && !existing.publishedAt) {
      publishedAt = new Date();
    }

    const post = await this.prisma.post.update({
      where: { id },
      data: {
        title: dto.title?.trim() ?? undefined,
        excerpt:
          dto.excerpt !== undefined ? dto.excerpt.trim() || null : undefined,
        content:
          dto.content !== undefined
            ? sanitizeHtml(dto.content, SANITIZE_OPTS)
            : undefined,
        coverImageUrl:
          dto.coverImageUrl !== undefined
            ? dto.coverImageUrl.trim() || null
            : undefined,
        status: dto.status ?? undefined,
        publishedAt,
        categoryId:
          dto.categoryId !== undefined ? dto.categoryId || null : undefined,
        tags: dto.tags ?? undefined,
      },
      include: BlogService.REL,
    });
    return this.toAdminRow(post);
  }

  async adminDelete(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.post.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Post not found');
    await this.prisma.post.delete({ where: { id } });
    return { ok: true };
  }

  async createCategory(dto: CreatePostCategoryDto): Promise<PostCategoryDTO> {
    const slug = await this.uniqueCategorySlug(this.slugify(dto.name));
    const cat = await this.prisma.postCategory.create({
      data: { name: dto.name.trim(), slug, order: dto.order ?? 0 },
    });
    return { id: cat.id, name: cat.name, slug: cat.slug, order: cat.order };
  }

  // ---------- mappers ----------

  private toAuthor(
    a: { id: string; email: string } | null,
  ): PostAuthorDTO | null {
    if (!a) return null;
    return { id: a.id, name: a.email.split('@')[0] || a.email };
  }

  private toCategory(
    c: { id: string; name: string; slug: string; order: number } | null,
  ): PostCategoryDTO | null {
    return c ? { id: c.id, name: c.name, slug: c.slug, order: c.order } : null;
  }

  private toListItem(p: PostRow): PostListItem {
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt,
      coverImageUrl: p.coverImageUrl,
      category: this.toCategory(p.category),
      tags: p.tags,
      author: this.toAuthor(p.author),
      publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
    };
  }

  private toDetail(p: PostRow): PostDetailDTO {
    return { ...this.toListItem(p), content: p.content };
  }

  private toAdminRow(p: PostRow): PostAdminRow {
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt,
      content: p.content,
      coverImageUrl: p.coverImageUrl,
      status: p.status,
      categoryId: p.categoryId,
      category: this.toCategory(p.category),
      tags: p.tags,
      author: this.toAuthor(p.author),
      publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
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
        .replace(/^-+|-+$/g, '') || 'post'
    );
  }

  private async uniquePostSlug(base: string): Promise<string> {
    let slug = base;
    let n = 1;
    // Append -2, -3, … until free.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const hit = await this.prisma.post.findUnique({ where: { slug } });
      if (!hit) return slug;
      n += 1;
      slug = `${base}-${n}`;
    }
  }

  private async uniqueCategorySlug(base: string): Promise<string> {
    let slug = base;
    let n = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const hit = await this.prisma.postCategory.findUnique({
        where: { slug },
      });
      if (!hit) return slug;
      n += 1;
      slug = `${base}-${n}`;
    }
  }
}
