import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import {
  fetchAppConfig,
  fetchFooter,
  fetchHeaderMenu,
  fetchSiteHeader,
} from "@/lib/api";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/seo";

// Ink Hero single typeface — exposed as a CSS var consumed by globals.css
// (BOTH --font-sans and --font-display resolve to it).
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

// Legacy theme resolution kept harmless: Ink Hero is a SINGLE theme (both
// :root and [data-theme="light"] carry identical tokens), so whatever stored
// preference this resolves to renders the same. The attribute plumbing stays.
const themeScript = `(function(){try{var p=localStorage.getItem('lms.theme')||'dark';var d=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.setAttribute('data-theme',d);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

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
  themeColor: "#221c3d",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [header, footer, appConfig] = await Promise.all([
    fetchSiteHeader(),
    fetchFooter(),
    fetchAppConfig(),
  ]);
  // Resolve the header menu using whichever menu the header points at, so the
  // first paint shows the real nav (no fallback flash on refresh).
  const headerMenu = await fetchHeaderMenu(header?.menuId);
  return (
    <html
      lang="en"
      data-theme="dark"
      className={jakarta.variable}
      suppressHydrationWarning
    >
      <body>
        {/* Per-instance runtime config — loads before the app bundle so
            window.__ENV__ (API/web origins) is set when lib/api.ts runs. */}
        <script src="/env.js" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <Nav
          initialHeader={header}
          initialMenu={headerMenu}
          brandTitle={appConfig?.title ?? null}
        />
        <main className="container">{children}</main>
        <Footer config={footer} brandTitle={appConfig?.title ?? null} />
      </body>
    </html>
  );
}
