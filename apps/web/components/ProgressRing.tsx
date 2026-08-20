// Shared progress rings for the Ink Hero class/course pages. Extracted so the
// class page (band ring + certificate/progress card) and the course page (its
// own band ring + progress card) render the SAME ring instead of two copies.
//
// The teal stroke is a literal (#3cc4b2) because SVG stroke attributes can't
// read a CSS var — keep it in step with --teal if the brand ring colour moves.

// 72px band progress ring — sits on the dark hero band (white text/track).
export function BandRing({ pct }: { pct: number }) {
  const C = 2 * Math.PI * 30.5; // ≈191.6
  const arc = Math.max(0, Math.min(100, pct)) * (C / 100);
  return (
    <svg
      className="ik-ring"
      width="72"
      height="72"
      viewBox="0 0 72 72"
      aria-label={`${pct}% complete`}
    >
      <circle
        cx="36"
        cy="36"
        r="30.5"
        fill="none"
        stroke="rgba(255,255,255,.15)"
        strokeWidth="7"
      />
      <circle
        cx="36"
        cy="36"
        r="30.5"
        fill="none"
        stroke="#3cc4b2"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${arc} ${C}`}
        transform="rotate(-90 36 36)"
      />
      <text
        x="36"
        y="41.6"
        textAnchor="middle"
        fontSize="16"
        fontWeight="700"
        fill="#fff"
      >
        {pct}%
      </text>
    </svg>
  );
}

// 84px ink ring — sits inside the dark certificate / progress rail card.
export function CertRing({ pct }: { pct: number }) {
  const C = 2 * Math.PI * 36; // ≈226.2
  const arc = Math.max(0, Math.min(100, pct)) * (C / 100);
  return (
    <svg
      className="ik-ring"
      width="84"
      height="84"
      viewBox="0 0 84 84"
      aria-hidden="true"
    >
      <circle
        cx="42"
        cy="42"
        r="36"
        fill="none"
        stroke="rgba(255,255,255,.14)"
        strokeWidth="8"
      />
      <circle
        cx="42"
        cy="42"
        r="36"
        fill="none"
        stroke="#3cc4b2"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${arc} ${C}`}
        transform="rotate(-90 42 42)"
      />
      <text
        x="42"
        y="48.3"
        textAnchor="middle"
        fontSize="18"
        fontWeight="700"
        fill="#fff"
      >
        {pct}%
      </text>
    </svg>
  );
}
