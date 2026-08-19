// Dashboard shimmer: band + overview card + class-card grid. Pure markup (no
// client hooks) so it can be server-rendered as the FIRST PAINT of /dashboard —
// it is the AuthGate fallback and the route loading state, and the page keeps
// showing it until the member's classes arrive. Keeping every consumer on this
// one component means the skeleton never drifts from the real layout — every
// block below mirrors a real element's dimensions (band row + Resume CTA,
// 92px-ring overview, 22px section title, 300px class cards, the two-column
// continue-learning band) so the content swap happens IN PLACE, with no jump.
export default function DashboardSkeleton() {
  return (
    <div className="ink-page">
      <div className="ik-band">
        <div className="ik-band-inner">
          <div className="ik-band-row">
            <div className="ik-grow">
              <div
                className="ik-skel ik-skel--ink"
                style={{ width: 320, height: 34 }}
              />
              <div
                className="ik-skel ik-skel--ink"
                style={{ width: 420, height: 16, marginTop: 12 }}
              />
            </div>
            {/* Resume CTA stand-in (13px pad + 13.5px label ≈ 44px tall) */}
            <div
              className="ik-skel ik-skel--ink"
              style={{ width: 280, height: 44, borderRadius: 10 }}
            />
          </div>
        </div>
      </div>
      <div className="ik-main">
        {/* Overview card: 26/30 padding + 92px ring, like .ik-overview */}
        <div className="ik-overview">
          <div
            className="ik-skel"
            style={{ width: 92, height: 92, borderRadius: "50%", flex: "none" }}
          />
          <div className="ik-overview-main">
            <div className="ik-skel" style={{ width: 200, height: 17 }} />
            <div
              className="ik-skel"
              style={{ width: 130, height: 12, marginTop: 8 }}
            />
            <div
              className="ik-skel"
              style={{ width: 280, height: 12, marginTop: 16 }}
            />
          </div>
          <div className="ik-overview-actions">
            <div
              className="ik-skel"
              style={{ width: 120, height: 44, borderRadius: 10 }}
            />
            <div
              className="ik-skel"
              style={{ width: 128, height: 44, borderRadius: 10 }}
            />
          </div>
        </div>

        {/* Section head ("My Current Classes"), same 30/18 margins */}
        <div className="ik-section-head">
          <div className="ik-skel" style={{ width: 210, height: 22 }} />
          <div className="ik-skel" style={{ width: 64, height: 13 }} />
        </div>
        <div className="ik-class-grid">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="ik-skel"
              style={{ height: 300, borderRadius: 18 }}
            />
          ))}
        </div>

        {/* Continue-learning + live-session two-column band */}
        <div className="ik-cols">
          <div className="ik-panel">
            <div className="ik-skel" style={{ width: 150, height: 15 }} />
            {[0, 1].map((i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 13,
                  padding: "12px 0",
                  marginTop: i === 0 ? 8 : 0,
                }}
              >
                <div
                  className="ik-skel"
                  style={{ width: 64, height: 44, borderRadius: 9 }}
                />
                <div style={{ flex: 1 }}>
                  <div
                    className="ik-skel"
                    style={{ width: "60%", height: 13 }}
                  />
                  <div
                    className="ik-skel"
                    style={{ width: "40%", height: 11, marginTop: 6 }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="ik-skel" style={{ height: 170, borderRadius: 16 }} />
        </div>
      </div>
    </div>
  );
}
