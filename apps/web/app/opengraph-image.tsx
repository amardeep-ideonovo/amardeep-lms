import { ImageResponse } from "next/og";
import { headers } from "next/headers";
import { SITE_NAME, getSiteName } from "@/lib/seo";

// Default social-share image. Auto-applied to every route that doesn't set its
// own `openGraph.images` (and reused as the Twitter image fallback). Rendered on
// the Node runtime (not edge) so it can resolve the per-instance brand from the
// API the same way the rest of the metadata does — no binary asset to maintain.
export const runtime = "nodejs";
export const alt = SITE_NAME;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  // Touch headers() to opt OUT of static prerendering (`export const dynamic` is
  // NOT honored for metadata routes): the headline must resolve from each
  // instance's live AppConfig.title at request time, not the shared build-time
  // fallback baked into the one prebuilt fleet image.
  headers();
  const siteName = await getSiteName();
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #221c3d 0%, #2f9d8e 130%)",
          color: "#ffffff",
          fontSize: 84,
          fontWeight: 700,
          letterSpacing: -1,
        }}
      >
        <div style={{ display: "flex" }}>{siteName}</div>
        <div style={{ display: "flex", fontSize: 34, fontWeight: 400, marginTop: 16, opacity: 0.9 }}>
          Courses &amp; memberships
        </div>
      </div>
    ),
    { ...size }
  );
}
