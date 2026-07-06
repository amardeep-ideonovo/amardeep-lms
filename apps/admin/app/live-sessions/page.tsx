"use client";

import { FormEvent, useEffect, useState } from "react";
import type {
  AdminLiveSessionDTO,
  LevelDTO,
  LiveAudience,
  LiveProvider,
  LiveSessionInput,
  UpdateLiveSessionInput,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { classAccentIndex } from "@/lib/class-accent";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";
import RowMenu from "@/components/RowMenu";

const pad = (n: number) => String(n).padStart(2, "0");

// Browser IANA zone (fallback UTC), used as the default for a new session.
function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// ISO UTC instant -> "YYYY-MM-DDTHH:mm" wall-time as seen in `tz` (for editing).
function isoToLocalInput(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = g("hour") === "24" ? "00" : g("hour");
  return `${g("year")}-${g("month")}-${g("day")}T${hour}:${g("minute")}`;
}

function defaultStartLocal(tz: string): string {
  return isoToLocalInput(new Date(Date.now() + 3_600_000).toISOString(), tz);
}

function tzOptions(): string[] {
  try {
    const all = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    if (all && all.length) return all;
  } catch {
    /* older runtime */
  }
  return [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "Europe/London",
    "Europe/Paris",
    "Asia/Kolkata",
    "Asia/Singapore",
    "Australia/Sydney",
  ];
}

function providerLabel(p: LiveProvider): string {
  return p === "ZOOM" ? "Zoom" : "Google Meet";
}

// Human status for the list, derived from the clock for a SCHEDULED session.
function statusInfo(s: AdminLiveSessionDTO): { label: string; cls: string } {
  if (s.status === "CANCELED") return { label: "Canceled", cls: "badge badge--neutral" };
  if (s.status === "DRAFT") return { label: "Draft", cls: "badge badge--draft" };
  const now = Date.now();
  const starts = Date.parse(s.startsAt);
  const ends = Date.parse(s.endsAt);
  if (now >= ends) return { label: "Ended", cls: "badge badge--neutral" };
  if (now >= starts) return { label: "Live", cls: "badge badge--ok" };
  return { label: "Scheduled", cls: "badge badge--ok" };
}

function fmtStart(s: AdminLiveSessionDTO): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: s.timezone ?? undefined,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(s.startsAt));
  } catch {
    return new Date(s.startsAt).toLocaleString();
  }
}

// Buckets for the Ink Hero list: upcoming (this week / later), drafts, past.
type Bucket = "week" | "later" | "draft" | "past";
function bucketOf(s: AdminLiveSessionDTO): Bucket {
  if (s.status === "DRAFT") return "draft";
  if (s.status === "CANCELED") return "past";
  const now = Date.now();
  if (Date.parse(s.endsAt) <= now) return "past";
  const starts = Date.parse(s.startsAt);
  return starts - now < 7 * 86_400_000 ? "week" : "later";
}

// Class accent text colors — cycle by stable class-list index (Ink Hero
// decision: the seeded catalog then matches the mocks). Tint = color + "1f".
const CLASS_TAG_COLORS = [
  "#b46f0a",
  "#7a3bab",
  "#2d7a45",
  "#c03a3a",
  "#3a62b4",
  "#1f8a7c",
];

// Red-dot countdown chip text, computed from the real session datetime.
function countdown(s: AdminLiveSessionDTO): string | null {
  const now = Date.now();
  const starts = Date.parse(s.startsAt);
  const ends = Date.parse(s.endsAt);
  if (now >= starts && now < ends) return "Live now";
  const days = Math.ceil((starts - now) / 86_400_000);
  if (days <= 0) return "Live today";
  if (days === 1) return "Live in 1 day";
  if (days <= 7) return `Live in ${days} days`;
  return null;
}

type EditorState = {
  title: string;
  description: string;
  provider: LiveProvider;
  audience: LiveAudience;
  levelIds: string[];
  joinUrl: string;
  replaceUrl: boolean; // editing: send a new URL (else keep stored ciphertext)
  hasJoinUrl: boolean;
  password: string;
  replacePassword: boolean;
  clearPassword: boolean;
  hasPassword: boolean;
  startsAtLocal: string;
  timezone: string;
  durationMin: number;
  joinLeadMin: number;
};

function newSession(): EditorState {
  const tz = browserTz();
  return {
    title: "",
    description: "",
    provider: "ZOOM",
    audience: "LEVELS",
    levelIds: [],
    joinUrl: "",
    replaceUrl: true,
    hasJoinUrl: false,
    password: "",
    replacePassword: true,
    clearPassword: false,
    hasPassword: false,
    startsAtLocal: defaultStartLocal(tz),
    timezone: tz,
    durationMin: 60,
    joinLeadMin: 10,
  };
}

export default function LiveSessionsPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const [sessions, setSessions] = useState<AdminLiveSessionDTO[]>([]);
  const [levels, setLevels] = useState<LevelDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditorState>(newSession());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const zones = tzOptions();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setSessions(await api.listLiveSessions());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load live sessions");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (authLoading || !can("liveSessions", "read")) return;
    load();
    // Classes for the audience picker (used in the editor).
    api.listLevels().then(setLevels).catch(() => setLevels([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  function openCreate() {
    setEditingId(null);
    setForm(newSession());
    setFormError(null);
    setMode("edit");
  }

  async function openEdit(id: string) {
    setFormError(null);
    setMode("edit");
    try {
      const s = await api.getLiveSession(id);
      const tz = s.timezone ?? browserTz();
      setEditingId(s.id);
      setForm({
        title: s.title,
        description: s.description ?? "",
        provider: s.provider,
        audience: s.audience,
        levelIds: s.levelIds,
        joinUrl: "",
        replaceUrl: !s.hasJoinUrl,
        hasJoinUrl: s.hasJoinUrl,
        password: "",
        replacePassword: !s.hasPassword,
        clearPassword: false,
        hasPassword: s.hasPassword,
        startsAtLocal: isoToLocalInput(s.startsAt, tz),
        timezone: tz,
        durationMin: s.durationMin,
        joinLeadMin: s.joinLeadMin,
      });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to load session");
    }
  }

  function backToList() {
    setMode("list");
    setEditingId(null);
    load();
  }

  function toggleLevel(id: string) {
    setForm((f) => ({
      ...f,
      levelIds: f.levelIds.includes(id)
        ? f.levelIds.filter((x) => x !== id)
        : [...f.levelIds, id],
    }));
  }

  async function testLink() {
    if (!editingId) return;
    try {
      const { joinUrl } = await api.revealLiveSession(editingId);
      window.open(joinUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not load the link");
    }
  }

  // "Start live room" — reveal the stored join URL (edit permission) and open
  // it in a new tab so the admin lands in their Zoom/Meet room.
  async function startLiveRoom(id: string) {
    setError(null);
    try {
      const { joinUrl } = await api.revealLiveSession(id);
      window.open(joinUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the link");
    }
  }

  // Cover art for a session card: the first targeted class's real cover image
  // (sessions have no artwork of their own; ALL_ACTIVE sessions get none).
  function coverFor(s: AdminLiveSessionDTO): string | null {
    for (const id of s.levelIds) {
      const img = levels.find((l) => l.id === id)?.imageUrl;
      if (img) return img;
    }
    return null;
  }

  // Accent for the class tag pill — stable index of the first targeted class.
  function tagColorFor(s: AdminLiveSessionDTO): string | null {
    if (!s.levelIds.length) return null;
    const idx = levels.findIndex((l) => l.id === s.levelIds[0]);
    if (idx < 0) return null;
    return CLASS_TAG_COLORS[
      classAccentIndex(levels[idx].name, idx) % CLASS_TAG_COLORS.length
    ];
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const isMeet = form.provider === "GOOGLE_MEET";
    try {
      if (editingId) {
        const payload: UpdateLiveSessionInput = {
          title: form.title.trim(),
          description: form.description.trim() || null,
          provider: form.provider,
          audience: form.audience,
          levelIds: form.audience === "LEVELS" ? form.levelIds : undefined,
          startsAtLocal: form.startsAtLocal,
          timezone: form.timezone,
          durationMin: form.durationMin,
          joinLeadMin: form.joinLeadMin,
        };
        if (form.replaceUrl && form.joinUrl.trim())
          payload.joinUrl = form.joinUrl.trim();
        if (!isMeet) {
          if (form.clearPassword) payload.password = "";
          else if (form.replacePassword && form.password)
            payload.password = form.password;
        }
        await api.updateLiveSession(editingId, payload);
      } else {
        const payload: LiveSessionInput = {
          title: form.title.trim(),
          description: form.description.trim() || null,
          provider: form.provider,
          audience: form.audience,
          levelIds: form.audience === "LEVELS" ? form.levelIds : undefined,
          joinUrl: form.joinUrl.trim(),
          password: !isMeet && form.password ? form.password : undefined,
          startsAtLocal: form.startsAtLocal,
          timezone: form.timezone,
          durationMin: form.durationMin,
          joinLeadMin: form.joinLeadMin,
        };
        await api.createLiveSession(payload);
      }
      backToList();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to save session");
    } finally {
      setSaving(false);
    }
  }

  async function publish(s: AdminLiveSessionDTO) {
    if (
      s.audience === "ALL_ACTIVE" &&
      !(await dialog.confirm({
        message:
          "Publish to ALL active members? Everyone with a paid membership will see this live session.",
      }))
    )
      return;
    setError(null);
    try {
      await api.publishLiveSession(s.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to publish");
    }
  }

  async function remove(s: AdminLiveSessionDTO) {
    const scheduled = s.status === "SCHEDULED";
    const ok = await dialog.confirm({
      message: scheduled
        ? `Cancel "${s.title}"? Members who can see it will get a "canceled" notice.`
        : `Delete "${s.title}"?`,
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api.deleteLiveSession(s.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  }

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("liveSessions", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Live Sessions</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  // ---------------- list view (Ink Hero: This week / Later / Drafts / Past) ----------------
  if (mode === "list") {
    const week = sessions
      .filter((s) => bucketOf(s) === "week")
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    const later = sessions
      .filter((s) => bucketOf(s) === "later")
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    const drafts = sessions.filter((s) => bucketOf(s) === "draft");
    const past = sessions
      .filter((s) => bucketOf(s) === "past")
      .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));

    // One upcoming-session card row (This week / Later / Drafts share it).
    const sessionCard = (s: AdminLiveSessionDTO, kind: "week" | "later" | "draft") => {
      const cover = coverFor(s);
      const tagColor = tagColorFor(s);
      const chip = kind === "week" ? countdown(s) : null;
      const menuItems = [
        ...(can("liveSessions", "delete")
          ? [
              {
                label: s.status === "SCHEDULED" ? "Cancel session" : "Delete",
                danger: true,
                onClick: () => remove(s),
              },
            ]
          : []),
      ];
      return (
        <div
          className={kind === "week" ? "live-card" : "live-card live-card--later"}
          key={s.id}
        >
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" className="live-card-thumb" />
          ) : (
            <span className="live-card-thumb row-thumb--empty" aria-hidden="true">
              {providerLabel(s.provider)}
            </span>
          )}
          <span className="live-card-main">
            <span className="live-card-title">{s.title}</span>
            <span className="live-card-meta">
              {s.targetsEmpty ? (
                <span className="badge badge--warn">No audience</span>
              ) : (
                <span
                  className="class-tag"
                  style={
                    tagColor
                      ? { background: `${tagColor}1f`, color: tagColor }
                      : undefined
                  }
                >
                  {s.audienceLabel}
                </span>
              )}
              <span className="live-card-when">{fmtStart(s)}</span>
              {chip && (
                <span className="live-chip">
                  <span className="live-dot" />
                  {chip}
                </span>
              )}
              {kind === "draft" && (
                <span className="badge badge--draft">Draft</span>
              )}
            </span>
          </span>
          <span className="live-card-aud">{providerLabel(s.provider)}</span>
          {can("liveSessions", "edit") && (
            <button className="btn btn--ghost" onClick={() => openEdit(s.id)}>
              Manage
            </button>
          )}
          {kind === "draft" && can("liveSessions", "edit") && (
            <button className="btn" onClick={() => publish(s)}>
              Publish
            </button>
          )}
          {kind === "week" && s.hasJoinUrl && can("liveSessions", "edit") && (
            <button className="btn" onClick={() => startLiveRoom(s.id)}>
              Start live room
            </button>
          )}
          {menuItems.length > 0 && (
            <RowMenu label={`Actions for ${s.title}`} items={menuItems} />
          )}
        </div>
      );
    };

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="filter-row" style={{ marginBottom: 0 }}>
          <p className="subtitle" style={{ maxWidth: 620 }}>
            Schedule a Zoom or Google Meet call. Entitled members see a countdown
            on their dashboard and join from a gated page — credentials stay
            encrypted until the join window.
          </p>
          <div className="filter-spacer" />
          {can("liveSessions", "create") && (
            <button className="btn" onClick={openCreate}>
              + Schedule session
            </button>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        {loading ? (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              Loading…
            </p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              No live sessions yet. Click “+ Schedule session”.
            </p>
          </div>
        ) : (
          <>
            {week.length > 0 && (
              <>
                <div className="section-label">This week</div>
                {week.map((s) => sessionCard(s, "week"))}
              </>
            )}
            {later.length > 0 && (
              <>
                <div className="section-label">Later</div>
                {later.map((s) => sessionCard(s, "later"))}
              </>
            )}
            {drafts.length > 0 && (
              <>
                <div className="section-label">Drafts</div>
                {drafts.map((s) => sessionCard(s, "draft"))}
              </>
            )}
            {past.length > 0 && (
              <div className="card" style={{ marginBottom: 0 }}>
                <h2 style={{ marginBottom: 4 }}>Past sessions</h2>
                {past.map((s) => {
                  const st = statusInfo(s);
                  return (
                    <div
                      className="mini-grid"
                      style={{ gridTemplateColumns: "2fr .9fr .6fr .7fr .4fr" }}
                      key={s.id}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--ink-800)",
                        }}
                      >
                        {s.title}
                      </span>
                      <span className="mini-cell--muted">{fmtStart(s)}</span>
                      <span className="mini-cell">{s.durationMin} min</span>
                      <span>
                        <span className={st.cls}>{st.label}</span>
                      </span>
                      <span style={{ textAlign: "right" }}>
                        {can("liveSessions", "delete") && (
                          <RowMenu
                            label={`Actions for ${s.title}`}
                            items={[
                              {
                                label: "Delete",
                                danger: true,
                                onClick: () => remove(s),
                              },
                            ]}
                          />
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ---------------- editor view ----------------
  const isMeet = form.provider === "GOOGLE_MEET";
  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>{editingId ? "Edit live session" : "New live session"}</h1>
          <p className="subtitle">
            Saved as a draft. Publish it from the list to make it visible to
            members.
          </p>
        </div>
        <button className="btn btn--ghost" onClick={backToList}>
          ← Back to live sessions
        </button>
      </div>

      {formError && <p className="error">{formError}</p>}

      <form onSubmit={save} style={{ maxWidth: 720 }}>
        <div className="card">
          <div className="field">
            <label>Title</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Live Q&amp;A with the instructor"
              required
            />
          </div>
          <div className="field">
            <label>Description <span className="muted">(optional)</span></label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              style={{ minHeight: 56 }}
            />
          </div>
        </div>

        <div className="card">
          <h2>Meeting</h2>
          <div className="field">
            <label>Provider</label>
            <select
              value={form.provider}
              onChange={(e) =>
                setForm({ ...form, provider: e.target.value as LiveProvider })
              }
            >
              <option value="ZOOM">Zoom</option>
              <option value="GOOGLE_MEET">Google Meet</option>
            </select>
          </div>

          <div className="field">
            <label>Meeting link</label>
            {form.hasJoinUrl && !form.replaceUrl ? (
              <div className="row-actions">
                <span className="muted">A link is saved.</span>
                <button type="button" className="btn btn--ghost btn--sm" onClick={testLink}>
                  Test link
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setForm({ ...form, replaceUrl: true })}
                >
                  Replace link
                </button>
              </div>
            ) : (
              <input
                type="url"
                value={form.joinUrl}
                onChange={(e) => setForm({ ...form, joinUrl: e.target.value })}
                placeholder={
                  isMeet
                    ? "https://meet.google.com/abc-defg-hij"
                    : "https://us02web.zoom.us/j/…"
                }
                required={!editingId}
              />
            )}
            <p className="muted" style={{ marginTop: 4 }}>
              Must be an https {providerLabel(form.provider)} link. Stored
              encrypted; members only see it in the join window.
            </p>
          </div>

          {!isMeet && (
            <div className="field">
              <label>Passcode <span className="muted">(optional)</span></label>
              {form.hasPassword && !form.replacePassword ? (
                <div className="row-actions">
                  <span className="muted">A passcode is saved.</span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setForm({ ...form, replacePassword: true })}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() =>
                      setForm({ ...form, clearPassword: true, replacePassword: false })
                    }
                  >
                    Clear
                  </button>
                </div>
              ) : form.clearPassword ? (
                <div className="row-actions">
                  <span className="muted">Passcode will be cleared.</span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setForm({ ...form, clearPassword: false })}
                  >
                    Undo
                  </button>
                </div>
              ) : (
                <input
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Meeting passcode"
                />
              )}
              {form.provider === "ZOOM" && (
                <p className="muted" style={{ marginTop: 4 }}>
                  Leave empty if the passcode is already embedded in the link.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <h2>Audience</h2>
          <div className="field">
            <label>Who can see this?</label>
            <select
              value={form.audience}
              onChange={(e) =>
                setForm({ ...form, audience: e.target.value as LiveAudience })
              }
            >
              <option value="LEVELS">Members of specific classes</option>
              <option value="ALL_ACTIVE">All active members</option>
            </select>
          </div>
          {form.audience === "LEVELS" && (
            <div className="field">
              <label>Classes</label>
              {levels.length === 0 ? (
                <p className="muted">No classes found.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {levels.map((l) => (
                    <label
                      key={l.id}
                      style={{ display: "flex", gap: 8, alignItems: "center" }}
                    >
                      <input
                        type="checkbox"
                        checked={form.levelIds.includes(l.id)}
                        onChange={() => toggleLevel(l.id)}
                      />
                      {l.name}
                    </label>
                  ))}
                </div>
              )}
              {form.levelIds.length === 0 && (
                <p className="muted" style={{ marginTop: 4 }}>
                  Select at least one class before publishing.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <h2>Schedule</h2>
          <div className="form-row">
            <div className="field">
              <label>Starts</label>
              <input
                type="datetime-local"
                value={form.startsAtLocal}
                onChange={(e) =>
                  setForm({ ...form, startsAtLocal: e.target.value })
                }
                required
              />
            </div>
            <div className="field">
              <label>Time zone</label>
              <select
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label>Duration (minutes)</label>
              <input
                type="number"
                min={5}
                max={600}
                value={form.durationMin}
                onChange={(e) =>
                  setForm({ ...form, durationMin: Number(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>Join opens (minutes before)</label>
              <input
                type="number"
                min={0}
                max={1440}
                value={form.joinLeadMin}
                onChange={(e) =>
                  setForm({ ...form, joinLeadMin: Number(e.target.value) })
                }
              />
            </div>
          </div>
        </div>

        <div className="row-actions" style={{ marginTop: 16 }}>
          <button className="btn" type="submit" disabled={saving}>
            {saving ? "Saving…" : editingId ? "Save changes" : "Create draft"}
          </button>
          <button type="button" className="btn btn--ghost" onClick={backToList}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
