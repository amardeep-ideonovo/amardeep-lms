import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchPublishedPost } from "@/lib/api";

// Public, server-rendered (no auth) for SEO.
export const dynamic = "force-dynamic";

type Params = { params: { slug: string } };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const post = await fetchPublishedPost(params.slug);
  if (!post) return { title: "Post not found" };
  return {
    title: post.title,
    description: post.excerpt ?? undefined,
    openGraph: {
      title: post.title,
      description: post.excerpt ?? undefined,
      type: "article",
      publishedTime: post.publishedAt ?? undefined,
      images: post.coverImageUrl ? [{ url: post.coverImageUrl }] : undefined,
    },
  };
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function BlogPostPage({ params }: Params) {
  const post = await fetchPublishedPost(params.slug);
  if (!post) notFound();

  return (
    <article className="article">
      <div className="breadcrumb">
        <Link href="/blog">← Blog</Link>
      </div>

      <h1 className="page-title">{post.title}</h1>

      <div className="post-meta" style={{ marginBottom: 20 }}>
        {post.author && <span>By {post.author.name}</span>}
        {post.publishedAt && <span>· {fmtDate(post.publishedAt)}</span>}
        {post.categories.length > 0 && (
          <span className="post-cat">
            · {post.categories.map((c) => c.name).join(", ")}
          </span>
        )}
      </div>

      {post.coverImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.coverImageUrl} alt="" className="article-cover" />
      )}

      {/* Content is sanitized server-side on write (sanitize-html). */}
      <div
        className="article-content"
        dangerouslySetInnerHTML={{ __html: post.content }}
      />

      {post.tags.length > 0 && (
        <div className="post-tags">
          {post.tags.map((t) => (
            <span key={t} className="post-tag">
              #{t}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
