import Link from "next/link";
import type { PostListItem } from "@lms/types";
import { fetchPublishedPosts } from "@/lib/api";
import { absoluteUrl, buildMetadata } from "@/lib/seo";

// Public, server-rendered (no auth). Dynamic so content is always fresh and we
// never try to reach the API at build time.
export const dynamic = "force-dynamic";

const BLOG_DESCRIPTION = "News, guides, and stories from our team.";

export const metadata = buildMetadata({
  title: "Blog",
  description: BLOG_DESCRIPTION,
  path: "/blog",
});

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function BlogIndexPage() {
  let posts: PostListItem[] = [];
  let failed = false;
  try {
    posts = await fetchPublishedPosts();
  } catch {
    failed = true;
  }

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
    ],
  };
  // ItemList of posts helps crawlers understand the collection + ordering.
  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: posts.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: absoluteUrl(`/blog/${p.slug}`),
      name: p.title,
    })),
  };

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      {posts.length > 0 && (
        // eslint-disable-next-line react/no-danger
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }}
        />
      )}

      <h1 className="page-title">Blog</h1>
      <p className="page-sub">{BLOG_DESCRIPTION}</p>

      {failed ? (
        <div className="alert alert-error">
          Couldn’t load posts right now. Please try again later.
        </div>
      ) : posts.length === 0 ? (
        <p className="empty">No posts yet. Check back soon.</p>
      ) : (
        <div className="card-grid">
          {posts.map((post) => (
            <Link key={post.id} href={`/blog/${post.slug}`} className="card">
              {post.coverImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={post.coverImageUrl}
                  alt={post.title}
                  className="post-cover"
                  loading="lazy"
                />
              )}
              <div className="post-meta">
                {post.categories.length > 0 && (
                  <span className="post-cat">
                    {post.categories.map((c) => c.name).join(", ")}
                  </span>
                )}
                {post.publishedAt && <span>{fmtDate(post.publishedAt)}</span>}
              </div>
              <h3 className="card-title">{post.title}</h3>
              {post.excerpt && <p className="card-desc">{post.excerpt}</p>}
              <span className="card-cta">Read →</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
