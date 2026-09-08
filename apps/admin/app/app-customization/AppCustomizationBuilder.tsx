"use client";

import { memo, useEffect, useState } from "react";
import type {
  AppColorScheme,
  AppConfig,
  AppThemePalette,
  AppWhiteLabelStatus,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import ColorField from "@/components/ColorField";
import MediaPicker from "@/components/MediaPicker";
import { STR } from "@lms/types";
import { Button } from "@lms/ui";

const msg = (e: unknown, fb: string) =>
  e instanceof ApiError ? e.message : fb;

// The 8 themeable colors, mirroring apps/mobile/src/theme.ts.
// The 8 required solid-color keys (excludes the optional/nullable `chrome`
// override, which has its own Auto-capable control below).
const PALETTE_FIELDS: {
  key: Exclude<keyof AppThemePalette, "chrome">;
  label: string;
}[] = [
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
  // Which app surface the live phone preview shows. "signin" mirrors the member
  // Login screen (the surface admins most want to theme); "dashboard" is the
  // Home mock. Both are styled from the same draft palette + derivations.
  const [previewSurface, setPreviewSurface] = useState<"dashboard" | "signin">(
    "signin",
  );
  // null = unknown (still loading, no control plane, or unreachable) — the
  // icon/splash card FAILS OPEN on unknown and only locks on a definitive
  // "SHARED, nothing requested" answer.
  const [wl, setWl] = useState<AppWhiteLabelStatus | null>(null);

  useEffect(() => {
    api
      .getAppConfig()
      .then((c) => {
        setCfg(c);
        if (c.colorScheme === "light") setPreviewMode("light");
      })
      .catch((e) => onError(msg(e, "Failed to load app config.")));
    // Non-fatal by design: a failure just keeps the fail-open unknown state.
    api
      .getAppWhiteLabelStatus()
      .then(setWl)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!cfg) return <p className="muted">{STR.common.loading}</p>;
  const ro = !canEdit;
  const wlRequested = !!wl?.whiteLabelRequestedAt;
  const wlLocked = wl?.appMode === "SHARED" && !wlRequested;

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

  const renderPalette = (mode: "light" | "dark") => {
    // Header band (the ink strip behind the logo). null = Auto (derived from the
    // theme, exactly as the app computes it); a hex overrides it for this mode.
    const chromeAuto = cfg[mode].chrome == null;
    return (
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
        {/* Header band gets its own control (not a PALETTE_FIELDS ColorField)
            because it supports an "Auto" state a plain ColorField can't hold. */}
        <div className="field" style={{ marginTop: 6 }}>
          <label className="menu-checkbox" style={{ fontWeight: 500 }}>
            <input
              type="checkbox"
              checked={chromeAuto}
              disabled={ro}
              onChange={(e) =>
                updPalette(mode, {
                  chrome: e.target.checked
                    ? null
                    : chromeColor(cfg[mode], mode),
                })
              }
            />
            Header band — Auto (match theme)
          </label>
          {!chromeAuto && (
            <div style={{ marginTop: 8 }}>
              <ColorField
                label="Header color"
                value={cfg[mode].chrome ?? chromeColor(cfg[mode], mode)}
                disabled={ro}
                onChange={(v) => updPalette(mode, { chrome: v })}
              />
            </div>
          )}
        </div>
      </div>
    );
  };

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
              placeholder="Your brand name"
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
              placeholder="A longer blurb shown on the member Account screen"
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
              adjustableCrop
              onChange={(url) => upd({ logoUrl: url || null })}
            />
          </div>
          {/* Legal links shown on the member web footer + signup and the mobile
              Account screen. Pre-filled with the platform policy pages; enter your
              own to override, or clear to fall back to the platform page. */}
          <div className="field">
            <label>
              Privacy Policy URL{" "}
              <span className="muted">(defaults to the platform page)</span>
            </label>
            <input
              value={cfg.privacyUrl ?? ""}
              disabled={ro}
              maxLength={2000}
              placeholder="https://…/privacy"
              onChange={(e) => upd({ privacyUrl: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label>
              Terms of Service URL{" "}
              <span className="muted">(defaults to the platform page)</span>
            </label>
            <input
              value={cfg.termsUrl ?? ""}
              disabled={ro}
              maxLength={2000}
              placeholder="https://…/terms"
              onChange={(e) => upd({ termsUrl: e.target.value || null })}
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
              <label>{STR.common.preview}</label>
              <div className="row-actions">
                <Button
                  type="button"
                  size="sm"
                  variant={previewMode === "light" ? "primary" : "secondary"}
                  onClick={() => setPreviewMode("light")}
                >
                  Light
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={previewMode === "dark" ? "primary" : "secondary"}
                  onClick={() => setPreviewMode("dark")}
                >
                  Dark
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* colors */}
        {renderPalette("light")}
        {renderPalette("dark")}

        {/* app icon & splash — consumed by WHITE-LABEL builds only, so the
            card is gated on the control-plane app mode. Locked ONLY on a
            definitive "SHARED, nothing requested"; unknown fails open. */}
        <div className="card">
          <h2>App icon &amp; splash</h2>
          <p
            className="muted"
            style={{
              fontSize: 13,
              marginTop: -4,
              marginBottom: 12,
              borderLeft: `3px solid ${
                wlLocked ? "var(--muted)" : "var(--amber, #f59e0b)"
              }`,
              paddingLeft: 10,
            }}
          >
            {wl?.appMode === "WHITE_LABEL" ? (
              <>
                These brand <strong>your white-label app</strong>. The installed
                icon and launch splash are baked in at build time — they don’t
                update live like the colors above. Upload <strong>PNG</strong>s
                (icon 1024×1024 opaque, splash ≥1242×2436); the next app build
                picks them up automatically, and a store submission is still
                required.
              </>
            ) : wlRequested ? (
              <>
                Your <strong>white-label app</strong> request is pending. Upload
                these now so your first branded build ships fully branded —
                they’re baked in at build time (<strong>PNG</strong>, icon
                1024×1024 opaque, splash ≥1242×2436). They never affect the
                shared app.
              </>
            ) : wlLocked ? (
              <>
                Available with the <strong>white-label app</strong> add-on:
                these become the installed icon and launch splash of your own
                branded app. The shared app always keeps its standard icon,
                name, and splash, so they’re disabled on your current plan.
                Request your branded app from your license portal to unlock
                them.
              </>
            ) : (
              <>
                ⚠ Used only when a <strong>white-label</strong> (branded) app is
                built for your academy — the shared app keeps its standard icon
                and splash. These are baked in at build time, not live like the
                colors above. Upload <strong>PNG</strong>s (icon 1024×1024
                opaque, splash ≥1242×2436) — the next app build bakes them in
                automatically; a store submission is still required.
              </>
            )}
          </p>
          <div className="field">
            <label>App icon</label>
            <MediaPicker
              value={cfg.iconUrl ?? ""}
              disabled={ro || wlLocked}
              onChange={(url) => upd({ iconUrl: url || null })}
            />
          </div>
          <div className="field">
            <label>Launch splash</label>
            <MediaPicker
              value={cfg.splashUrl ?? ""}
              disabled={ro || wlLocked}
              onChange={(url) => upd({ splashUrl: url || null })}
            />
          </div>
        </div>

        {canEdit && (
          <div className="row-actions" style={{ alignItems: "center" }}>
            <Button onClick={save} disabled={busy}>
              {busy ? STR.common.saving : STR.common.save}
            </Button>
            {saved && (
              <span className="alert-success" style={{ padding: "6px 10px" }}>
                Saved ✓
              </span>
            )}
          </div>
        )}
      </div>

      {/* ---------- live phone preview ---------- */}
      <div style={{ flex: "0 0 auto", position: "sticky", top: 16 }}>
        <div className="hb-preview-label" style={{ marginBottom: 8 }}>
          Live preview
        </div>
        {/* Surface toggle: Sign in (the member login) vs Dashboard (Home). Both
            render from the same draft palette, so the admin can theme the login
            page — the surface most sensitive to the Header band color. */}
        <div className="row-actions" style={{ marginBottom: 10 }}>
          <Button
            type="button"
            size="sm"
            variant={previewSurface === "signin" ? "primary" : "secondary"}
            onClick={() => setPreviewSurface("signin")}
          >
            Sign in
          </Button>
          <Button
            type="button"
            size="sm"
            variant={previewSurface === "dashboard" ? "primary" : "secondary"}
            onClick={() => setPreviewSurface("dashboard")}
          >
            Dashboard
          </Button>
        </div>
        <div aria-hidden="true">
          {previewSurface === "signin" ? (
            <PhoneAuthPreview
              cfg={cfg}
              palette={cfg[previewMode]}
              mode={previewMode}
            />
          ) : (
            <PhonePreview
              cfg={cfg}
              palette={cfg[previewMode]}
              mode={previewMode}
            />
          )}
        </div>
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

// Ink band chrome: the stock Spark text (#17171d) pins ink-900 (#101014)
// exactly (too desaturated for the hue derivation to land there); custom text
// colors derive text-hue ink in light mode; the bg itself in dark mode.
// MUST mirror paletteFrom() in apps/mobile/src/theme.ts.
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

// WCAG relative luminance — used to compare gradient stops and gate the
// on-chrome derivations. Mirrors theme.ts luminance().
function luminance01(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrastRatio(a: string, b: string): number {
  const la = luminance01(a);
  const lb = luminance01(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
// Mirrors theme.ts darkenUntilAA — darken a brand accent until it meets AA on bg.
function darkenUntilAA(hex: string, bg: string): string {
  const { h, s, l } = hexToHsl(hex);
  for (let li = l; li >= 0; li -= 0.02) {
    const c = hslToHex(h, s, li);
    if (contrastRatio(c, bg) >= 4.5) return c;
  }
  return hslToHex(h, s, 0);
}
// Mirrors theme.ts primaryOnDark.
function primaryOnDark(primary: string): string {
  if (primary.toLowerCase() === "#3cc4b2") return "#7ce4d2";
  const { h, s } = hexToHsl(primary);
  return hslToHex(h, Math.max(s, 0.4), 0.69);
}
// Mirrors theme.ts onCta: the CTA label picks against the LIGHTER gradient stop
// (worst case for white), so a light brand accent gets dark ink, not white.
function ctaLabel(primary: string): string {
  if (primary.toLowerCase() === "#3cc4b2") return "#ffffff";
  const { h, s, l } = hexToHsl(primary);
  const start = hslToHex(h, Math.max(s, 0.35), Math.min(0.62, l + 0.06));
  const end = hslToHex(h, Math.max(s, 0.35), Math.max(0.18, l - 0.11));
  return onColor(luminance01(start) >= luminance01(end) ? start : end);
}
// Resolve the header band + its DERIVED foreground tokens exactly as the app
// does (apps/mobile/src/theme.ts paletteFrom): the band is admin-overridable
// and can be light, so text/links on it must derive from it — keep byte-identical.
function chromeTokens(p: AppThemePalette, mode: "light" | "dark") {
  const chrome =
    p.chrome && /^#[0-9a-fA-F]{6}$/.test(p.chrome)
      ? p.chrome
      : chromeColor(p, mode);
  const isLight = luminance01(chrome) > 0.45;
  return {
    chrome,
    onChrome: onColor(chrome),
    onChromeSoft: isLight ? "rgba(16,24,40,0.62)" : "rgba(255,255,255,0.6)",
    onChromeFaint: isLight ? "rgba(16,24,40,0.12)" : "rgba(255,255,255,0.16)",
    onChromeAccent: isLight
      ? darkenUntilAA(p.primary, chrome)
      : primaryOnDark(p.primary),
  };
}

// Brand glyph mirroring the app's BrandMark (apps/mobile/src/components/
// BrandMark.tsx): a rotated-square diamond + a smaller spark, both in `color`.
// Shown in the no-logo branch so the preview matches the app's header exactly.
function PreviewMark({ size = 20, color }: { size?: number; color: string }) {
  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        width: size,
        height: size,
        flex: "0 0 auto",
      }}
    >
      <span
        style={{
          position: "absolute",
          left: size * 0.14,
          top: size * 0.22,
          width: size * 0.46,
          height: size * 0.46,
          borderRadius: size * 0.09,
          background: color,
          transform: "rotate(45deg)",
        }}
      />
      <span
        style={{
          position: "absolute",
          left: size * 0.64,
          top: size * 0.06,
          width: size * 0.24,
          height: size * 0.24,
          borderRadius: size * 0.05,
          background: color,
          opacity: 0.85,
          transform: "rotate(45deg)",
        }}
      />
    </span>
  );
}

// The phone bezel + notch, shared by the dashboard and sign-in previews.
function PhoneFrame({
  bg,
  children,
}: {
  bg: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        width: 290,
        borderRadius: 38,
        padding: 12,
        // P3b: bezel was #0b0b0d — one off ink-950 (#0b0b0e); now the token.
        background: "var(--ink-950)",
        border: "1px solid var(--border)",
        boxShadow: "0 24px 60px rgba(0,0,0,.45)",
      }}
    >
      <div
        style={{
          borderRadius: 28,
          overflow: "hidden",
          background: bg,
          height: 580,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* notch */}
        <div
          style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}
        >
          <div
            style={{
              width: 110,
              height: 22,
              borderRadius: 12,
              background: "var(--ink-950)", // P3b: was #0b0b0d (off by one)
            }}
          />
        </div>
        {children}
      </div>
    </div>
  );
}

// A phone-frame mock of the app's dashboard, styled entirely from the draft
// palette so it updates on every keystroke (same mechanism as the footer
// builder — local state → inline styles, no round-trip).
const PhonePreview = memo(function PhonePreview({
  cfg,
  palette: p,
  mode,
}: {
  cfg: AppConfig;
  palette: AppThemePalette;
  mode: "light" | "dark";
}) {
  // Header band + the DERIVED on-chrome foreground/accent tokens, exactly as the
  // app computes them (chromeTokens mirrors theme.ts paletteFrom) — so a light
  // "Header band" override shows legible (dark) header text in the preview too.
  const { chrome, onChrome, onChromeFaint } = chromeTokens(p, mode);
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
      <div style={{ color: p.text, fontSize: 13, fontWeight: 700 }}>
        {title}
      </div>
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
        // P3b: bezel was #0b0b0d — one off ink-950 (#0b0b0e); now the token.
        background: "var(--ink-950)",
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
        <div
          style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}
        >
          <div
            style={{
              width: 110,
              height: 22,
              borderRadius: 12,
              background: "var(--ink-950)", // P3b: was #0b0b0d (off by one)
            }}
          />
        </div>

        {/* app header — ink band chrome, matching the app's Home band
            (BrandHeaderTitle: fixed 120×26 logo box, else the brand glyph +
            semibold 13.5 title, in the derived on-chrome color). */}
        <div
          style={{
            background: chrome,
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 9,
          }}
        >
          {cfg.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cfg.logoUrl}
              alt=""
              style={{ height: 26, width: 120, objectFit: "contain" }}
            />
          ) : (
            <span
              style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}
            >
              <PreviewMark size={20} color={p.primary} />
              <span
                style={{
                  color: onChrome,
                  fontSize: 13.5,
                  fontWeight: 600,
                  maxWidth: 240,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {cfg.title || "Your app"}
              </span>
            </span>
          )}
          <span
            style={{
              marginLeft: "auto",
              width: 22,
              height: 22,
              borderRadius: 999,
              background: onChromeFaint,
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
              color: ctaLabel(p.primary),
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
});

// A phone-frame mock of the member SIGN-IN screen (LoginScreen + AuthBrand), so
// admins can theme the login page — the surface most sensitive to the Header
// band color. Full chrome canvas, centered brand lockup, a floating surface card
// with two inputs + the CTA-gradient button, and the on-chrome link rows. Every
// color comes from the same derivations as the dashboard preview / the app.
const PhoneAuthPreview = memo(function PhoneAuthPreview({
  cfg,
  palette: p,
  mode,
}: {
  cfg: AppConfig;
  palette: AppThemePalette;
  mode: "light" | "dark";
}) {
  const { chrome, onChrome, onChromeSoft, onChromeAccent } = chromeTokens(
    p,
    mode,
  );
  const input = (placeholder: string) => (
    <div
      style={{
        background: p.bg,
        border: `1px solid ${p.border}`,
        borderRadius: 10,
        padding: "11px 12px",
        marginBottom: 10,
        color: p.textMuted,
        fontSize: 13,
      }}
    >
      {placeholder}
    </div>
  );
  return (
    <PhoneFrame bg={chrome}>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 20,
        }}
      >
        {/* brand lockup */}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          {cfg.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cfg.logoUrl}
              alt=""
              style={{ height: 52, maxWidth: 200, objectFit: "contain" }}
            />
          ) : (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <PreviewMark size={26} color={p.primary} />
              <span
                style={{ color: onChrome, fontSize: 24, fontWeight: 800 }}
              >
                {cfg.title || "Your app"}
              </span>
            </span>
          )}
          {cfg.tagline ? (
            <div style={{ color: onChromeSoft, fontSize: 12.5, marginTop: 8 }}>
              {cfg.tagline}
            </div>
          ) : null}
        </div>

        {/* floating form card */}
        <div style={{ background: p.surface, borderRadius: 18, padding: 18 }}>
          <div style={{ color: p.text, fontSize: 16, fontWeight: 700 }}>
            Welcome back
          </div>
          <div
            style={{
              color: p.textMuted,
              fontSize: 12,
              marginTop: 2,
              marginBottom: 14,
            }}
          >
            Sign in to your membership
          </div>
          {input("Email")}
          {input("Password")}
          <button
            type="button"
            disabled
            style={{
              width: "100%",
              background: ctaGradient(p.primary),
              color: ctaLabel(p.primary),
              border: "none",
              borderRadius: 10,
              padding: "11px 0",
              fontSize: 14,
              fontWeight: 700,
              marginTop: 4,
            }}
          >
            Sign in
          </button>
        </div>

        {/* on-chrome link rows */}
        <div
          style={{
            textAlign: "center",
            marginTop: 18,
            color: onChromeSoft,
            fontSize: 12.5,
          }}
        >
          Forgot your password?{" "}
          <span style={{ color: onChromeAccent, fontWeight: 700 }}>
            Reset it
          </span>
        </div>
        <div
          style={{
            textAlign: "center",
            marginTop: 12,
            color: onChromeSoft,
            fontSize: 12.5,
          }}
        >
          New here?{" "}
          <span style={{ color: onChromeAccent, fontWeight: 700 }}>
            Create an account
          </span>
        </div>
      </div>
    </PhoneFrame>
  );
});
