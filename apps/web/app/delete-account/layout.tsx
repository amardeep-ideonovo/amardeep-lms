import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";

// Public account-deletion policy page. Linked from the app-store data-safety
// listings, so it must resolve without auth and stay indexable. The page is a
// plain server component; the segment layout supplies title + canonical + tags.
export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: "Delete your account",
    description:
      "How to permanently delete your account and what data is removed or retained.",
    path: "/delete-account",
  });
}

export default function DeleteAccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
