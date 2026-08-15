"use client";

import { useState } from "react";
import Link from "next/link";
import type { ClassCertificateStatusDTO, MyCertificateDTO } from "@lms/types";
import { STR } from "@lms/types";
import { api, ApiError } from "@/lib/api";

// "Get certificate" / "Download certificate" — shared by the lesson page and
// the class page (both cinematic dark scopes). Claiming snapshots the member
// name: when the profile has none (status.needsName) a one-field prompt asks
// for the exact name to print before the PDF is issued.
export default function CertificateClaimButton({
  status,
  onClaimed,
}: {
  status: ClassCertificateStatusDTO;
  onClaimed?: (cert: MyCertificateDTO) => void;
}) {
  const [cert, setCert] = useState<MyCertificateDTO | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askName, setAskName] = useState(false);
  const [name, setName] = useState("");

  const claimed = status.claimed || !!cert;
  const serial = cert?.serial ?? status.serial;

  if (!status.eligible && !claimed) return null;

  async function claim(withName?: string) {
    setClaiming(true);
    setError(null);
    try {
      const issued = await api.claimCertificate({
        levelId: status.levelId,
        ...(withName ? { name: withName } : {}),
      });
      setCert(issued);
      setAskName(false);
      onClaimed?.(issued);
      // Hand the fresh PDF over immediately — claiming IS the download intent.
      await api.downloadCertificate(issued);
    } catch (err) {
      if (err instanceof ApiError && err.message === "NAME_REQUIRED") {
        setAskName(true);
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Could not issue the certificate.",
        );
      }
    } finally {
      setClaiming(false);
    }
  }

  async function download() {
    setClaiming(true);
    setError(null);
    try {
      if (cert) {
        await api.downloadCertificate(cert);
        return;
      }
      // Claimed in an earlier session — claim() is idempotent and returns the
      // existing certificate row with its download URL.
      const existing = await api.claimCertificate({ levelId: status.levelId });
      setCert(existing);
      await api.downloadCertificate(existing);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="cert-claim" style={{ display: "grid", gap: 8 }}>
      {claimed ? (
        <>
          {/* Secondary weight: the class card's primary action is "Continue
              learning"; the certificate download is the optional follow-up. */}
          <button
            type="button"
            className="btn btn-secondary press"
            onClick={download}
            disabled={claiming}
            aria-busy={claiming}
          >
            {claiming ? "Preparing…" : "Download certificate"}
          </button>
          {serial && (
            <span style={{ fontSize: 12.5, opacity: 0.75 }}>
              {serial} ·{" "}
              <Link
                href={`/verify/${serial}`}
                style={{ textDecoration: "underline" }}
              >
                verify
              </Link>
            </span>
          )}
        </>
      ) : askName ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void claim(name.trim());
          }}
          style={{ display: "grid", gap: 8, maxWidth: 360 }}
        >
          <label style={{ fontSize: 13.5, fontWeight: 600 }}>
            Name on your certificate
          </label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name"
            maxLength={120}
            style={{
              padding: "10px 12px",
              borderRadius: 9,
              // Inherits the scope's tokens: light border/surface on white
              // panels, white-alpha inside the ink certificate card.
              border: "1px solid var(--border)",
              background: "var(--fill-subtle)",
              color: "inherit",
              font: "inherit",
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              className="btn btn-primary press"
              disabled={claiming || !name.trim()}
              aria-busy={claiming}
            >
              {claiming ? "Issuing…" : "Issue certificate"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setAskName(false)}
            >
              {STR.common.cancel}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="btn btn-primary press"
          disabled={claiming}
          aria-busy={claiming}
          onClick={() => (status.needsName ? setAskName(true) : void claim())}
        >
          {claiming ? "Issuing…" : "Get certificate"}
        </button>
      )}
      {error && (
        <span
          style={{ color: "var(--danger, var(--danger-solid))", fontSize: 13 }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
