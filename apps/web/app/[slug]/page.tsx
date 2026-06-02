import type { Metadata } from "next";
import { notFound } from "next/navigation";
// Server-side renderer for Puck documents (RSC build — no client JS shipped for
// static pages).
import { Render } from "@puckeditor/core/rsc";
import type { Data } from "@puckeditor/core";
import { createPuckConfig } from "@lms/puck";
import type { PageProps, RootProps } from "@lms/puck";
import "@lms/puck/styles.css";
import FormEmbed from "@/components/FormEmbed";
import PopupHost from "@/components/PopupHost";
import { fetchPublishedPage } from "@/lib/api";
import { absoluteUrl, buildMetadata } from "@/lib/seo";

// Root-level catch-all for CMS pages: /:slug. Next.js resolves the app's static
// routes (/, /blog, /courses, /dashboard, /account, /login, …) BEFORE this
// dynamic segment, so this only handles unknown top-level slugs — resolving
// them to a PUBLISHED page or 404. Public + server-rendered for SEO.
export const dynamic = "force-dynamic";

const config = createPuckConfig({ formComponent: FormEmbed });

type Params = { params: { slug: string } };

type SeoProps = { seoTitle?: string; description?: string; ogImage?: string };

function pageSeo(page: { title: string; data?: { root?: { props?: unknown } } }) {
  const seo = (page.data?.root?.props ?? {}) as SeoProps;
  return {
    title: seo.seoTitle?.trim() || page.title,
    description: seo.description?.trim() || undefined,
    ogImage: seo.ogImage?.trim() || undefined,
  };
}

export async function generateMetadata({
  params,
}: Params): Promise<Metadata> {
  const page = await fetchPublishedPage(params.slug);
  if (!page) return { title: "Page not found", robots: { index: false } };
  const seo = pageSeo(page);
  return buildMetadata({
    title: seo.title,
    description: seo.description,
    path: `/${page.slug}`,
    image: seo.ogImage,
    type: "website",
  });
}

export default async function CmsPage({ params }: Params) {
  const page = await fetchPublishedPage(params.slug);
  if (!page) notFound();

  const seo = pageSeo(page);
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
      {
        "@type": "ListItem",
        position: 2,
        name: seo.title,
        item: absoluteUrl(`/${page.slug}`),
      },
    ],
  };

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      {/* Guaranteed single H1 for crawlers. Puck canvases don't always include a
          heading block, so we surface the page/SEO title here (visually hidden
          so it never clashes with the authored design). */}
      <h1 className="co-sr-only">{seo.title}</h1>
      <Render
        config={config}
        data={page.data as unknown as Data<PageProps, RootProps>}
      />
      {/* Active popups targeted at this page (shown on every visit). */}
      <PopupHost context={{ type: "page", pageId: page.id }} />
    </>
  );
}
