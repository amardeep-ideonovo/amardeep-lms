import Link from "next/link";
import type { Metadata } from "next";
import type { PostListItem } from "@lms/types";
import { fetchPublishedPosts } from "@/lib/api";

// Public, server-rendered (no auth). Dynamic so content is always fresh and we
// never try to reach the API at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Blog",
  description: "News, guides, and stories from our team.",
};

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

  return (
    <>
      <h1 className="page-title">Blog</h1>
      <p className="page-sub">News, guides, and stories from our team.</p>

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
                <img src={post.coverImageUrl} alt="" className="post-cover" />
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
