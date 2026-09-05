"use client";

/* eslint-disable no-restricted-syntax -- global-error replaces the root <html>,
   so it can't reach globals.css / tokens.css; the Spark brand colors are inlined
   as literal hex here on purpose (there is no token layer available). */
import { useEffect } from "react";
import { STR } from "@lms/types";

// Last-resort boundary for an error thrown in the admin ROOT layout itself,
// which the normal error.tsx cannot reach. It REPLACES <html>/<body>, so it
// can't use the admin shell or globals.css — styles are inlined with the Spark
// ink palette so it stays branded even when everything else is broken.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          background: "#221c3d",
          color: "#f4f3f8",
          fontFamily:
            "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ maxWidth: 460, textAlign: "center" }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 8px" }}>
            {STR.errors.errorTitle}
          </h1>
          <p style={{ color: "#c9c5da", lineHeight: 1.5, margin: "0 0 22px" }}>
            {STR.errors.errorBody}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              font: "inherit",
              fontWeight: 600,
              padding: "11px 22px",
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              color: "#ffffff",
              background: "linear-gradient(100deg, #4fcdb8, #2f9d8e)",
            }}
          >
            {STR.common.retry}
          </button>
          {error.digest ? (
            <p style={{ color: "#8b87a3", fontSize: 13, marginTop: 18 }}>
              {STR.errors.referenceId}: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
