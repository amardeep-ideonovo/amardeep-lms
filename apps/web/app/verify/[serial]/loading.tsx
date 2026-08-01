import { PageSkeleton } from "@/components/RouteLoading";

export default function Loading() {
  return (
    <PageSkeleton titleWidth={280} subtitleWidth={360}>
      <div className="ik-skel" style={{ height: 240, borderRadius: 18 }} />
    </PageSkeleton>
  );
}
