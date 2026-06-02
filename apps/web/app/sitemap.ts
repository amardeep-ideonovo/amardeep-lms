import type { MetadataRoute } from "next";
import { fetchPublishedPages, fetchPublishedPosts } from "@/lib/api";
import { absoluteUrl } from "@/lib/seo";

// Resolved per-request (not at build) so we never depend on the API being up
// during `next build`, mirroring the blog/page route choices.
export const dynamic = "force-dynamic";

type Entry = MetadataRoute.Sitemap[number];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [posts, pages] = await Promise.all([
    fetchPublishedPosts().catch(() => []),
    fetchPublishedPages().catch(() => []),
  ]);

  const staticEntries: Entry[] = [
    { url: absoluteUrl("/blog"), changeFrequency: "daily", priority: 0.7 },
    {
      url: absoluteUrl("/pricing/all"),
      changeFrequency: "weekly",
      priority: 0.6,
    },
  ];

  const postEntries: Entry[] = posts.map((p): Entry => ({
    url: absoluteUrl(`/blog/${p.slug}`),
    lastModified: p.publishedAt ?? undefined,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const pageEntries: Entry[] = pages.map((pg): Entry => ({
    url: absoluteUrl(`/${pg.slug}`),
    lastModified: pg.updatedAt,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...staticEntries, ...postEntries, ...pageEntries];
}
