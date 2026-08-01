// Route-transition placeholders. Next renders these from the moment a link is
// clicked until the segment's component mounts — without them a navigation
// paints nothing at all, because every member page is a client component that
// only starts fetching after hydration.
//
// Two shapes, and which one a route uses is not cosmetic:
//
// - RouteSpinner is for pages wrapped in <AuthGate/>. AuthGate renders this
//   exact markup while it reads the token, so anything else here would flash
//   into a spinner one frame later. Matching it keeps one continuous spinner
//   from click to content.
// - PageSkeleton is for the public server-rendered pages, which have no
//   AuthGate in front of them and today make the visitor wait on a blank frame
//   for the whole dynamic render.

export function RouteSpinner() {
  return (
    <div className="centered-state">
      <div className="spinner" aria-label="Loading" />
    </div>
  );
}

export function PageSkeleton({
  titleWidth = 260,
  subtitleWidth = 380,
  children,
}: {
  titleWidth?: number;
  subtitleWidth?: number;
  children?: React.ReactNode;
}) {
  return (
    // The bars are decoration, so they stay out of the accessibility tree
    // entirely — a live region wrapping the whole shell would make a screen
    // reader read out the placeholder layout. One status line says it instead.
    <div className="ink-page" aria-busy="true">
      <span className="sr-only" role="status">
        Loading
      </span>
      <div className="ik-band" aria-hidden="true">
        <div className="ik-band-inner">
          <div
            className="ik-skel ik-skel--ink"
            style={{ width: titleWidth, height: 34, maxWidth: "100%" }}
          />
          <div
            className="ik-skel ik-skel--ink"
            style={{
              width: subtitleWidth,
              height: 16,
              marginTop: 12,
              maxWidth: "100%",
            }}
          />
        </div>
      </div>
      <div className="ik-main" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}

// A stack of paragraph bars — stands in for prose while an article renders.
export function ProseSkeleton({ lines = 6 }: { lines?: number }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="ik-skel"
          style={{
            height: 14,
            borderRadius: 6,
            // Ragged right edge, so it reads as text rather than as a table.
            width: i === lines - 1 ? "58%" : i % 3 === 0 ? "92%" : "100%",
          }}
        />
      ))}
    </div>
  );
}
