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
          background: "#101014",
          color: "#ffffff",
          fontSize: 84,
          fontWeight: 700,
          letterSpacing: -1,
        }}
      >
        {/* Spark mark above the wordmark, as in the brand lockup */}
        <svg width="76" height="76" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 1.7C12.93 7.35 16.65 11.07 22.3 12C16.65 12.93 12.93 16.65 12 22.3C11.07 16.65 7.35 12.93 1.7 12C7.35 11.07 11.07 7.35 12 1.7Z"
            fill="#34c9a2"
          />
        </svg>
        <div style={{ display: "flex", marginTop: 28 }}>{siteName}</div>
        <div
          style={{
            display: "flex",
            fontSize: 34,
            fontWeight: 400,
            marginTop: 16,
            color: "#8b8a87",
          }}
        >
          Courses &amp; memberships
        </div>
      </div>
    ),
    { ...size }
  );
}
