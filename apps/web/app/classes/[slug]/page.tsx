import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ClassPublicDTO } from "@lms/types";
import { fetchClassPage } from "@/lib/api";
import { buildMetadata } from "@/lib/seo";
import ClassMemberArea from "@/components/ClassMemberArea";
import PopupHost from "@/components/PopupHost";

// Public, server-rendered class landing page (Ink Hero). Dynamic so we never
// reach the API at build time and the page always reflects admin edits. The
// band hero (class photo under an ink scrim — photos stay the highlight) is
// static SSR (SEO-friendly); the ownership-dependent body (course accordions
// vs. buy card/trailer) is resolved client-side in <ClassMemberArea>.
export const dynamic = "force-dynamic";

type Params = { params: { slug: string } };

// Total runtime, human-readable: "1h 47m" / "45m".
function fmtTotal(seconds: number): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
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
  const totalLabel = fmtTotal(cls.totalDurationSeconds);
  const metaBits = [
    cls.lessonCount > 0
      ? `${cls.lessonCount} lesson${cls.lessonCount === 1 ? "" : "s"}`
      : null,
    totalLabel ? `${totalLabel} of video` : null,
  ].filter(Boolean);

  return (
    <article className="ink-page">
      <PopupHost context={{ type: "classes" }} />

      {/* ---- band hero: class photo under an ink scrim + breadcrumb/title ---- */}
      <header
        className={cls.imageUrl ? "ik-band ik-band--photo" : "ik-band"}
        style={cls.imageUrl ? { backgroundImage: `url(${cls.imageUrl})` } : undefined}
      >
        <div className="ik-band-inner ik-band-inner--crumbs">
          <nav className="ik-crumbs" aria-label="Breadcrumb">
            <Link href="/classes">My Classes</Link>
            <span aria-hidden="true">›</span>
            <span className="on">{cls.name}</span>
          </nav>
          <div className="ik-band-row" style={{ marginTop: 14 }}>
            <div className="ik-grow">
              <h1 className="ik-band-title">{cls.name}</h1>
              <p className="ik-band-sub" style={{ fontSize: 13.5 }}>
                {metaBits.length > 0 ? metaBits.join(" · ") : cls.categories.map((c) => c.name).join(" · ")}
              </p>
            </div>
            {/* member-only 72px progress ring (client) */}
            <ClassMemberArea
              slugOrId={slugOrId}
              name={cls.name}
              checkoutHref={`/checkout/${slugOrId}`}
              priceLabel={priceLabel(cls)}
              trailerUrl={cls.trailerUrl}
              lessonCount={cls.lessonCount}
              totalLabel={totalLabel}
              slot="hero-ring"
            />
          </div>
        </div>
      </header>

      {/* ---- overlap body: accordions + rail (member) / buy + marketing (guest) */}
      <div className="ik-main">
        <ClassMemberArea
          slugOrId={slugOrId}
          name={cls.name}
          checkoutHref={`/checkout/${slugOrId}`}
          priceLabel={priceLabel(cls)}
          trailerUrl={cls.trailerUrl}
          lessonCount={cls.lessonCount}
          totalLabel={totalLabel}
          slot="body"
          description={cls.description}
          imageUrl={cls.imageUrl}
          skills={
            cls.skills.length > 0 ? (
              <section style={{ marginTop: 30 }}>
                <div className="ik-section-head">
                  <h2 className="ik-section-title">Skills You&apos;ll Learn</h2>
                </div>
                <div className="ik-skills">
                  {cls.skills.map((s, i) => (
                    <div key={i} className={s.imageUrl ? "ik-skill" : "ik-skill ik-skill--empty"}>
                      <span className="ik-skill-num">{i + 1}</span>
                      {s.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.imageUrl} alt="" />
                      )}
                      <div className="ik-skill-title">{s.title}</div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null
          }
        />
      </div>
    </article>
  );
}
