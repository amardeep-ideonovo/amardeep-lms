// Shared lesson-row state glyphs for the Ink Hero class/course pages, so the
// class page's course accordions and the course page's lesson list draw the
// SAME done/todo marks from one source instead of two copies.
//
// The stroke/fill are literals because SVG presentation attributes can't read a
// CSS var; keep #2a9d8d in step with --teal-text and #777394 with --muted.

// Completed-lesson check.
export const CheckIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M20 6 9 17l-5-5"
      stroke="#2a9d8d"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Not-yet-started lesson play glyph.
export const PlayGlyph = ({
  size = 11,
  fill = "#777394", // AA muted (SVG attr needs a literal; keep in step with --muted)
}: {
  size?: number;
  fill?: string;
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="m8 5 12 7-12 7z" fill={fill} />
  </svg>
);
