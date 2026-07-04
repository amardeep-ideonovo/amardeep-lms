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

// Deterministic gradient from a post id, so imageless posts each get a
// distinct—but stable—cover instead of a blank tile.
function coverGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 75;
  // Constrain the base hue to the violet→magenta band so auto covers stay on-brand.
  const h = 255 + hash;
  const h2 = 255 + ((hash + 42) % 75); // keep the 2nd stop inside the band too
  return `linear-gradient(150deg, hsl(${h} 55% 38%), hsl(${h2} 50% 20%))`;
}

// Hero treatment for the lead post (overlay, like the dashboard continue card).
function FeaturedPost({ post }: { post: PostListItem }) {
  return (
    <Link href={`/blog/${post.slug}`} className="bc-featured">
      <div
        className="bc-featured-bg"
        style={
          post.coverImageUrl
            ? { backgroundImage: `url(${post.coverImageUrl})` }
            : { background: coverGradient(post.id) }
        }
      />
      <div className="bc-featured-inner">
        <p className="bc-eyebrow">Featured</p>
        <h2>{post.title}</h2>
        {post.excerpt && <p className="bc-featured-excerpt">{post.excerpt}</p>}
        <div className="bc-meta">
          {post.categories.length > 0 && (
            <span className="bc-chip">{post.categories[0].name}</span>
          )}
          {post.publishedAt && (
            <span className="bc-date">{fmtDate(post.publishedAt)}</span>
          )}
        </div>
        <span className="bc-readmore">Read article →</span>
      </div>
    </Link>
  );
}

// Uniform grid card: fixed-ratio cover (gradient + letter when no image),
// clamped title/excerpt → every card the same height.
function PostCard({ post }: { post: PostListItem }) {
  return (
    <Link href={`/blog/${post.slug}`} className="bc-card">
      <div
        className={post.coverImageUrl ? "bc-cover" : "bc-cover bc-cover--empty"}
        style={post.coverImageUrl ? undefined : { background: coverGradient(post.id) }}
      >
        {post.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.coverImageUrl} alt="" loading="lazy" />
        ) : (
          <span>{post.title.charAt(0).toUpperCase()}</span>
        )}
      </div>
      <div className="bc-card-body">
        <div className="bc-meta">
          {post.categories.length > 0 && (
            <span className="bc-chip">{post.categories[0].name}</span>
          )}
          {post.publishedAt && (
            <span className="bc-date">{fmtDate(post.publishedAt)}</span>
          )}
        </div>
        <h3 className="bc-title">{post.title}</h3>
        {post.excerpt && <p className="bc-excerpt">{post.excerpt}</p>}
        <span className="bc-readmore">Read →</span>
      </div>
    </Link>
  );
}

export default async function BlogIndexPage() {
  let posts: PostListItem[] = [];
  let failed = false;
  try {
    posts = await fetchPublishedPosts();
  } catch {
    failed = true;
  }

  // Lead with the most recent post that actually has a cover image, so rich
  // content headlines the page instead of being buried under empty posts.
  const featured = posts.find((p) => p.coverImageUrl) ?? posts[0] ?? null;
  const rest = featured ? posts.filter((p) => p.id !== featured.id) : posts;

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

      <div className="blog-cinema">
        <div className="bc-wrap">
          <div className="bc-head">
            <h1>Blog</h1>
            <p>{BLOG_DESCRIPTION}</p>
          </div>

          {failed ? (
            <div className="bc-alert">
              Couldn’t load posts right now. Please try again later.
            </div>
          ) : posts.length === 0 ? (
            <p className="bc-empty">No posts yet. Check back soon.</p>
          ) : (
            <>
              {featured && <FeaturedPost post={featured} />}
              {rest.length > 0 && (
                <div className="bc-grid">
                  {rest.map((post) => (
                    <PostCard key={post.id} post={post} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
