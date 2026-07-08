"use client";

import { useEffect, useState } from "react";
import type { AppColorScheme, AppConfig, AppThemePalette } from "@lms/types";
import { ApiError, api } from "@/lib/api";
import ColorField from "@/components/ColorField";
import MediaPicker from "@/components/MediaPicker";

const msg = (e: unknown, fb: string) => (e instanceof ApiError ? e.message : fb);

// The 8 themeable colors, mirroring apps/mobile/src/theme.ts.
const PALETTE_FIELDS: { key: keyof AppThemePalette; label: string }[] = [
  { key: "bg", label: "Background" },
  { key: "surface", label: "Surface" },
  { key: "surfaceMuted", label: "Surface (muted)" },
  { key: "border", label: "Border" },
  { key: "text", label: "Text" },
  { key: "textMuted", label: "Text (muted)" },
  { key: "primary", label: "Primary" },
  { key: "danger", label: "Danger" },
];

export default function AppCustomizationBuilder({
  canEdit,
  onError,
}: {
  canEdit: boolean;
  onError: (m: string | null) => void;
}) {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewMode, setPreviewMode] = useState<"light" | "dark">("dark");

  useEffect(() => {
    api
      .getAppConfig()
      .then((c) => {
        setCfg(c);
        if (c.colorScheme === "light") setPreviewMode("light");
      })
      .catch((e) => onError(msg(e, "Failed to load app config.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!cfg) return <p className="muted">Loading…</p>;
  const ro = !canEdit;

  const upd = (patch: Partial<AppConfig>) => {
    setCfg((c) => (c ? { ...c, ...patch } : c));
    setSaved(false);
  };
  const updPalette = (
    mode: "light" | "dark",
    patch: Partial<AppThemePalette>,
  ) => {
    setCfg((c) => (c ? { ...c, [mode]: { ...c[mode], ...patch } } : c));
    setSaved(false);
  };

  async function save() {
    if (!cfg) return;
    setBusy(true);
    onError(null);
    try {
      const next = await api.updateAppConfig({ appConfig: cfg });
      setCfg(next);
      setSaved(true);
    } catch (e) {
      onError(msg(e, "Failed to save app config."));
    } finally {
      setBusy(false);
    }
  }

  const renderPalette = (mode: "light" | "dark") => (
    <div className="card">
      <h2>{mode === "light" ? "Light theme colors" : "Dark theme colors"}</h2>
      <div className="form-row" style={{ flexWrap: "wrap" }}>
        {PALETTE_FIELDS.map((f) => (
          <ColorField
            key={f.key}
            label={f.label}
            value={cfg[mode][f.key]}
            disabled={ro}
            onChange={(v) => updPalette(mode, { [f.key]: v })}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div
      style={{
        display: "flex",
        gap: 24,
        alignItems: "flex-start",
        flexWrap: "wrap",
      }}
    >
      {/* ---------- edit panel ---------- */}
      <div
        style={{
          flex: "1 1 440px",
          minWidth: 320,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* brand */}
        <div className="card">
          <h2>Brand</h2>
          <div className="field">
            <label>App title</label>
            <input
              value={cfg.title}
              disabled={ro}
              maxLength={80}
              placeholder="LMS"
              onChange={(e) => upd({ title: e.target.value })}
            />
          </div>
          <div className="field">
            <label>
              Tagline <span className="muted">(optional)</span>
            </label>
            <input
              value={cfg.tagline ?? ""}
              disabled={ro}
              placeholder="A short line shown under the logo"
              onChange={(e) => upd({ tagline: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label>
              Description <span className="muted">(optional)</span>
            </label>
            <textarea
              value={cfg.description ?? ""}
              disabled={ro}
              placeholder="A longer blurb shown on the login / account screen"
              onChange={(e) => upd({ description: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label>
              Logo <span className="muted">(blank = the title text)</span>
            </label>
            <MediaPicker
              value={cfg.logoUrl ?? ""}
              disabled={ro}
              onChange={(url) => upd({ logoUrl: url || null })}
            />
          </div>
        </div>

        {/* appearance / mode */}
        <div className="card">
          <h2>Appearance</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>
            Colors below default to the member website&rsquo;s theme — change
            them only if you want the app to look different.
          </p>
          <div className="form-row">
            <div className="field" style={{ flex: 1 }}>
              <label>Color scheme</label>
              <select
                value={cfg.colorScheme}
                disabled={ro}
                onChange={(e) =>
                  upd({ colorScheme: e.target.value as AppColorScheme })
                }
              >
                <option value="system">Follow device</option>
                <option value="light">Always light</option>
                <option value="dark">Always dark</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Preview</label>
              <div className="row-actions">
                <button
                  type="button"
                  className={
                    previewMode === "light" ? "btn btn--sm" : "btn btn--ghost btn--sm"
                  }
                  onClick={() => setPreviewMode("light")}
                >
                  Light
                </button>
                <button
                  type="button"
                  className={
                    previewMode === "dark" ? "btn btn--sm" : "btn btn--ghost btn--sm"
                  }
                  onClick={() => setPreviewMode("dark")}
                >
                  Dark
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* colors */}
        {renderPalette("light")}
        {renderPalette("dark")}

        {/* app icon & splash */}
        <div className="card">
          <h2>App icon &amp; splash</h2>
          <p
            className="muted"
            style={{
              fontSize: 13,
              marginTop: -4,
              marginBottom: 12,
              borderLeft: "3px solid var(--amber, #f59e0b)",
              paddingLeft: 10,
            }}
          >
            ⚠ The installed app icon and launch splash are part of the app build:
            they don’t update live like the colors above. Upload{" "}
            <strong>PNG</strong>s (icon 1024×1024 opaque, splash ≥1242×2436) —
            the next app build bakes them in automatically; a store submission
            is still required.
          </p>
          <div className="field">
            <label>App icon</label>
            <MediaPicker
              value={cfg.iconUrl ?? ""}
              disabled={ro}
              onChange={(url) => upd({ iconUrl: url || null })}
            />
          </div>
          <div className="field">
            <label>Launch splash</label>
            <MediaPicker
              value={cfg.splashUrl ?? ""}
              disabled={ro}
              onChange={(url) => upd({ splashUrl: url || null })}
            />
          </div>
        </div>

        {canEdit && (
          <div className="row-actions" style={{ alignItems: "center" }}>
            <button className="btn" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
            {saved && (
              <span className="alert-success" style={{ padding: "6px 10px" }}>
                Saved ✓
              </span>
            )}
          </div>
        )}
      </div>

      {/* ---------- live phone preview ---------- */}
      <div
        style={{ flex: "0 0 auto", position: "sticky", top: 16 }}
        aria-hidden="true"
      >
        <div className="hb-preview-label" style={{ marginBottom: 8 }}>
          Live preview
        </div>
        <PhonePreview cfg={cfg} palette={cfg[previewMode]} mode={previewMode} />
      </div>
    </div>
  );
}

// Mirrors the app's HSL + chrome/CTA derivations (apps/mobile/src/theme.ts,
// paletteFrom) so the preview shows exactly what the app will compute. Keep
// these byte-identical to the mobile copies.
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d + 6) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

// Ink band chrome: text-hue ink in light mode (stock #272144 text → exactly
// #221c3d), the bg itself in dark mode.
function chromeColor(p: AppThemePalette, mode: "light" | "dark"): string {
  if (mode === "dark") return p.bg;
  const t = hexToHsl(p.text);
  return hslToHex(t.h, t.s < 0.08 ? t.s : 0.37, 0.175);
}

// Teal CTA gradient: stock primary pins the design values; custom primaries
// get a same-hue ramp.
function ctaGradient(primary: string): string {
  if (primary.toLowerCase() === "#3cc4b2")
    return "linear-gradient(100deg, #4fcdb8, #2f9d8e)";
  const { h, s, l } = hexToHsl(primary);
  const start = hslToHex(h, Math.max(s, 0.35), Math.min(0.62, l + 0.06));
  const end = hslToHex(h, Math.max(s, 0.35), Math.max(0.18, l - 0.11));
  return `linear-gradient(100deg, ${start}, ${end})`;
}

// Mirrors the app's onPrimary derivation (apps/mobile/src/theme.ts) so the
// preview's button text color matches what the app will compute.
function onColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return lum > 0.45 ? "#101828" : "#ffffff";
}

// A phone-frame mock of the app's dashboard, styled entirely from the draft
// palette so it updates on every keystroke (same mechanism as the footer
// builder — local state → inline styles, no round-trip).
function PhonePreview({
  cfg,
  palette: p,
  mode,
}: {
  cfg: AppConfig;
  palette: AppThemePalette;
  mode: "light" | "dark";
}) {
  const chrome = chromeColor(p, mode);
  const card = (title: string, sub: string, pct: number) => (
    <div
      style={{
        background: p.surface,
        border: `1px solid ${p.border}`,
        borderRadius: 12,
        padding: 10,
        marginBottom: 10,
      }}
    >
      <div
        style={{
          height: 64,
          borderRadius: 8,
          background: p.surfaceMuted,
          marginBottom: 8,
        }}
      />
      <div style={{ color: p.text, fontSize: 13, fontWeight: 700 }}>{title}</div>
      <div style={{ color: p.textMuted, fontSize: 11, marginBottom: 8 }}>
        {sub}
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 999,
          background: p.surfaceMuted,
          overflow: "hidden",
        }}
      >
        <div
          style={{ width: `${pct}%`, height: "100%", background: p.primary }}
        />
      </div>
    </div>
  );

  return (
    <div
      style={{
        width: 290,
        borderRadius: 38,
        padding: 12,
        background: "#0b0b0d",
        border: "1px solid var(--border)",
        boxShadow: "0 24px 60px rgba(0,0,0,.45)",
      }}
    >
      <div
        style={{
          borderRadius: 28,
          overflow: "hidden",
          background: p.bg,
          height: 580,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* notch */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
          <div
            style={{
              width: 110,
              height: 22,
              borderRadius: 12,
              background: "#0b0b0d",
            }}
          />
        </div>

        {/* app header — ink band chrome, matching the app's Home band */}
        <div
          style={{
            background: chrome,
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {cfg.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cfg.logoUrl}
              alt=""
              style={{ height: 24, maxWidth: 130, objectFit: "contain" }}
            />
          ) : (
            <span style={{ color: "#ffffff", fontSize: 17, fontWeight: 800 }}>
              {cfg.title || "LMS"}
            </span>
          )}
          <span
            style={{
              marginLeft: "auto",
              width: 22,
              height: 22,
              borderRadius: 999,
              background: "rgba(255,255,255,.16)",
            }}
          />
        </div>

        {/* body */}
        <div style={{ padding: 16, overflow: "hidden", flex: 1 }}>
          {cfg.tagline ? (
            <div style={{ color: p.textMuted, fontSize: 12, marginBottom: 12 }}>
              {cfg.tagline}
            </div>
          ) : null}
          {card("Getting Started", "3 lessons · 60% complete", 60)}
          {card("Advanced Track", "8 lessons · 25% complete", 25)}
          <button
            type="button"
            disabled
            style={{
              width: "100%",
              background: ctaGradient(p.primary),
              color: onColor(p.primary),
              border: "none",
              borderRadius: 10,
              padding: "11px 0",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            Continue learning
          </button>
        </div>
      </div>
    </div>
  );
}
