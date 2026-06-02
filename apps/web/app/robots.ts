import type { MetadataRoute } from "next";
import { SITE_URL, absoluteUrl } from "@/lib/seo";

// Crawl policy. Private/member + transactional areas are disallowed; everything
// else (home, /blog, CMS pages, /pricing/all) is open. Points crawlers at the
// sitemap. Note: do NOT disallow "/pricing" — that prefix would also block the
// public "/pricing/all" catalog.
export default function robots(): MetadataRoute.Robots {
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
