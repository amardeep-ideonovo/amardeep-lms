// Reusable embed for a CMS page. Drop <PageEmbed slug="…" /> into ANY server
// component (dashboard section, marketing block, etc.) to render an
// admin-authored page inline — not just at the /[slug] route. Renders nothing
// if the slug isn't a PUBLISHED page, so a missing page never breaks the host.
import { Render } from "@puckeditor/core/rsc";
import type { Data } from "@puckeditor/core";
import { createPuckConfig } from "@lms/puck";
import type { PageProps, RootProps } from "@lms/puck";
import "@lms/puck/styles.css";
import FormEmbed from "@/components/FormEmbed";
import { fetchPublishedPage } from "@/lib/api";

const config = createPuckConfig({ formComponent: FormEmbed });

export default async function PageEmbed({ slug }: { slug: string }) {
  const page = await fetchPublishedPage(slug);
  if (!page) return null;
  return (
    <Render
      config={config}
      data={page.data as unknown as Data<PageProps, RootProps>}
    />
  );
}
