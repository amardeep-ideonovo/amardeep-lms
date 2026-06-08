import type { PrismaService } from '../prisma/prisma.service';

// Shared target -> href resolution, used by both the menu resolver
// (MenusService.resolveMenu) and the header CTA resolver (SiteService). Keeping
// one implementation guarantees a CTA pointing at a Page/Class/etc. resolves to
// the exact same href a menu item would (published-only filtering included).

// Minimal target shape — both a MenuItem row and a HeaderCtaLink satisfy it.
export interface HrefTarget {
  type: string; // MenuItemType value
  url?: string | null;
  pageId?: string | null;
  levelId?: string | null;
  courseId?: string | null;
  postId?: string | null;
}

export interface HrefMaps {
  pageSlug: Map<string, string>;
  levelSlug: Map<string, string>;
  levelExists: Set<string>;
  postSlug: Map<string, string>;
  courseExists: Set<string>;
}

// Batch-resolve target slugs for a set of targets. Pages/posts are filtered to
// PUBLISHED, so links to drafts resolve to null (and are dropped by callers).
export async function buildHrefMaps(
  prisma: PrismaService,
  targets: HrefTarget[],
): Promise<HrefMaps> {
  const pageIds = targets
    .filter((t) => t.type === 'PAGE' && t.pageId)
    .map((t) => t.pageId as string);
  const levelIds = targets
    .filter((t) => t.type === 'CLASS' && t.levelId)
    .map((t) => t.levelId as string);
  const postIds = targets
    .filter((t) => t.type === 'BLOG_POST' && t.postId)
    .map((t) => t.postId as string);
  const courseIds = targets
    .filter((t) => t.type === 'COURSE' && t.courseId)
    .map((t) => t.courseId as string);

  const [pages, levels, posts, courses] = await Promise.all([
    pageIds.length
      ? prisma.page.findMany({
          where: { id: { in: pageIds }, status: 'PUBLISHED' },
          select: { id: true, slug: true },
        })
      : Promise.resolve([]),
    levelIds.length
      ? prisma.level.findMany({
          where: { id: { in: levelIds } },
          select: { id: true, slug: true },
        })
      : Promise.resolve([]),
    postIds.length
      ? prisma.post.findMany({
          where: { id: { in: postIds }, publishedAt: { not: null } },
          select: { id: true, slug: true },
        })
      : Promise.resolve([]),
    courseIds.length
      ? prisma.course.findMany({
          where: { id: { in: courseIds } },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    pageSlug: new Map(pages.map((p) => [p.id, p.slug] as const)),
    levelSlug: new Map(levels.map((l) => [l.id, l.slug] as const)),
    levelExists: new Set(levels.map((l) => l.id)),
    postSlug: new Map(posts.map((p) => [p.id, p.slug] as const)),
    courseExists: new Set(courses.map((c) => c.id)),
  };
}

// Pure: a target + the prefetched maps -> href (or null if unresolvable).
export function resolveHref(t: HrefTarget, maps: HrefMaps): string | null {
  switch (t.type) {
    case 'PAGE': {
      const s = t.pageId ? maps.pageSlug.get(t.pageId) : undefined;
      return s ? `/${s}` : null;
    }
    case 'CLASS': {
      if (!t.levelId || !maps.levelExists.has(t.levelId)) return null;
      const s = maps.levelSlug.get(t.levelId);
      return s ? `/classes/${s}` : `/classes/${t.levelId}`;
    }
    case 'COURSE':
      return t.courseId && maps.courseExists.has(t.courseId)
        ? `/courses/${t.courseId}`
        : null;
    case 'CLASS_INDEX':
      return '/pricing/all';
    case 'COURSE_INDEX':
      return '/dashboard';
    case 'BLOG_INDEX':
      return '/blog';
    case 'BLOG_POST': {
      const s = t.postId ? maps.postSlug.get(t.postId) : undefined;
      return s ? `/blog/${s}` : null;
    }
    case 'ROUTE':
    case 'CUSTOM':
      return t.url || null;
    default:
      return null;
  }
}
