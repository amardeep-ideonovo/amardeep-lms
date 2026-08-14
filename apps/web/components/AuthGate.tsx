"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { STR } from "@lms/types";
import { getToken } from "@/lib/api";

// Client-side auth wrapper: redirects to /login when no member token is present.
// Wrap protected pages with this so unauthenticated users never see content.
//
// The gate resolves in a post-hydration effect (the token lives in
// localStorage, invisible to SSR), so `fallback` is what the visitor stares at
// from first paint until the JS bundle lands — pass the page's skeleton to show
// real perceived progress on a hard reload instead of a bare spinner. It must
// not contain member data (it renders for logged-out visitors too, briefly,
// before the /login redirect).
export default function AuthGate({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
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
      <>
        {fallback ?? (
          <div className="centered-state">
            <div className="spinner" aria-label={STR.common.loadingLabel} />
          </div>
        )}
      </>
    );
  }

  return <>{children}</>;
}
