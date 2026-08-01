import { PageSkeleton, ProseSkeleton } from "@/components/RouteLoading";

export default function Loading() {
  return (
    <PageSkeleton titleWidth={420} subtitleWidth={240}>
      <ProseSkeleton lines={8} />
    </PageSkeleton>
  );
}
