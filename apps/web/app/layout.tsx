import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { fetchFooter, fetchSiteHeader } from "@/lib/api";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  // Resolves canonical tags + relative OG images to the public origin.
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // Indexable by default; private/utility segments opt out via their own layout.
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [header, footer] = await Promise.all([
    fetchSiteHeader(),
    fetchFooter(),
  ]);
  return (
    <html lang="en">
      <body>
        <Nav initialHeader={header} />
        <main className="container">{children}</main>
        <Footer config={footer} />
      </body>
    </html>
  );
}
