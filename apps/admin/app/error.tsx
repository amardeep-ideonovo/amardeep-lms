"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { buttonClass } from "@lms/ui";
import { STR } from "@lms/types";

// Branded route-error boundary for the admin — replaces the page content (inside
// the admin shell) when a segment throws. We NEVER surface the raw error message
// or stack; the optional `digest` is a support-correlatable hash Next logs
// server-side.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    console.error(error);
    // The boundary swaps in place, so move focus to the heading — otherwise a
    // keyboard/screen-reader user is never told the view became an error state
    // (WCAG 2.4.3 / 4.1.3). Next manages no focus here itself.
    headingRef.current?.focus();
  }, [error]);

  return (
    <div className="error-state">
      <div className="error-state__icon" aria-hidden="true">
        <svg
          width="56"
          height="56"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </svg>
      </div>
      <h1 ref={headingRef} tabIndex={-1} className="error-state__title">
        {STR.errors.errorTitle}
      </h1>
      <p className="error-state__body">{STR.errors.errorBody}</p>
      <div className="error-state__actions">
        <button type="button" className={buttonClass()} onClick={() => reset()}>
          {STR.common.retry}
        </button>
        <Link href="/" className={buttonClass({ variant: "secondary" })}>
          {STR.errors.backHome}
        </Link>
      </div>
      {error.digest ? (
        <p className="error-state__ref">
          {STR.errors.referenceId}: <code>{error.digest}</code>
        </p>
      ) : null}
    </div>
  );
}
