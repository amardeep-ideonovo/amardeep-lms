// Server wrapper: enumerates the fixed section set so the static export
// (STATIC_EXPORT=1) can prerender every sidebar route; the view itself is
// fully client-rendered over the mock fleet store.
import SectionClient from "./section-client";
import { SECTIONS } from "./sections";

export function generateStaticParams() {
  return SECTIONS.map((section) => ({ section }));
}

export const dynamicParams = false;

export default function Page({ params }: { params: { section: string } }) {
  return <SectionClient section={params.section} />;
}
