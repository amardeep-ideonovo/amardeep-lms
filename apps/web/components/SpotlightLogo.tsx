// Spark brand mark (teal four-point spark — direction 5B, from the Spark brand
// pack). Used as the DEFAULT brand glyph wherever the admin header config
// provides no logo (nav, auth band, certificate cards).
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
      <path
        d="M12 1.7C12.93 7.35 16.65 11.07 22.3 12C16.65 12.93 12.93 16.65 12 22.3C11.07 16.65 7.35 12.93 1.7 12C7.35 11.07 11.07 7.35 12 1.7Z"
        fill="#34c9a2"
      />
    </svg>
  );
}
