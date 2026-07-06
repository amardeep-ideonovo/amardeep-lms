import type { ReactNode } from "react";
import { Shell } from "@/components/Shell";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return <Shell role="client">{children}</Shell>;
}
