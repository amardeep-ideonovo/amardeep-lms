"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, setCachedMe, storePreviewPair } from "@/lib/api";

// Handoff landing for the admin "preview the member site" flow. The admin
// dashboard opens /preview?token=<handoff>; we exchange that single-use,
// short-lived handoff for the two READ-ONLY preview session tokens, store both
// (so the banner can flip locked⇄unlocked), make the unlocked/paid view active,
// then replace the URL to the real destination — which strips the token from
// history. The member never types anything: the handoff is the sole credential.
function PreviewExchange() {
  const params = useSearchParams();
  const router = useRouter();
  const handoff = params.get("token");
  // Only allow same-origin internal paths (no open redirect via ?to=). Must be
  // a single leading slash: reject "//host" (protocol-relative) and "/\\host",
  // both of which the browser would resolve to an external origin.
  const rawTo = params.get("to") ?? "/dashboard";
  const to =
    rawTo.startsWith("/") && !rawTo.startsWith("//") && !rawTo.startsWith("/\\")
      ? rawTo
      : "/dashboard";
  const expired = params.get("expired") === "1";

  const [failed, setFailed] = useState(expired || !handoff);
  // The handoff is single-use + ~60s; guard against React strict-mode's
  // double-invoked effect firing the exchange (and consuming it) twice.
  const started = useRef(false);

  useEffect(() => {
    if (expired || !handoff || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const { unlockedToken, lockedToken } =
          await api.exchangePreview(handoff);
        storePreviewPair(unlockedToken, lockedToken, "unlocked");
        // Warm the me-cache so the banner + 401 handler see isPreview/previewMode
        // immediately (this also validates the freshly-minted session).
        try {
          setCachedMe(await api.me());
        } catch {
          /* non-fatal — the banner will resolve via useMe() shortly */
        }
        router.replace(to);
      } catch {
        // Expired/already-used/invalid handoff, or a transient network error —
        // all land on the same "preview ended" state (no member data shown).
        setFailed(true);
      }
    })();
  }, [expired, handoff, router, to]);

  if (failed) {
    return (
      <>
        <h1>
          Preview <span className="t-gradient">ended</span>
        </h1>
        <p className="sub">
          This preview link has expired or was already used. Start a new preview
          from the admin dashboard.
        </p>
        <p className="sub" style={{ marginTop: 16 }}>
          <Link href="/" className="link">
            Go to the site
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>
        Opening <span className="t-gradient">preview…</span>
      </h1>
      <p className="sub">Setting up your read-only view of the member site.</p>
    </>
  );
}

// useSearchParams needs a Suspense boundary for the static prerender.
export default function PreviewPage() {
  return (
    <div className="dark-page">
      <div className="dp-wrap">
        <div className="form-card">
          <Suspense fallback={null}>
            <PreviewExchange />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
