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
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";

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
  if (s.status === "CANCELED") return { label: "Canceled", cls: "badge badge--draft" };
  if (s.status === "DRAFT") return { label: "Draft", cls: "badge badge--draft" };
  const now = Date.now();
  const starts = Date.parse(s.startsAt);
  const ends = Date.parse(s.endsAt);
  if (now >= ends) return { label: "Ended", cls: "badge badge--draft" };
  if (now >= starts) return { label: "● Live", cls: "badge badge--published" };
  return { label: "Scheduled", cls: "badge badge--published" };
}

function fmtStart(s: AdminLiveSessionDTO): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: s.timezone ?? undefined,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(s.startsAt));
  } catch {
    return new Date(s.startsAt).toLocaleString();
  }
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

  // ---------------- list view ----------------
  if (mode === "list") {
    return (
      <div>
        <div className="page-header with-action">
          <div>
            <h1>Live Sessions</h1>
            <p className="subtitle">
              Schedule a Zoom or Google Meet call. Entitled members see a
              countdown on their dashboard and join from a gated page — the link
              and passcode are stored encrypted and revealed only in the join
              window.
            </p>
          </div>
          {can("liveSessions", "create") && (
            <button className="btn" onClick={openCreate}>
              + New live session
            </button>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        <div className="card">
          {loading ? (
            <p className="muted">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="muted">No live sessions yet. Click “New live session”.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Provider</th>
                    <th>Audience</th>
                    <th>Starts</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => {
                    const st = statusInfo(s);
                    return (
                      <tr key={s.id}>
                        <td>{s.title}</td>
                        <td className="muted">{providerLabel(s.provider)}</td>
                        <td className="muted">
                          {s.targetsEmpty ? (
                            <span className="badge badge--draft">No audience</span>
                          ) : (
                            s.audienceLabel
                          )}
                        </td>
                        <td className="muted">{fmtStart(s)}</td>
                        <td>
                          <span className={st.cls}>{st.label}</span>
                        </td>
                        <td>
                          <div className="row-actions">
                            {s.status === "DRAFT" && can("liveSessions", "edit") && (
                              <button
                                className="btn btn--ghost btn--sm"
                                onClick={() => publish(s)}
                              >
                                Publish
                              </button>
                            )}
                            {can("liveSessions", "edit") && (
                              <button
                                className="btn btn--ghost btn--sm"
                                onClick={() => openEdit(s.id)}
                              >
                                Edit
                              </button>
                            )}
                            {can("liveSessions", "delete") && (
                              <button
                                className="btn btn--danger btn--sm"
                                onClick={() => remove(s)}
                              >
                                {s.status === "SCHEDULED" ? "Cancel" : "Delete"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
