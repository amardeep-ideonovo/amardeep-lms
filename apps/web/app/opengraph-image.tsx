import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/seo";

// Default social-share image. Auto-applied to every route that doesn't set its
// own `openGraph.images` (and reused as the Twitter image fallback). Generated
// at the edge so there's no binary asset to maintain.
export const runtime = "edge";
export const alt = SITE_NAME;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
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
        <div style={{ display: "flex" }}>{SITE_NAME}</div>
        <div style={{ display: "flex", fontSize: 34, fontWeight: 400, marginTop: 16, opacity: 0.9 }}>
          Courses &amp; memberships
        </div>
      </div>
    ),
    { ...size }
  );
}
