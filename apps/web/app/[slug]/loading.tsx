import { PageSkeleton, ProseSkeleton } from "@/components/RouteLoading";

export default function Loading() {
  return (
    <PageSkeleton>
      <ProseSkeleton lines={7} />
    </PageSkeleton>
  );
}
