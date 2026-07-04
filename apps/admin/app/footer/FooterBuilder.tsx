"use client";

import { useEffect, useState } from "react";
import type {
  FooterBottomLink,
  FooterConfig,
  AudienceDTO,
  MenuDTO,
  MenuListItem,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import MediaPicker from "@/components/MediaPicker";
import ColorField from "@/components/ColorField";

const BRAND = "LMS";
const msg = (e: unknown, fb: string) =>
  e instanceof ApiError ? e.message : fb;

function clampInt(v: string, min: number, max: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
function makeLink(): FooterBottomLink {
  return { id: crypto.randomUUID(), label: "Privacy", url: "/privacy" };
}

export default function FooterBuilder({
  menus,
  audiences,
  canEdit,
  onError,
}: {
  menus: MenuListItem[];
  audiences: AudienceDTO[];
  canEdit: boolean;
  onError: (m: string | null) => void;
}) {
  const [cfg, setCfg] = useState<FooterConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [menuLabels, setMenuLabels] = useState<string[]>([]);
  const year = new Date().getFullYear();

  useEffect(() => {
    api
      .getFooter()
      .then(setCfg)
      .catch((e) => onError(msg(e, "Failed to load footer.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = cfg?.menuId;
    if (!id) {
      setMenuLabels([]);
      return;
    }
    let alive = true;
    api
      .getMenu(id)
      .then((m: MenuDTO) => alive && setMenuLabels(m.items.map((i) => i.label)))
      .catch(() => alive && setMenuLabels([]));
    return () => {
      alive = false;
    };
  }, [cfg?.menuId]);

  if (!cfg) return <p className="muted">Loading…</p>;
  const ro = !canEdit;

  const upd = (patch: Partial<FooterConfig>) => {
    setCfg((c) => (c ? { ...c, ...patch } : c));
    setSaved(false);
  };
  const updEmail = (patch: Partial<FooterConfig["email"]>) => {
    setCfg((c) => (c ? { ...c, email: { ...c.email, ...patch } } : c));
    setSaved(false);
  };
  const updLink = (id: string, patch: Partial<FooterBottomLink>) => {
    setCfg((c) =>
      c
        ? {
            ...c,
            bottomLinks: c.bottomLinks.map((l) =>
              l.id === id ? { ...l, ...patch } : l,
            ),
          }
        : c,
    );
    setSaved(false);
  };
  const addLink = () => {
    setCfg((c) =>
      c ? { ...c, bottomLinks: [...c.bottomLinks, makeLink()] } : c,
    );
    setSaved(false);
  };
  const removeLink = (id: string) => {
    setCfg((c) =>
      c ? { ...c, bottomLinks: c.bottomLinks.filter((l) => l.id !== id) } : c,
    );
    setSaved(false);
  };

  async function save() {
    if (!cfg) return;
    setBusy(true);
    onError(null);
    try {
      const next = await api.updateFooter({ footer: cfg });
      setCfg(next);
      setSaved(true);
    } catch (e) {
      onError(msg(e, "Failed to save footer."));
    } finally {
      setBusy(false);
    }
  }

  const labels = menuLabels.length ? menuLabels : ["About", "Pricing", "Contact"];
  const copyrightText = cfg.copyright.replace(/\{year\}/g, String(year));

  return (
    <div className="header-builder">
      {/* enabled */}
      <div className="card">
        <label className="menu-checkbox">
          <input
            type="checkbox"
            checked={cfg.enabled}
            disabled={ro}
            onChange={(e) => upd({ enabled: e.target.checked })}
          />
          Show the footer on the site
        </label>
      </div>

      {/* live preview */}
      <div className="hb-preview-card">
        <div className="hb-preview-label">Live preview</div>
        <div
          className="ftr-preview"
          style={{
            background: cfg.bgColor,
            color: cfg.textColor,
            padding: `${Math.min(cfg.paddingY, 40)}px 24px`,
          }}
        >
          <div className="ftr-cols">
            <div className="ftr-col">
              {cfg.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cfg.logoUrl} alt="" className="ftr-logo" />
              ) : (
                <span className="ftr-brand" style={{ color: cfg.headingColor }}>
                  {BRAND}
                </span>
              )}
              {cfg.tagline && <p className="ftr-tagline">{cfg.tagline}</p>}
            </div>
            <div className="ftr-col">
              <div className="ftr-heading" style={{ color: cfg.headingColor }}>
                {cfg.menuHeading || "Links"}
              </div>
              {labels.map((l, i) => (
                <div key={i} className="ftr-link" style={{ color: cfg.linkColor }}>
                  {l}
                </div>
              ))}
            </div>
            <div className="ftr-col">
              <div className="ftr-heading" style={{ color: cfg.headingColor }}>
                {cfg.email.heading}
              </div>
              {cfg.email.text && <p className="ftr-tagline">{cfg.email.text}</p>}
              <div className="ftr-emailrow">
                <input disabled placeholder={cfg.email.placeholder} />
                <span className="ftr-emailbtn" style={{ background: cfg.linkColor }}>
                  {cfg.email.buttonText}
                </span>
              </div>
            </div>
          </div>
          <div className="ftr-bottom">
            <span>{copyrightText}</span>
            <span className="ftr-bottom-links">
              {cfg.bottomLinks.map((l) => (
                <span key={l.id} style={{ color: cfg.linkColor }}>
                  {l.label}
                </span>
              ))}
            </span>
          </div>
        </div>
      </div>

      {/* style */}
      <div className="card">
        <h2>Style</h2>
        <div className="form-row">
          <ColorField label="Background" value={cfg.bgColor} disabled={ro} onChange={(v) => upd({ bgColor: v })} />
          <ColorField label="Text" value={cfg.textColor} disabled={ro} onChange={(v) => upd({ textColor: v })} />
          <ColorField label="Headings" value={cfg.headingColor} disabled={ro} onChange={(v) => upd({ headingColor: v })} />
          <ColorField label="Links" value={cfg.linkColor} disabled={ro} onChange={(v) => upd({ linkColor: v })} />
          <div className="field">
            <label>Vertical padding (px)</label>
            <input
              type="number"
              min={0}
              max={120}
              value={cfg.paddingY}
              disabled={ro}
              onChange={(e) => upd({ paddingY: clampInt(e.target.value, 0, 120) })}
            />
          </div>
        </div>
      </div>

      {/* col 1: logo */}
      <div className="card">
        <h2>Column 1 — Logo</h2>
        <div className="field">
          <label>
            Logo image <span className="muted">(blank = “{BRAND}” text)</span>
          </label>
          <MediaPicker value={cfg.logoUrl ?? ""} disabled={ro} onChange={(url) => upd({ logoUrl: url || null })} />
        </div>
        <div className="field">
          <label>
            Tagline <span className="muted">(optional)</span>
          </label>
          <textarea
            value={cfg.tagline ?? ""}
            disabled={ro}
            placeholder="A short line under the logo"
            onChange={(e) => upd({ tagline: e.target.value || null })}
          />
        </div>
      </div>

      {/* col 2: menu */}
      <div className="card">
        <h2>Column 2 — Menu</h2>
        <div className="form-row">
          <div className="field" style={{ flex: 1 }}>
            <label>Column heading</label>
            <input value={cfg.menuHeading} disabled={ro} onChange={(e) => upd({ menuHeading: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 2 }}>
            <label>Menu</label>
            <select value={cfg.menuId ?? ""} disabled={ro} onChange={(e) => upd({ menuId: e.target.value || null })}>
              <option value="">— Use the menu assigned to “Footer” —</option>
              {menus.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              {cfg.menuId && !menus.some((m) => m.id === cfg.menuId) && (
                <option value={cfg.menuId}>(deleted menu)</option>
              )}
            </select>
          </div>
        </div>
      </div>

      {/* col 3: email */}
      <div className="card">
        <h2>Column 3 — Email opt-in</h2>
        <div className="form-row">
          <div className="field" style={{ flex: 1 }}>
            <label>Heading</label>
            <input value={cfg.email.heading} disabled={ro} onChange={(e) => updEmail({ heading: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 2 }}>
            <label>Audience</label>
            <select
              value={cfg.email.audienceId ?? ""}
              disabled={ro}
              onChange={(e) => {
                const a = audiences.find((x) => x.id === e.target.value);
                updEmail({
                  audienceId: e.target.value || null,
                  audienceName: a?.name ?? null,
                });
              }}
            >
              <option value="">— None (use the default audience) —</option>
              {audiences.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.isDefault ? " (default)" : ""}
                </option>
              ))}
              {cfg.email.audienceId &&
                !audiences.some((a) => a.id === cfg.email.audienceId) && (
                  <option value={cfg.email.audienceId}>
                    {cfg.email.audienceName || cfg.email.audienceId} (unavailable)
                  </option>
                )}
            </select>
          </div>
        </div>
        <div className="field">
          <label>
            Intro text <span className="muted">(optional)</span>
          </label>
          <textarea value={cfg.email.text ?? ""} disabled={ro} onChange={(e) => updEmail({ text: e.target.value || null })} />
        </div>
        <div className="form-row">
          <div className="field">
            <label>Placeholder</label>
            <input value={cfg.email.placeholder} disabled={ro} onChange={(e) => updEmail({ placeholder: e.target.value })} />
          </div>
          <div className="field">
            <label>Button text</label>
            <input value={cfg.email.buttonText} disabled={ro} onChange={(e) => updEmail({ buttonText: e.target.value })} />
          </div>
          <div className="field">
            <label>Success message</label>
            <input value={cfg.email.successMessage} disabled={ro} onChange={(e) => updEmail({ successMessage: e.target.value })} />
          </div>
        </div>
        <label className="menu-checkbox">
          <input
            type="checkbox"
            checked={cfg.email.doubleOptIn}
            disabled={ro}
            onChange={(e) => updEmail({ doubleOptIn: e.target.checked })}
          />
          Double opt-in (send a confirmation email before subscribing)
        </label>
        {audiences.length === 0 && (
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            No audiences listed — newsletter signups still go to the default
            audience.
          </p>
        )}
      </div>

      {/* bottom bar */}
      <div className="card">
        <div className="card-head">
          <h2>Bottom bar</h2>
          {canEdit && (
            <button className="btn btn--sm" onClick={addLink}>
              + Add link
            </button>
          )}
        </div>
        <div className="field">
          <label>
            Copyright <span className="muted">(use {"{year}"} for the current year)</span>
          </label>
          <input value={cfg.copyright} disabled={ro} onChange={(e) => upd({ copyright: e.target.value })} />
        </div>
        {cfg.bottomLinks.length === 0 ? (
          <p className="muted">No links yet. Click “Add link”.</p>
        ) : (
          <div className="hb-cta-list">
            {cfg.bottomLinks.map((l) => (
              <div key={l.id} className="form-row">
                <div className="field" style={{ flex: 1 }}>
                  <label>Label</label>
                  <input value={l.label} disabled={ro} onChange={(e) => updLink(l.id, { label: e.target.value })} />
                </div>
                <div className="field" style={{ flex: 2 }}>
                  <label>URL</label>
                  <input value={l.url} disabled={ro} placeholder="/privacy or https://…" onChange={(e) => updLink(l.id, { url: e.target.value })} />
                </div>
                {canEdit && (
                  <div className="field" style={{ justifyContent: "flex-end" }}>
                    <label>&nbsp;</label>
                    <button className="btn btn--danger btn--sm" onClick={() => removeLink(l.id)}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {canEdit && (
        <div className="row-actions" style={{ alignItems: "center" }}>
          <button className="btn" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save footer"}
          </button>
          {saved && (
            <span className="alert-success" style={{ padding: "6px 10px" }}>
              Saved ✓
            </span>
          )}
        </div>
      )}
    </div>
  );
}
