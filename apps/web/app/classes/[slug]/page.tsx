import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ClassPublicDTO } from "@lms/types";
import { fetchClassPage } from "@/lib/api";
import { buildMetadata } from "@/lib/seo";
import ClassMemberArea from "@/components/ClassMemberArea";

// Public, server-rendered class landing page (cinematic dark theme). Dynamic so
// we never reach the API at build time and the page always reflects admin edits.
// Hero + skills are static SSR (SEO-friendly); the ownership-dependent body
// (Your Courses vs. Get-Class/trailer) is resolved client-side in <ClassMemberArea>.
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
  const totalLabel = fmtTotal(cls.totalDurationSeconds);

  return (
    <article className="class-cinema">
      {/* ---------- HERO (static, public, SEO) ---------- */}
      <header className="cc-hero">
        <div
          className={cls.imageUrl ? "cc-hero-bg" : "cc-hero-bg cc-hero-bg--empty"}
          style={cls.imageUrl ? { backgroundImage: `url(${cls.imageUrl})` } : undefined}
        />
        <div className="cc-hero-inner">
          <div className="cc-hero-left">
            {cls.categories.length > 0 && (
              <div className="cc-cats">
                {cls.categories.map((c) => (
                  <span key={c.id} className="cc-chip">{c.name}</span>
                ))}
              </div>
            )}
            <h1 className="cc-title">{cls.name}</h1>
            {cls.description && <p className="cc-teaches">{cls.description}</p>}
            <div className="cc-meta">
              {cls.lessonCount > 0 && (
                <>
                  <span>{cls.lessonCount} lesson{cls.lessonCount === 1 ? "" : "s"}</span>
                  {totalLabel && <span className="dot" />}
                </>
              )}
              {totalLabel && <span>{totalLabel}</span>}
            </div>
          </div>

          {/* The buy / resume card is ownership-dependent → client component. */}
          <ClassMemberArea
            slugOrId={slugOrId}
            name={cls.name}
            checkoutHref={`/checkout/${slugOrId}`}
            priceLabel={priceLabel(cls)}
            trailerUrl={cls.trailerUrl}
            lessonCount={cls.lessonCount}
            totalLabel={totalLabel}
            slot="hero-card"
          />
        </div>
      </header>

      {/* ---------- BODY: skills + trailer + courses + closing CTA ---------- */}
      {/* Ownership-gated ORDER: guests see Skills first (marketing), members
          see Your Courses first with Skills below. The skills markup is built
          here (server, SEO-friendly) and ordered by the client component. */}
      <ClassMemberArea
        slugOrId={slugOrId}
        name={cls.name}
        checkoutHref={`/checkout/${slugOrId}`}
        priceLabel={priceLabel(cls)}
        trailerUrl={cls.trailerUrl}
        lessonCount={cls.lessonCount}
        totalLabel={totalLabel}
        slot="body"
        skills={
          cls.skills.length > 0 ? (
            <section className="cc-section">
              <div className="cc-wrap">
                <p className="cc-eyebrow">Curriculum</p>
                <h2 className="cc-h2">Skills You&apos;ll Learn</h2>
                <p className="cc-sub">What you&apos;ll be able to do by the end.</p>
                <div className="cc-skills">
                  {cls.skills.map((s, i) => (
                    <div key={i} className={s.imageUrl ? "cc-skill" : "cc-skill cc-skill--empty"}>
                      <span className="cc-skill-num">{i + 1}</span>
                      {s.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.imageUrl} alt="" />
                      )}
                      <div className="cc-skill-title">{s.title}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null
        }
      />
    </article>
  );
}
