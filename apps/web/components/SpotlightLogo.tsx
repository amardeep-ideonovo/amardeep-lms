// Spotlight brand mark (teal beam + light pool) — copied from the Ink Hero
// design frames. Used as the DEFAULT brand glyph wherever the admin header
// config provides no logo (nav, auth band, certificate cards).
export default function SpotlightLogo({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 2.2 11.6 6 7.8 12.6 1.2 8.8Z" fill="#3cc4b2" />
      <ellipse cx="14.8" cy="18.6" rx="6.8" ry="2.9" fill="rgba(60,196,178,.32)" />
    </svg>
  );
}
