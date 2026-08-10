import DashboardSkeleton from "@/components/DashboardSkeleton";

// Client-side navigations to /dashboard show the same shimmer the page itself
// uses, instead of a bare spinner — one continuous loading look.
export default function Loading() {
  return <DashboardSkeleton />;
}
