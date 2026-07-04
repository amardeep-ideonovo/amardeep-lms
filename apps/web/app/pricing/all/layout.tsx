import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";

// /pricing/all is the public plan catalog. Its page is a client component (it
// can't export metadata), so the segment layout supplies title + canonical +
// social tags and keeps it indexable.
export const metadata: Metadata = buildMetadata({
  title: "Pricing & Plans",
  description: "Compare membership levels and choose the plan that fits you.",
  path: "/pricing/all",
});

export default function PricingAllLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
