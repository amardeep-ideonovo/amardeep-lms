"use client";

// Puck editor chrome + shared block styles. Imported here (route-scoped) so the
// heavy editor CSS only loads on this full-screen page. Popups reuse the SAME
// editor/config as Pages; the popup-specific presentation + visibility settings
// live in a slide-over drawer (the "⚙ Settings" button), NOT in the Puck doc.
import "@puckeditor/core/puck.css";
import "@lms/puck/styles.css";
import "@/app/puck-theme.css";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Puck } from "@puckeditor/core";
import type { Data, Field } from "@puckeditor/core";
import { createPuckConfig } from "@lms/puck";
import type { PageProps, RootProps } from "@lms/puck";
import type {
  PageListItem,
  PopupAnimation,
  PopupFrequency,
  PopupPageMode,
  PopupPosition,
  PopupStatus,
  PopupTrigger,
  PuckDocument,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";
import RichTextEditor from "@/components/RichTextEditor";
import FormPickerField from "@/components/FormPickerField";
import MediaPicker from "@/components/MediaPicker";
import MenuPickerField from "@/components/MenuPickerField";
import PuckColorField from "@/components/PuckColorField";

type PopupData = Data<PageProps, RootProps>;
type SaveState = "idle" | "saving" | "saved" | "error";

// The popup presentation + visibility + behaviour settings (everything except
// the Puck doc).
type Settings = {
  width: string;
  height: string;
  background: string;
  position: PopupPosition;
  borderColor: string;
  borderRadius: number;
  padding: number;
  showOnDashboard: boolean;
  showOnClasses: boolean;
  showOnCourses: boolean;
  showOnLessons: boolean;
  pageMode: PopupPageMode;
  pageIds: string[];
  trigger: PopupTrigger;
  triggerValue: number;
  frequency: PopupFrequency;
  frequencyDays: number;
  closeOnOverlay: boolean;
  animation: PopupAnimation;
};

const POSITION_OPTIONS: { value: PopupPosition; label: string }[] = [
  { value: "CENTER", label: "Center" },
  { value: "TOP", label: "Top" },
  { value: "BOTTOM", label: "Bottom" },
  { value: "TOP_LEFT", label: "Top left" },
  { value: "TOP_RIGHT", label: "Top right" },
  { value: "BOTTOM_LEFT", label: "Bottom left" },
  { value: "BOTTOM_RIGHT", label: "Bottom right" },
];

const PAGE_MODE_OPTIONS: { value: PopupPageMode; label: string }[] = [
  { value: "NONE", label: "Don’t show on any page" },
  { value: "ALL", label: "Show on all pages" },
  { value: "INCLUDE", label: "Show only on selected pages" },
  { value: "EXCLUDE", label: "Show on all pages except selected" },
];

// Member-area surfaces (one on/off checkbox each; CMS pages have their own
// include/exclude targeting below).
const SURFACE_OPTIONS: {
  key: "showOnDashboard" | "showOnClasses" | "showOnCourses" | "showOnLessons";
  label: string;
}[] = [
  { key: "showOnDashboard", label: "Dashboard" },
  { key: "showOnClasses", label: "Class pages" },
  { key: "showOnCourses", label: "Course pages" },
  { key: "showOnLessons", label: "Lesson pages" },
];

const TRIGGER_OPTIONS: { value: PopupTrigger; label: string }[] = [
  { value: "IMMEDIATE", label: "Immediately on load" },
  { value: "DELAY", label: "After a delay" },
  { value: "SCROLL", label: "After scrolling down the page" },
  { value: "EXIT_INTENT", label: "On exit intent (desktop web)" },
];

const FREQUENCY_OPTIONS: { value: PopupFrequency; label: string }[] = [
  { value: "EVERY_VISIT", label: "Every visit" },
  { value: "ONCE_PER_SESSION", label: "Once per session" },
  { value: "ONCE_PER_DAYS", label: "Once every X days" },
  { value: "ONCE", label: "Once ever" },
];

const ANIMATION_OPTIONS: { value: PopupAnimation; label: string }[] = [
  { value: "FADE", label: "Fade in" },
  { value: "SLIDE_UP", label: "Slide up" },
  { value: "ZOOM", label: "Zoom in" },
  { value: "NONE", label: "None" },
];

// A safe #rrggbb for the native color picker; non-hex CSS colors keep the text
// field as source of truth and just fall back to the swatch default.
function asHex(v: string, fallback: string): string {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : fallback;
}

// Editor-side preview for the Puck "Form" block (the real form renders on site).
function FormPreview({ formId }: { formId: string }) {
  return (
    <div
      style={{
        border: "1px dashed var(--border-strong)",
        borderRadius: 8,
        padding: 16,
        color: "var(--muted)",
        textAlign: "center",
      }}
    >
      {formId ? `Embedded form: ${formId}` : "Form block — set a Form ID in the panel"}
    </div>
  );
}

export default function PopupEditor() {
  const { can, loading: authLoading } = useAdminAuth();
  const params = useParams();
  const id = String((params?.id as string) ?? "");
  const router = useRouter();

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialData, setInitialData] = useState<PopupData | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<PopupStatus>("INACTIVE");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pages, setPages] = useState<PageListItem[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [stats, setStats] = useState<{
    views: number;
    clicks: number;
    dismissals: number;
  } | null>(null);

  const latest = useRef<PopupData | null>(null);
  const docTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // RichText field reuses the TipTap editor (admin-only, never ships to site).
  const config = useMemo(() => {
    const richTextField = {
      type: "custom" as const,
      render: ({
        value,
        onChange,
      }: {
        value?: string;
        onChange: (v: string) => void;
      }) => <RichTextEditor value={value || ""} onChange={onChange} />,
    } as Field;
    const formField = {
      type: "custom" as const,
      label: "Form",
      render: ({
        value,
        onChange,
      }: {
        value?: string;
        onChange: (v: string) => void;
      }) => <FormPickerField value={value} onChange={onChange} />,
    } as Field;
    const imageField = {
      type: "custom" as const,
      render: ({
        value,
        onChange,
      }: {
        value?: string;
        onChange: (v: string) => void;
      }) => <MediaPicker value={value || ""} onChange={onChange} />,
    } as Field;
    const menuField = {
      type: "custom" as const,
      label: "Menu",
      render: ({
        value,
        onChange,
      }: {
        value?: string;
        onChange: (v: string) => void;
      }) => <MenuPickerField value={value} onChange={onChange} />,
    } as Field;
    const colorField = {
      type: "custom" as const,
      render: ({
        field,
        value,
        onChange,
      }: {
        field?: { label?: string };
        value?: string;
        onChange: (v: string) => void;
      }) => (
        <PuckColorField label={field?.label} value={value} onChange={onChange} />
      ),
    } as Field;
    return createPuckConfig({
      richTextField,
      formComponent: FormPreview,
      formField,
      imageField,
      menuField,
      colorField,
      // Popups have no SEO surface — drop the root SEO fields from the rail.
      surface: "popup",
      // Canvas previews the popup's white box, not the admin chrome theme.
      editorCanvas: true,
    });
  }, []);

  useEffect(() => {
    if (!id) return;
    if (authLoading || !can("popups", "read")) return;
    let alive = true;
    (async () => {
      try {
        const [popup, pageList] = await Promise.all([
          api.getPopup(id),
          api.listPages().catch(() => [] as PageListItem[]),
        ]);
        if (!alive) return;
        setName(popup.name);
        setStatus(popup.status);
        setSettings({
          width: popup.width,
          height: popup.height,
          background: popup.background,
          position: popup.position,
          borderColor: popup.borderColor,
          borderRadius: popup.borderRadius,
          padding: popup.padding,
          showOnDashboard: popup.showOnDashboard,
          showOnClasses: popup.showOnClasses,
          showOnCourses: popup.showOnCourses,
          showOnLessons: popup.showOnLessons,
          pageMode: popup.pageMode,
          pageIds: popup.pageIds,
          trigger: popup.trigger,
          triggerValue: popup.triggerValue,
          frequency: popup.frequency,
          frequencyDays: popup.frequencyDays,
          closeOnOverlay: popup.closeOnOverlay,
          animation: popup.animation,
        });
        setPages(pageList);
        setStats({
          views: popup.views,
          clicks: popup.clicks,
          dismissals: popup.dismissals,
        });
        const data = popup.data as unknown as PopupData;
        latest.current = data;
        setInitialData(data);
      } catch (err) {
        if (alive)
          setLoadError(
            err instanceof ApiError ? err.message : "Failed to load popup"
          );
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
      if (docTimer.current) clearTimeout(docTimer.current);
      if (settingsTimer.current) clearTimeout(settingsTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, authLoading]);

  // Debounced autosave of the Puck document on every edit.
  function scheduleSave(data: PopupData) {
    latest.current = data;
    if (docTimer.current) clearTimeout(docTimer.current);
    setSaveState("saving");
    docTimer.current = setTimeout(async () => {
      try {
        await api.updatePopup(id, {
          data: (latest.current ?? undefined) as unknown as
            | PuckDocument
            | undefined,
        });
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 1000);
  }

  // Debounced autosave of the popup settings (style + visibility).
  function scheduleSettingsSave(next: Settings) {
    if (settingsTimer.current) clearTimeout(settingsTimer.current);
    setSaveState("saving");
    settingsTimer.current = setTimeout(async () => {
      try {
        await api.updatePopup(id, { ...next });
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 600);
  }

  function updateSettings(patch: Partial<Settings>) {
    setSettings((s) => {
      if (!s) return s;
      const next = { ...s, ...patch };
      scheduleSettingsSave(next);
      return next;
    });
  }

  function togglePageId(pageId: string) {
    setSettings((s) => {
      if (!s) return s;
      const has = s.pageIds.includes(pageId);
      const pageIds = has
        ? s.pageIds.filter((x) => x !== pageId)
        : [...s.pageIds, pageId];
      const next = { ...s, pageIds };
      scheduleSettingsSave(next);
      return next;
    });
  }

  async function saveStatus(next: PopupStatus) {
    setSaveState("saving");
    try {
      const updated = await api.updatePopup(id, { status: next });
      setStatus(updated.status);
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      await dialog.notify(
        err instanceof ApiError ? err.message : "Failed to update status",
      );
    }
  }

  async function saveName() {
    try {
      const updated = await api.updatePopup(id, {
        name: name.trim() || "Untitled popup",
      });
      setName(updated.name);
    } catch (err) {
      await dialog.notify(
        err instanceof ApiError ? err.message : "Failed to save name",
      );
    }
  }

  if (authLoading)
    return (
      <div style={{ padding: 40 }} className="muted">
        Loading editor…
      </div>
    );
  if (!can("popups", "read"))
    return (
      <div style={{ padding: 40 }}>
        <div className="page-header">
          <h1>Popup editor</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  if (!loaded) {
    return (
      <div style={{ padding: 40 }} className="muted">
        Loading editor…
      </div>
    );
  }
  if (loadError) {
    return (
      <div style={{ padding: 40 }}>
        <p className="error">{loadError}</p>
        <button className="btn" onClick={() => router.push("/popups")}>
          ← Back to Popups
        </button>
      </div>
    );
  }
  if (!initialData || !settings) return null;

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
      ? "Saved ✓"
      : saveState === "error"
      ? "Save failed"
      : "";

  const needsPageList =
    settings.pageMode === "INCLUDE" || settings.pageMode === "EXCLUDE";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
        zIndex: 1000,
      }}
    >
      {/* Our toolbar owns the popup's controls: navigation + name + Active
          state + Settings. Puck's own header below keeps only the viewport
          switcher (its Publish button is hidden — see overrides). */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 14px",
          borderBottom: "1px solid var(--border)",
          flex: "none",
        }}
      >
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => router.push("/popups")}
        >
          ← Popups
        </button>
        <input
          aria-label="Popup name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          placeholder="Popup name"
          style={{ fontWeight: 600, minWidth: 220 }}
        />
        <span
          className={
            status === "ACTIVE" ? "badge badge--published" : "badge badge--draft"
          }
        >
          {status === "ACTIVE" ? "Active" : "Inactive"}
        </span>
        <span
          className="muted"
          style={{ marginLeft: "auto", minWidth: 72, textAlign: "right" }}
        >
          {saveLabel}
        </span>
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => setDrawerOpen(true)}
        >
          ⚙ Settings
        </button>
        <button
          className={status === "ACTIVE" ? "btn btn--ghost btn--sm" : "btn btn--sm"}
          onClick={() => saveStatus(status === "ACTIVE" ? "INACTIVE" : "ACTIVE")}
        >
          {status === "ACTIVE" ? "Deactivate" : "Activate"}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <Puck
          config={config}
          data={initialData}
          onChange={(data) => scheduleSave(data)}
          // Hide Puck's built-in "Publish" button — a popup's live state is
          // controlled by the Activate/Deactivate button in our toolbar above
          // (status ACTIVE/INACTIVE). The document autosaves via onChange, so
          // there's nothing for Publish to do. This removes the confusing
          // Activate-vs-Publish duplication.
          overrides={{ headerActions: () => <></> }}
        />
      </div>

      {/* ----- Slide-over Settings drawer ----- */}
      {drawerOpen && (
        <>
          <div
            onClick={() => setDrawerOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15,23,42,0.35)",
              zIndex: 1100,
            }}
          />
          <aside
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: 360,
              maxWidth: "90vw",
              background: "var(--surface)",
              borderLeft: "1px solid var(--border)",
              boxShadow: "-8px 0 24px rgba(15,23,42,0.12)",
              zIndex: 1101,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <strong>Popup settings</strong>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => setDrawerOpen(false)}
              >
                Done
              </button>
            </div>

            <div style={{ overflowY: "auto", padding: 16 }}>
              {/* Performance (read-only analytics) */}
              {stats && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-soft)",
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "8px 10px",
                    marginBottom: 16,
                  }}
                >
                  <strong>Performance:</strong> {stats.views} views ·{" "}
                  {stats.clicks} clicks · {stats.dismissals} closed
                  {stats.views
                    ? ` · ${Math.round((stats.clicks / stats.views) * 100)}% CTR`
                    : ""}
                </div>
              )}

              {/* Live preview */}
              <div style={{ marginBottom: 18 }}>
                <div style={drawerLabel}>Preview</div>
                <div
                  style={{
                    background:
                      "repeating-conic-gradient(#f1f5f9 0% 25%, #fff 0% 50%) 50% / 16px 16px",
                    borderRadius: 8,
                    padding: 16,
                    display: "flex",
                    justifyContent: "center",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      maxWidth: 260,
                      background: settings.background,
                      border: `1px solid ${settings.borderColor}`,
                      borderRadius: settings.borderRadius,
                      padding: settings.padding,
                      color: "#0f172a",
                      fontSize: 13,
                      boxShadow: "0 6px 20px rgba(15,23,42,0.18)",
                    }}
                  >
                    <strong>{name || "Popup"}</strong>
                    <p style={{ margin: "6px 0 0", color: "#475569" }}>
                      Your popup content renders here.
                    </p>
                  </div>
                </div>
              </div>

              {/* Style */}
              <div style={drawerSection}>Style</div>

              <div style={twoCol}>
                <label style={fieldWrap}>
                  <span style={drawerLabel}>Width</span>
                  <input
                    value={settings.width}
                    onChange={(e) => updateSettings({ width: e.target.value })}
                    placeholder="480px"
                    style={inputStyle}
                  />
                </label>
                <label style={fieldWrap}>
                  <span style={drawerLabel}>Height</span>
                  <input
                    value={settings.height}
                    onChange={(e) => updateSettings({ height: e.target.value })}
                    placeholder="auto"
                    style={inputStyle}
                  />
                </label>
              </div>

              <label style={fieldWrap}>
                <span style={drawerLabel}>Position on screen</span>
                <select
                  value={settings.position}
                  onChange={(e) =>
                    updateSettings({ position: e.target.value as PopupPosition })
                  }
                  style={inputStyle}
                >
                  {POSITION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={fieldWrap}>
                <span style={drawerLabel}>Background</span>
                <div style={colorRow}>
                  <input
                    type="color"
                    value={asHex(settings.background, "#ffffff")}
                    onChange={(e) =>
                      updateSettings({ background: e.target.value })
                    }
                    style={swatch}
                  />
                  <input
                    value={settings.background}
                    onChange={(e) =>
                      updateSettings({ background: e.target.value })
                    }
                    style={{ ...inputStyle, flex: 1 }}
                  />
                </div>
              </label>

              <label style={fieldWrap}>
                <span style={drawerLabel}>Border colour</span>
                <div style={colorRow}>
                  <input
                    type="color"
                    value={asHex(settings.borderColor, "#e2e8f0")}
                    onChange={(e) =>
                      updateSettings({ borderColor: e.target.value })
                    }
                    style={swatch}
                  />
                  <input
                    value={settings.borderColor}
                    onChange={(e) =>
                      updateSettings({ borderColor: e.target.value })
                    }
                    style={{ ...inputStyle, flex: 1 }}
                  />
                </div>
              </label>

              <div style={twoCol}>
                <label style={fieldWrap}>
                  <span style={drawerLabel}>Border radius (px)</span>
                  <input
                    type="number"
                    min={0}
                    max={200}
                    value={settings.borderRadius}
                    onChange={(e) =>
                      updateSettings({
                        borderRadius: Math.max(
                          0,
                          Math.min(200, Number(e.target.value) || 0)
                        ),
                      })
                    }
                    style={inputStyle}
                  />
                </label>
                <label style={fieldWrap}>
                  <span style={drawerLabel}>Padding (px)</span>
                  <input
                    type="number"
                    min={0}
                    max={200}
                    value={settings.padding}
                    onChange={(e) =>
                      updateSettings({
                        padding: Math.max(
                          0,
                          Math.min(200, Number(e.target.value) || 0)
                        ),
                      })
                    }
                    style={inputStyle}
                  />
                </label>
              </div>

              {/* Behaviour */}
              <div style={drawerSection}>Behaviour</div>

              <label style={fieldWrap}>
                <span style={drawerLabel}>Show the popup</span>
                <select
                  value={settings.trigger}
                  onChange={(e) =>
                    updateSettings({ trigger: e.target.value as PopupTrigger })
                  }
                  style={inputStyle}
                >
                  {TRIGGER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              {settings.trigger === "DELAY" && (
                <label style={fieldWrap}>
                  <span style={drawerLabel}>Delay (seconds)</span>
                  <input
                    type="number"
                    min={0}
                    max={600}
                    value={settings.triggerValue}
                    onChange={(e) =>
                      updateSettings({
                        triggerValue: Math.max(
                          0,
                          Math.min(600, Number(e.target.value) || 0)
                        ),
                      })
                    }
                    style={inputStyle}
                  />
                </label>
              )}

              {settings.trigger === "SCROLL" && (
                <label style={fieldWrap}>
                  <span style={drawerLabel}>Scroll depth (% of the page)</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={settings.triggerValue}
                    onChange={(e) =>
                      updateSettings({
                        triggerValue: Math.max(
                          1,
                          Math.min(100, Number(e.target.value) || 0)
                        ),
                      })
                    }
                    style={inputStyle}
                  />
                </label>
              )}

              <label style={fieldWrap}>
                <span style={drawerLabel}>How often</span>
                <select
                  value={settings.frequency}
                  onChange={(e) =>
                    updateSettings({
                      frequency: e.target.value as PopupFrequency,
                    })
                  }
                  style={inputStyle}
                >
                  {FREQUENCY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              {settings.frequency === "ONCE_PER_DAYS" && (
                <label style={fieldWrap}>
                  <span style={drawerLabel}>Days between showings</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={settings.frequencyDays}
                    onChange={(e) =>
                      updateSettings({
                        frequencyDays: Math.max(
                          1,
                          Math.min(365, Number(e.target.value) || 1)
                        ),
                      })
                    }
                    style={inputStyle}
                  />
                </label>
              )}

              <label style={fieldWrap}>
                <span style={drawerLabel}>Entrance animation</span>
                <select
                  value={settings.animation}
                  onChange={(e) =>
                    updateSettings({
                      animation: e.target.value as PopupAnimation,
                    })
                  }
                  style={inputStyle}
                >
                  {ANIMATION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 14,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={settings.closeOnOverlay}
                  onChange={(e) =>
                    updateSettings({ closeOnOverlay: e.target.checked })
                  }
                />
                <span>Clicking the dim backdrop closes the popup</span>
              </label>

              {/* Visibility */}
              <div style={drawerSection}>Visibility</div>

              <div style={drawerLabel}>In member areas</div>
              <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
                {SURFACE_OPTIONS.map((o) => (
                  <label
                    key={o.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={settings[o.key]}
                      onChange={(e) =>
                        updateSettings({
                          [o.key]: e.target.checked,
                        } as Partial<Settings>)
                      }
                    />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>

              <div style={drawerLabel}>On CMS pages</div>
              <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                {PAGE_MODE_OPTIONS.map((o) => (
                  <label
                    key={o.value}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="pageMode"
                      checked={settings.pageMode === o.value}
                      onChange={() => updateSettings({ pageMode: o.value })}
                    />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>

              {needsPageList && (
                <div
                  style={{
                    border: "1px solid #e2e5ea",
                    borderRadius: 8,
                    padding: 10,
                    maxHeight: 220,
                    overflowY: "auto",
                  }}
                >
                  {pages.length === 0 ? (
                    <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                      No pages yet. Create pages in the Pages tab first.
                    </p>
                  ) : (
                    pages.map((pg) => (
                      <label
                        key={pg.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "4px 0",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={settings.pageIds.includes(pg.id)}
                          onChange={() => togglePageId(pg.id)}
                        />
                        <span style={{ fontSize: 13 }}>
                          {pg.title}{" "}
                          <span className="muted">/{pg.slug}</span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              )}

              <p
                className="muted"
                style={{ fontSize: 12, marginTop: 16, lineHeight: 1.5 }}
              >
                Changes save automatically. Only <strong>Active</strong> popups
                appear to visitors.
              </p>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

// ----- inline style helpers (kept local; the editor is a one-off screen) -----
const drawerSection: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: "var(--muted)",
  margin: "18px 0 10px",
  borderTop: "1px solid var(--border)",
  paddingTop: 14,
};
const drawerLabel: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-soft)",
  marginBottom: 4,
};
const fieldWrap: React.CSSProperties = { display: "block", marginBottom: 12 };
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 9px",
  border: "1px solid var(--border-strong)",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
  background: "var(--surface-2)",
  color: "var(--text)",
};
const twoCol: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 10,
};
const colorRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};
const swatch: React.CSSProperties = {
  width: 38,
  height: 34,
  padding: 0,
  border: "1px solid var(--border-strong)",
  borderRadius: 6,
  background: "none",
  cursor: "pointer",
};
