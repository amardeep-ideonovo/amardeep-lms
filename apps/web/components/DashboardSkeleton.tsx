// Dashboard shimmer: band + overview card + class-card grid. Pure markup (no
// client hooks) so it can be server-rendered as the FIRST PAINT of /dashboard —
// it is the AuthGate fallback and the route loading state, and the page keeps
// showing it until the member's classes arrive. Keeping every consumer on this
// one component means the skeleton never drifts from the real layout.
export default function DashboardSkeleton() {
  return (
    <div className="ink-page">
      <div className="ik-band">
        <div className="ik-band-inner">
          <div
            className="ik-skel ik-skel--ink"
            style={{ width: 320, height: 34 }}
          />
          <div
            className="ik-skel ik-skel--ink"
            style={{ width: 420, height: 16, marginTop: 12 }}
          />
        </div>
      </div>
      <div className="ik-main">
        <div
          className="ik-skel"
          style={{
            height: 144,
            borderRadius: 18,
            background: "var(--surface)",
          }}
        />
        <div className="ik-class-grid" style={{ marginTop: 30 }}>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="ik-skel"
              style={{ height: 218, borderRadius: 18 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
