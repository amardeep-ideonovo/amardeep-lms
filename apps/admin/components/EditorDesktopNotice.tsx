"use client";

import { useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

// True when the viewport is too narrow for the drag-and-drop builders (Puck
// page/popup editors, the certificate designer). useSyncExternalStore keeps the
// SSR + first-paint snapshot `false` (so there's no hydration mismatch), then
// reflects the live media query and re-renders on resize/rotate.
export function useIsNarrow(maxWidth = 820): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(`(max-width:${maxWidth}px)`);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(`(max-width:${maxWidth}px)`).matches,
    () => false,
  );
}

// Graceful "this needs a bigger screen" gate shown in place of a drag-and-drop
// builder on phones / narrow tablets. `fixed` fills the viewport (for the
// full-screen Puck editors whose chrome is hidden); the inline default fills
// the content area (for the in-shell certificate designer).
export function EditorDesktopNotice({
  backHref,
  backLabel = "Back",
  what = "This editor",
  fixed = false,
}: {
  backHref: string;
  backLabel?: string;
  what?: string;
  fixed?: boolean;
}) {
  const router = useRouter();
  return (
    <div className={fixed ? "editor-gate editor-gate--fixed" : "editor-gate"}>
      <div className="editor-gate-card">
        <svg
          width="42"
          height="42"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="2"
            y="4"
            width="20"
            height="13"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path
            d="M8 20h8M12 17v3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        <h2>Best edited on a larger screen</h2>
        <p>
          {what} is a drag-and-drop builder that needs a wider window. Open this
          page on a desktop, laptop, or a tablet in landscape to edit it.
        </p>
        <button className="btn" onClick={() => router.push(backHref)}>
          ← {backLabel}
        </button>
      </div>
    </div>
  );
}
