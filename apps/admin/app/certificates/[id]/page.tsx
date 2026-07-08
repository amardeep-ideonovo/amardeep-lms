"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type {
  CertificateFieldKind,
  CertificateFieldLayout,
  CertificateFontId,
} from "@lms/types";
import { CERTIFICATE_FONTS } from "@lms/types";
import { api, API_BASE_URL, ApiError } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";
import MediaPicker from "@/components/MediaPicker";
import ColorField from "@/components/ColorField";

// Visual certificate-template editor. The right side renders the uploaded
// artwork with the dynamic text fields as draggable boxes; everything is
// stored as percentages of the artwork, and the PDF renderer draws with the
// SAME math and the SAME font bytes (@font-face below loads /cert-fonts/*),
// so what you position here is what the member's PDF shows.

const FIELD_LABELS: Record<CertificateFieldKind, string> = {
  memberName: "Member name",
  className: "Class name",
  issueDate: "Issue date",
  serial: "Serial number",
};

const SAMPLE: Record<CertificateFieldKind, string> = {
  memberName: "Jordan Membersmith",
  className: "Music Production & Songwriting",
  issueDate: new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date()),
  serial: "CERT-2026-SAMPLE",
};

// Starter layout for new templates — centered name/class, date + serial in
// the bottom corners (all adjustable, of course).
const DEFAULT_FIELDS: CertificateFieldLayout[] = [
  { kind: "memberName", enabled: true, xPct: 10, yPct: 42, widthPct: 80, align: "center", fontFamily: "greatvibes", fontSizePct: 7, color: "#101828", uppercase: false },
  { kind: "className", enabled: true, xPct: 10, yPct: 58, widthPct: 80, align: "center", fontFamily: "playfair", fontSizePct: 3.6, color: "#101828", uppercase: false },
  { kind: "issueDate", enabled: true, xPct: 8, yPct: 88, widthPct: 30, align: "left", fontFamily: "inter", fontSizePct: 1.6, color: "#52525b", uppercase: false },
  { kind: "serial", enabled: true, xPct: 62, yPct: 88, widthPct: 30, align: "right", fontFamily: "inter", fontSizePct: 1.3, color: "#52525b", uppercase: false, letterSpacing: 0.06 },
];

type DragState = {
  kind: CertificateFieldKind;
  mode: "move" | "width";
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
  baseW: number;
  rectW: number;
  rectH: number;
};

export default function CertificateTemplateEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { can, loading: authLoading } = useAdminAuth();
  const isNew = params.id === "new";
  const canEdit = isNew ? can("certificates", "create") : can("certificates", "edit");

  const [name, setName] = useState("");
  const [artworkUrl, setArtworkUrl] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [fields, setFields] = useState<CertificateFieldLayout[]>(DEFAULT_FIELDS);
  const [selected, setSelected] = useState<CertificateFieldKind>("memberName");
  const [loaded, setLoaded] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const previewRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (isNew) return;
    api
      .getCertificateTemplate(params.id)
      .then((t) => {
        setName(t.name);
        setArtworkUrl(t.artworkUrl);
        setIsDefault(t.isDefault);
        // Merge stored fields over the defaults so older rows still expose
        // every editable field row.
        setFields(
          DEFAULT_FIELDS.map((d) => t.fields.find((f) => f.kind === d.kind) ?? { ...d, enabled: d.kind === "memberName" || d.kind === "className" }),
        );
        setLoaded(true);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load"));
  }, [isNew, params.id]);

  // @font-face for the exact TTFs the PDF embeds (served by the API).
  const fontCss = useMemo(
    () =>
      CERTIFICATE_FONTS.map(
        (f) => `@font-face { font-family: "cert-${f.id}"; src: url("${API_BASE_URL}/cert-fonts/${f.file}") format("truetype"); font-display: block; }`,
      ).join("\n"),
    [],
  );

  const sel = fields.find((f) => f.kind === selected) ?? fields[0];

  const patchField = useCallback(
    (kind: CertificateFieldKind, patch: Partial<CertificateFieldLayout>) => {
      setFields((prev) => prev.map((f) => (f.kind === kind ? { ...f, ...patch } : f)));
      setSavedAt(null);
    },
    [],
  );

  // ----- drag (pointer events; % deltas against the preview box) -----

  const onPointerDown = (e: React.PointerEvent, kind: CertificateFieldKind, mode: "move" | "width") => {
    if (!canEdit) return;
    const rect = previewRef.current?.getBoundingClientRect();
    const f = fields.find((x) => x.kind === kind);
    if (!rect || !f) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(kind);
    dragRef.current = {
      kind,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      baseX: f.xPct,
      baseY: f.yPct,
      baseW: f.widthPct,
      rectW: rect.width,
      rectH: rect.height,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = ((e.clientX - d.startX) / d.rectW) * 100;
    const dy = ((e.clientY - d.startY) / d.rectH) * 100;
    if (d.mode === "move") {
      patchField(d.kind, {
        xPct: clamp(d.baseX + dx, 0, 100),
        yPct: clamp(d.baseY + dy, 0, 100),
      });
    } else {
      patchField(d.kind, { widthPct: clamp(d.baseW + dx, 5, 100) });
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  // Arrow keys nudge the selected box (0.2%, Shift = 1%).
  const onPreviewKeyDown = (e: React.KeyboardEvent) => {
    if (!canEdit || !sel) return;
    const step = e.shiftKey ? 1 : 0.2;
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = move[e.key];
    if (!delta) return;
    e.preventDefault();
    patchField(sel.kind, {
      xPct: clamp(sel.xPct + delta[0], 0, 100),
      yPct: clamp(sel.yPct + delta[1], 0, 100),
    });
  };

  // ----- save / delete -----

  const save = async () => {
    if (!name.trim()) {
      setError("Give the template a name");
      return;
    }
    if (!artworkUrl) {
      setError("Upload or pick the certificate artwork first");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const created = await api.createCertificateTemplate({
          name: name.trim(),
          artworkUrl,
          fields,
          isDefault,
        });
        router.replace(`/certificates/${created.id}`);
      } else {
        const updated = await api.updateCertificateTemplate(params.id, {
          name: name.trim(),
          artworkUrl,
          fields,
          ...(isDefault ? { isDefault: true } : {}),
        });
        setIsDefault(updated.isDefault);
        setFields(DEFAULT_FIELDS.map((d) => updated.fields.find((f) => f.kind === d.kind) ?? d));
      }
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await dialog.confirm({
      title: "Delete template?",
      message: "Issued certificates keep their PDFs and stay valid — only this design is removed.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteCertificateTemplate(params.id);
      router.push("/certificates");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed");
    }
  };

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("certificates", "read"))
    return <p className="muted">You don’t have permission to view this.</p>;
  if (!loaded && !error) return <p className="muted">Loading…</p>;

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: fontCss }} />
      <div className="page-header with-action">
        <div>
          <h1>{isNew ? "New certificate template" : name || "Certificate template"}</h1>
          <p className="subtitle">
            Drag the fields into place on the artwork — the member’s PDF uses
            the exact same positions and fonts.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {savedAt && <span className="muted">Saved ✓</span>}
          <Link href="/certificates" className="btn btn--ghost">
            Back
          </Link>
          {!isNew && can("certificates", "delete") && (
            <button className="btn btn--danger" onClick={remove}>
              Delete
            </button>
          )}
          {canEdit && (
            <button className="btn" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 22, alignItems: "start" }}>
        {/* ----- left: controls ----- */}
        <div className="card" style={{ display: "grid", gap: 14 }}>
          <div className="field">
            <label>Template name</label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSavedAt(null);
              }}
              placeholder="e.g. Classic Gold"
              disabled={!canEdit}
            />
          </div>

          <div className="field">
            <label>Artwork (PNG/JPG from the gallery)</label>
            <MediaPicker
              value={artworkUrl ? `${API_BASE_URL}${artworkUrl}` : ""}
              onChange={(url) => {
                // Store the /media/<key> path form; the API validates it.
                try {
                  const u = url ? new URL(url, API_BASE_URL) : null;
                  setArtworkUrl(u ? u.pathname : "");
                } catch {
                  setArtworkUrl(url);
                }
                setSavedAt(null);
              }}
              kind="image"
              disabled={!canEdit}
            />
            <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
              Landscape ~1600×1130 works best. Leave the field areas free of
              busy detail.
            </p>
          </div>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => {
                setIsDefault(e.target.checked);
                setSavedAt(null);
              }}
              disabled={!canEdit || (!isNew && isDefault)}
            />
            <span>
              Default template{" "}
              <span className="muted">(used by every class without its own pick)</span>
            </span>
          </label>

          <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: 0 }} />

          {/* field list */}
          <div style={{ display: "grid", gap: 6 }}>
            {fields.map((f) => (
              <div
                key={f.kind}
                onClick={() => setSelected(f.kind)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 10px",
                  borderRadius: 8,
                  cursor: "pointer",
                  border: `1px solid ${selected === f.kind ? "var(--primary, #3cc4b2)" : "var(--border)"}`,
                }}
              >
                <strong style={{ flex: 1, fontSize: 13.5 }}>{FIELD_LABELS[f.kind]}</strong>
                {(f.kind === "issueDate" || f.kind === "serial") && (
                  <input
                    type="checkbox"
                    title="Show on the certificate"
                    checked={f.enabled}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => patchField(f.kind, { enabled: e.target.checked })}
                    disabled={!canEdit}
                  />
                )}
              </div>
            ))}
          </div>

          {/* selected field controls */}
          {sel && (
            <div style={{ display: "grid", gap: 10 }}>
              <strong style={{ fontSize: 13 }}>{FIELD_LABELS[sel.kind]} style</strong>
              <div className="field">
                <label>Font</label>
                <select
                  value={sel.fontFamily}
                  onChange={(e) => patchField(sel.kind, { fontFamily: e.target.value as CertificateFontId })}
                  disabled={!canEdit}
                >
                  {CERTIFICATE_FONTS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>
                  Size <span className="muted">({sel.fontSizePct.toFixed(1)}% of width)</span>
                </label>
                <input
                  type="range"
                  min={0.5}
                  max={15}
                  step={0.1}
                  value={sel.fontSizePct}
                  onChange={(e) => patchField(sel.kind, { fontSizePct: Number(e.target.value) })}
                  disabled={!canEdit}
                />
              </div>
              <div className="field">
                <label>
                  Box width <span className="muted">({Math.round(sel.widthPct)}% — long text shrinks to fit)</span>
                </label>
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={1}
                  value={sel.widthPct}
                  onChange={(e) => patchField(sel.kind, { widthPct: Number(e.target.value) })}
                  disabled={!canEdit}
                />
              </div>
              <div className="field">
                <label>Alignment</label>
                <div style={{ display: "flex", gap: 6 }}>
                  {(["left", "center", "right"] as const).map((a) => (
                    <button
                      key={a}
                      className={sel.align === a ? "btn btn--sm" : "btn btn--ghost btn--sm"}
                      onClick={() => patchField(sel.kind, { align: a })}
                      disabled={!canEdit}
                      type="button"
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              <ColorField
                label="Color"
                value={sel.color}
                onChange={(v) => patchField(sel.kind, { color: v })}
                disabled={!canEdit}
              />
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={sel.uppercase}
                  onChange={(e) => patchField(sel.kind, { uppercase: e.target.checked })}
                  disabled={!canEdit}
                />
                <span>Uppercase</span>
              </label>
              <div className="field">
                <label>
                  Letter spacing <span className="muted">({(sel.letterSpacing ?? 0).toFixed(2)}em)</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={0.5}
                  step={0.01}
                  value={sel.letterSpacing ?? 0}
                  onChange={(e) =>
                    patchField(sel.kind, {
                      letterSpacing: Number(e.target.value) || undefined,
                    })
                  }
                  disabled={!canEdit}
                />
              </div>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Tip: click a box and nudge with arrow keys (Shift = bigger steps).
              </p>
            </div>
          )}
        </div>

        {/* ----- right: live preview ----- */}
        <div>
          {!artworkUrl ? (
            <div
              className="card"
              style={{ display: "grid", placeItems: "center", minHeight: 360, textAlign: "center" }}
            >
              <div>
                <p style={{ fontWeight: 600, marginBottom: 6 }}>No artwork yet</p>
                <p className="muted" style={{ margin: 0 }}>
                  Upload a PNG/JPG on the left — then drag the name, class,
                  date and serial into place here.
                </p>
              </div>
            </div>
          ) : (
            <div
              ref={previewRef}
              tabIndex={0}
              onKeyDown={onPreviewKeyDown}
              style={{
                position: "relative",
                containerType: "inline-size",
                borderRadius: 10,
                overflow: "hidden",
                boxShadow: "0 2px 14px rgba(0,0,0,.18)",
                outline: "none",
                userSelect: "none",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${API_BASE_URL}${artworkUrl}`}
                alt=""
                draggable={false}
                style={{ width: "100%", display: "block" }}
              />
              {fields
                .filter((f) => f.enabled)
                .map((f) => (
                  <div
                    key={f.kind}
                    onPointerDown={(e) => onPointerDown(e, f.kind, "move")}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    title={FIELD_LABELS[f.kind]}
                    style={{
                      position: "absolute",
                      left: `${f.xPct}%`,
                      top: `${f.yPct}%`,
                      width: `${f.widthPct}%`,
                      cursor: canEdit ? "move" : "default",
                      lineHeight: 1,
                      whiteSpace: "nowrap",
                      textAlign: f.align,
                      fontFamily: `"cert-${f.fontFamily}", serif`,
                      fontSize: `${f.fontSizePct}cqw`,
                      color: f.color,
                      letterSpacing: f.letterSpacing ? `${f.letterSpacing}em` : undefined,
                      textTransform: f.uppercase ? "uppercase" : undefined,
                      outline:
                        selected === f.kind
                          ? "1.5px dashed rgba(42,157,141,.9)"
                          : "1px dashed rgba(120,120,140,.45)",
                      outlineOffset: 3,
                    }}
                  >
                    {SAMPLE[f.kind]}
                    {canEdit && selected === f.kind && (
                      <span
                        onPointerDown={(e) => onPointerDown(e, f.kind, "width")}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        title="Drag to resize the box"
                        style={{
                          position: "absolute",
                          right: -7,
                          top: "50%",
                          transform: "translateY(-50%)",
                          width: 12,
                          height: 12,
                          borderRadius: 999,
                          background: "#2a9d8d",
                          cursor: "ew-resize",
                        }}
                      />
                    )}
                  </div>
                ))}
            </div>
          )}
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            Sample values shown. Long member names shrink automatically to fit
            their box on the real PDF.
          </p>
        </div>
      </div>
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
