import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ClassPublicDTO } from "@lms/types";
import { fetchClassPage } from "@/lib/api";
import { buildMetadata } from "@/lib/seo";
import ClassMemberArea from "@/components/ClassMemberArea";

// Public, server-rendered class landing page (MasterClass-style). Dynamic so we
// never reach the API at build time and the page always reflects admin edits.
// The hero + skills are static (SSR, SEO-friendly); the ownership-dependent body
// (courses vs. Get-Class/trailer) is resolved client-side in <ClassMemberArea>.
export const dynamic = "force-dynamic";

type Params = { params: { slug: string } };

// Total runtime, human-readable: "2hr 52min" / "45min".
function fmtTotal(seconds: number): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}hr ${m}min` : `${m}min`;
}
function priceLabel(cls: ClassPublicDTO): string | null {
  if (cls.prices.length === 0) return null;
  const cheapest = cls.prices.reduce((a, b) => (a.amount <= b.amount ? a : b));
  const amt = (cheapest.amount / 100).toLocaleString(undefined, {
    style: "currency",
    currency: (cheapest.currency || "usd").toUpperCase(),
  });
  return `${amt}/${cheapest.interval}`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const cls = await fetchClassPage(params.slug);
  if (!cls) return { title: "Class not found", robots: { index: false } };
  return buildMetadata({
    title: cls.name,
    description: cls.description ?? undefined,
    path: `/classes/${cls.slug ?? cls.id}`,
    image: cls.imageUrl,
    type: "website",
  });
}

export default async function ClassPage({ params }: Params) {
  const cls = await fetchClassPage(params.slug);
  if (!cls) notFound();

  const slugOrId = cls.slug ?? cls.id;

  return (
    <article>
      {/* Hero — static, public (good for SEO + always visible) */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 28,
          alignItems: "center",
          margin: "8px 0 28px",
        }}
      >
        <div>
          {cls.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cls.imageUrl}
              alt={cls.name}
              style={{
                width: "100%",
                maxHeight: 480,
                objectFit: "cover",
                borderRadius: 12,
                display: "block",
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                aspectRatio: "3/4",
                borderRadius: 12,
                background: "var(--border)",
              }}
            />
          )}
        </div>
        <div>
          {cls.categories.length > 0 && (
            <div className="chips" style={{ marginBottom: 12 }}>
              {cls.categories.map((c) => (
                <span key={c.id} className="chip chip--muted">
                  {c.name}
                </span>
              ))}
            </div>
          )}
          <h1 className="page-title" style={{ marginBottom: 12 }}>
            {cls.name}
          </h1>
          {cls.description && (
            <p style={{ color: "var(--muted, #555)" }}>{cls.description}</p>
          )}
        </div>
      </section>

      {/* Ownership-gated body: members see "Your Courses"; everyone else sees the
          marketing CTA + trailer. Resolved client-side (token is in localStorage). */}
      <ClassMemberArea
        slugOrId={slugOrId}
        name={cls.name}
        checkoutHref={`/checkout/${slugOrId}`}
        priceLabel={priceLabel(cls)}
        trailerUrl={cls.trailerUrl}
        lessonCount={cls.lessonCount}
        totalLabel={fmtTotal(cls.totalDurationSeconds)}
      />

      {/* Skills You'll Learn — always shown */}
      {cls.skills.length > 0 && (
        <section style={{ marginBottom: 36 }}>
          <h2 className="section-title">Skills You&apos;ll Learn</h2>
          <div className="card-grid">
            {cls.skills.map((s, i) => (
              <div key={i} className="card">
                {s.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.imageUrl}
                    alt=""
                    style={{
                      width: "100%",
                      height: 160,
                      objectFit: "cover",
                      borderRadius: 8,
                      marginBottom: 8,
                      display: "block",
                    }}
                  />
                ) : null}
                <h3 className="card-title">{s.title}</h3>
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
