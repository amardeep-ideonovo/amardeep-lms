import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchPublishedPost } from "@/lib/api";
import { SITE_NAME, absoluteUrl, buildMetadata } from "@/lib/seo";

// Public, server-rendered (no auth) for SEO.
export const dynamic = "force-dynamic";

type Params = { params: { slug: string } };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const post = await fetchPublishedPost(params.slug);
  if (!post) return { title: "Post not found", robots: { index: false } };
  return buildMetadata({
    title: post.title,
    description: post.excerpt ?? undefined,
    path: `/blog/${post.slug}`,
    image: post.coverImageUrl,
    type: "article",
    publishedTime: post.publishedAt,
    modifiedTime: post.updatedAt,
    authors: post.author ? [post.author.name] : undefined,
  });
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

  const url = absoluteUrl(`/blog/${post.slug}`);
  const image = post.coverImageUrl ? absoluteUrl(post.coverImageUrl) : undefined;

  // Article rich-result schema. datePublished/dateModified + author + publisher
  // give Google everything it needs for a BlogPosting card.
  const articleLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt ?? undefined,
    image: image ? [image] : undefined,
    datePublished: post.publishedAt ?? undefined,
    dateModified: post.updatedAt,
    author: post.author
      ? { "@type": "Person", name: post.author.name }
      : undefined,
    publisher: { "@type": "Organization", name: SITE_NAME },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    keywords: post.tags.length ? post.tags.join(", ") : undefined,
    articleSection: post.categories.map((c) => c.name),
    url,
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
      {
        "@type": "ListItem",
        position: 2,
        name: "Blog",
        item: absoluteUrl("/blog"),
      },
      { "@type": "ListItem", position: 3, name: post.title, item: url },
    ],
  };

  return (
    <article className="article">
      {/* eslint-disable-next-line react/no-danger */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }}
      />
      {/* eslint-disable-next-line react/no-danger */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />

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
        <img
          src={post.coverImageUrl}
          alt={post.title}
          className="article-cover"
        />
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
