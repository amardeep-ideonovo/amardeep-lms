import { PageSkeleton } from "@/components/RouteLoading";

export default function Loading() {
  return (
    <PageSkeleton titleWidth={340} subtitleWidth={420}>
      <div className="ik-skel" style={{ height: 210, borderRadius: 18 }} />
      <div className="ik-class-grid" style={{ marginTop: 30 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="ik-skel"
            style={{ height: 180, borderRadius: 18 }}
          />
        ))}
      </div>
    </PageSkeleton>
  );
}
