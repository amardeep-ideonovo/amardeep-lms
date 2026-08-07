import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { SITE_URL, absoluteUrl } from "@/lib/seo";

// Rendered per-request (not at build): the public origin comes from the
// container's RUNTIME_WEB_URL (see lib/seo.ts), which doesn't exist at image
// build time — a build-time prerender would bake the localhost fallback into
// every instance. Mirrors sitemap.ts. NOTE: Next 14.2 ignores this segment
// export for robots.ts (verified: the route still built ○ Static with it), so
// robots() below also touches headers() — the call is what actually opts the
// route out of prerendering; keep the export for forward compatibility.
export const dynamic = "force-dynamic";

// Crawl policy. Private/member + transactional areas are disallowed; everything
// else (home, /blog, CMS pages, /pricing/all) is open. Points crawlers at the
// sitemap. Note: do NOT disallow "/pricing" — that prefix would also block the
// public "/pricing/all" catalog.
export default function robots(): MetadataRoute.Robots {
  headers(); // dynamic-API touch: forces per-request rendering on Next 14.2
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/account",
        "/dashboard",
        "/checkout",
        "/courses",
        "/lessons",
        "/forms",
        "/login",
        "/signup",
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
