import type { Metadata, Viewport } from "next";
import { Montserrat, Playfair_Display } from "next/font/google";
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

// UI/body sans + display serif — exposed as CSS vars consumed by globals.css
// (--font-sans / --font-display reference these).
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-montserrat",
  display: "swap",
});
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800", "900"],
  variable: "--font-playfair",
  display: "swap",
});

// Resolve the saved theme (default dark) before first paint to avoid a flash.
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
  themeColor: "#7c5cfc",
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
      className={`${montserrat.variable} ${playfair.variable}`}
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
