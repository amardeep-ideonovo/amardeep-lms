import { PageSkeleton, ProseSkeleton } from "@/components/RouteLoading";

export default function Loading() {
  return (
    <PageSkeleton titleWidth={260} subtitleWidth={320}>
      <ProseSkeleton lines={5} />
    </PageSkeleton>
  );
}
