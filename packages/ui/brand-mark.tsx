// @lms/ui/brand-mark — THE shared brand glyph for the two Next apps (web +
// admin), same "single source + thin call sites" pattern as
// @lms/types/class-accents. Until now the "Spark" four-point spark SVG was
// hand-copied in four places (web Nav/login/signup/certificates via a local
// SpotlightLogo, web's OG image, admin Sidebar, admin login); they all render
// THIS now, so a rebrand of the mark touches one file.
//
// Mobile (React Native) can't consume this DOM component — it has its own
// pure-RN mark in apps/mobile/src/components/BrandMark.tsx.
import React from "react";

// The spark path + its fill, exported separately so next/og (Satori) — which
// builds the OpenGraph image and can't mount a live React component — can inline
// the identical glyph from the same source.
export const SPARK_PATH =
  "M12 1.7C12.93 7.35 16.65 11.07 22.3 12C16.65 12.93 12.93 16.65 12 22.3C11.07 16.65 7.35 12.93 1.7 12C7.35 11.07 11.07 7.35 12 1.7Z";

// Brand-mark mint. A JS constant because an SVG `fill` needs a literal string
// and can't read the CSS token system — keep it in step with the brand.
export const BRAND_MARK_COLOR = "#34c9a2";

// Canonical brand teal — the JS mirror of `--teal` in @lms/ui/tokens.css. Use
// this where a real JS color string is unavoidable (SVG/chart attrs, default
// swatch values) instead of a raw hex, per docs/coding-standards.md D3.
export const BRAND_TEAL = "#3cc4b2";

export function BrandMark({
  size = 26,
  color = BRAND_MARK_COLOR,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d={SPARK_PATH} fill={color} />
    </svg>
  );
}
