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

// Root-level catch-all for CMS pages: /:slug. Next.js resolves the app's static
// routes (/, /blog, /courses, /dashboard, /account, /login, …) BEFORE this
// dynamic segment, so this only handles unknown top-level slugs — resolving
// them to a PUBLISHED page or 404. Public + server-rendered for SEO.
export const dynamic = "force-dynamic";

const config = createPuckConfig({ formComponent: FormEmbed });

type Params = { params: { slug: string } };

type SeoProps = { seoTitle?: string; description?: string; ogImage?: string };

export async function generateMetadata({
  params,
}: Params): Promise<Metadata> {
  const page = await fetchPublishedPage(params.slug);
  if (!page) return { title: "Page not found" };
  const seo = (page.data?.root?.props ?? {}) as SeoProps;
  const title = seo.seoTitle?.trim() || page.title;
  const description = seo.description?.trim() || undefined;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: seo.ogImage ? [{ url: seo.ogImage }] : undefined,
    },
  };
}

export default async function CmsPage({ params }: Params) {
  const page = await fetchPublishedPage(params.slug);
  if (!page) notFound();

  return (
    <>
      <Render
        config={config}
        data={page.data as unknown as Data<PageProps, RootProps>}
      />
      {/* Active popups targeted at this page (shown on every visit). */}
      <PopupHost context={{ type: "page", pageId: page.id }} />
    </>
  );
}
