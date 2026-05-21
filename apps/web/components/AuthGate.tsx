"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";

// Client-side auth wrapper: redirects to /login when no member token is present.
// Wrap protected pages with this so unauthenticated users never see content.
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <div className="centered-state">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }

  return <>{children}</>;
}
