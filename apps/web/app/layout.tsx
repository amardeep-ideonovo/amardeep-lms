import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { preload } from "react-dom";
import { cookies, headers } from "next/headers";
import { Plus_Jakarta_Sans } from "next/font/google";
import "@lms/ui/tokens.css";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import PreviewBanner from "@/components/PreviewBanner";
import HelpdeskWidget from "@/components/HelpdeskWidget";
import { ToastProvider } from "@/components/Toast";
import { QueryProvider } from "@/lib/query";
import {
  fetchAppConfig,
  fetchFooter,
  fetchHeaderMenu,
  fetchSiteHeader,
} from "@/lib/api";
import { SITE_DESCRIPTION, SITE_URL, getSiteName } from "@/lib/seo";
import { runtimeEnv } from "@/lib/runtime-env";

// Spark single typeface — Plus Jakarta Sans (owner's call over the pack's
// Space Grotesk), exposed as a CSS var consumed by globals.css (BOTH
// --font-sans and --font-display resolve to it).
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

// Dynamic so the browser-tab title + " | <brand>" suffix (inherited by every
// child page), applicationName and OG/Twitter card all carry the PER-INSTANCE
// brand (AppConfig.title) resolved at runtime — not the shared build-time
// SITE_NAME baked into the fleet image. getSiteName() never throws and falls
// back to SITE_NAME, so this can never 500 the whole app.
export async function generateMetadata(): Promise<Metadata> {
  const siteName = await getSiteName();
  return {
    // Resolves canonical tags + relative OG images to the public origin.
    metadataBase: new URL(SITE_URL),
    title: {
      default: siteName,
      template: `%s | ${siteName}`,
    },
    description: SITE_DESCRIPTION,
    applicationName: siteName,
    // Indexable by default; private/utility segments opt out via their own layout.
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: siteName,
      locale: "en_US",
      title: siteName,
      description: SITE_DESCRIPTION,
    },
    twitter: {
      card: "summary_large_image",
      title: siteName,
      description: SITE_DESCRIPTION,
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#221c3d",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Force DYNAMIC rendering. This web app ships as ONE prebuilt image to many
  // instances, with the API origin resolved at RUNTIME — so the public fetches
  // below MUST run per-request against the real instance API, never be baked
  // into static HTML at build time (when no API is reachable they'd bake the
  // "LMS" fallback brand + an empty footer, shown until ISR warms each fresh
  // container). Reading a request API opts every route out of static prerender
  // while leaving the fetch-level Data Cache (revalidate, see lib/api.ts) intact
  // — unlike `export const dynamic = "force-dynamic"`, which would ALSO force
  // those fetches to no-store and defeat the cache. (Previously the fetches'
  // cache:"no-store" was the implicit dynamic signal; the TTL cache removed it.)
  //
  // The request path (set by middleware.ts as `x-pathname`) also lets us resolve
  // the site header for THIS route at SSR, so a header hidden on this
  // section/page never paints on first load — no flash-then-hide on refresh.
  const path = headers().get("x-pathname") || undefined;
  // Signed-in hint (set alongside the localStorage token) — lets SSR reserve
  // the nav account chip's space so it doesn't pop in at hydration.
  const authedHint = cookies().get("lms_authed")?.value === "1";

  // The header menu depends on the header (which menu it points at), but the
  // footer and app config do NOT — so chain the menu directly onto the header
  // fetch rather than awaiting all three first. This takes the menu request off
  // the critical path behind whichever of footer/appConfig is slowest: it now
  // fires the instant the header resolves, in parallel with the rest. The menu
  // is still resolved before render, so the first paint shows the real nav (no
  // fallback flash on refresh).
  const headerPromise = fetchSiteHeader(path);
  const [header, footer, appConfig, headerMenu] = await Promise.all([
    headerPromise,
    fetchFooter(),
    fetchAppConfig(),
    headerPromise.then((h) => fetchHeaderMenu(h?.menuId)),
  ]);
  // A builder-uploaded header logo sizes itself from the image (height 32px,
  // width auto) — fetch it at HTML parse time so it's decoded before first
  // paint and the brand area doesn't widen mid-load on a cold visit.
  if (header?.logoUrl) preload(header.logoUrl, { as: "image" });
  return (
    <html lang="en" className={jakarta.variable}>
      <body>
        {/* Per-instance runtime config, set BEFORE any hydration so the client's
            apiBase() is never read before window.__ENV__ exists. `beforeInteractive`
            guarantees this inline script runs ahead of Next's (async) bundle and
            page hydration — the previous deferred external /env.js raced React:
            when the ownership effect won, apiBase() fell back to localhost, the
            my-courses fetch failed, and owned-gated views (the class page) stuck
            on the guest state. Inlined from the request-time env (this layout is
            dynamic — see headers() above), so ONE image still serves any instance.
            `<` is escaped to prevent a </script> breakout. */}
        <Script id="runtime-env" strategy="beforeInteractive">
          {`window.__ENV__=${JSON.stringify(runtimeEnv()).replace(
            /</g,
            "\\u003c",
          )};`}
        </Script>
        <QueryProvider>
          <ToastProvider>
            {/* Admin "preview the member site" banner — renders only during a
                preview session (no-op for real members and guests). Inside
                QueryProvider so it can read /auth/me; above Nav so it sits at the
                very top of every page. */}
            <PreviewBanner />
            <HelpdeskWidget />
            <Nav
              initialHeader={header}
              initialMenu={headerMenu}
              brandTitle={appConfig?.title ?? null}
              authedHint={authedHint}
            />
            <main className="container">{children}</main>
            <Footer config={footer} brandTitle={appConfig?.title ?? null} />
          </ToastProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
