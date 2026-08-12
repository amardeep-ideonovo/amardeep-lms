import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { SITE_DESCRIPTION, getSiteName } from "@/lib/seo";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  // Touch headers() to opt OUT of static prerendering (the same technique the
  // root layout and robots.ts use — `export const dynamic` is NOT honored for
  // metadata routes). The name must resolve from each instance's live
  // AppConfig.title at request time, not bake the shared fallback brand at build.
  headers();
  const siteName = await getSiteName();
  return {
    name: siteName,
    short_name: siteName,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#f4f3f8",
    theme_color: "#221c3d",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
