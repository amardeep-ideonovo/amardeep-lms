import { PageSkeleton } from "@/components/RouteLoading";

export default function Loading() {
  return (
    <PageSkeleton titleWidth={200} subtitleWidth={340}>
      <div className="ik-class-grid ik-class-grid--3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="ik-skel" style={{ height: 218, borderRadius: 18 }} />
        ))}
      </div>
    </PageSkeleton>
  );
}
