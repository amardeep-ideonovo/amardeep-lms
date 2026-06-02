import type { Metadata } from "next";

// Gated member content — keep out of search indexes.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function NoIndexLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
