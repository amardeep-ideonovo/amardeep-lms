import type { Metadata } from "next";
import type { CertificateVerifyDTO } from "@lms/types";
import { apiBase } from "@/lib/api";

export const metadata: Metadata = {
  title: "Verify certificate",
  robots: { index: false }, // serials are private-ish; no need to index
};

// Public certificate verification — the serial is printed on every issued
// PDF. Server component, no auth: anyone given a certificate can confirm it
// here. Unknown serials get a neutral "not found" (no oracle beyond the
// serial itself).
export default async function VerifyCertificatePage({
  params,
}: {
  params: { serial: string };
}) {
  const serial = decodeURIComponent(params.serial);
  let result: CertificateVerifyDTO = { valid: false };
  try {
    const res = await fetch(
      `${apiBase()}/certificates/verify/${encodeURIComponent(serial)}`,
      { cache: "no-store" },
    );
    if (res.ok) result = (await res.json()) as CertificateVerifyDTO;
  } catch {
    /* API unreachable — render the invalid state below */
  }

  return (
    <div className="account-cinema">
      <div className="ac-wrap" style={{ maxWidth: 620 }}>
        <h1 className="page-title">Certificate verification</h1>
        {result.valid ? (
          <section className="account-section" style={{ marginTop: 22 }}>
            <p
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                color: "var(--ac-green)",
                fontWeight: 700,
                margin: "0 0 16px",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M20 6 9 17l-5-5"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Valid certificate
            </p>
            <dl className="detail-list">
              <div>
                <dt>Awarded to</dt>
                <dd>{result.memberName}</dd>
              </div>
              <div>
                <dt>Class</dt>
                <dd>{result.className}</dd>
              </div>
              <div>
                <dt>Issued</dt>
                <dd>
                  {result.issuedAt
                    ? new Date(result.issuedAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Serial</dt>
                <dd style={{ fontFamily: "monospace" }}>{serial}</dd>
              </div>
            </dl>
          </section>
        ) : (
          <section className="account-section" style={{ marginTop: 22 }}>
            <p style={{ margin: 0 }}>
              No certificate found for code{" "}
              <span style={{ fontFamily: "monospace" }}>{serial}</span>. Check
              the serial printed on the certificate and try again.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
