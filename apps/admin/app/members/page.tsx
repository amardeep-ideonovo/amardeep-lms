"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { LevelDTO, MemberRow } from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import RowMenu from "@/components/RowMenu";

const PAGE_SIZE = 8; // rows per page (Ink Hero frame 2h)

// "Jul 4" (adds the year once it's not this year).
function shortDate(iso: string): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === new Date().getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return d.toLocaleDateString(undefined, opts);
}

function initialsOf(name: string, email: string): string {
  const src = name.trim() || email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Membership status pill, derived from the paid-subscription summary. Members
// without a subscription have an active account (they registered) → "Active".
function memberStatus(m: MemberRow): { label: string; cls: string } {
  if (!m.subscription) return { label: "Active", cls: "badge badge--ok" };
  if (m.subscription.active) {
    return m.subscription.status === "PAST_DUE"
      ? { label: "Past due", cls: "badge badge--warn" }
      : { label: "Active", cls: "badge badge--ok" };
  }
  switch (m.subscription.status) {
    case "PAST_DUE":
      return { label: "Past due", cls: "badge badge--warn" };
    case "PAUSED":
      return { label: "Paused", cls: "badge badge--warn" };
    case "CANCELED":
      return { label: "Canceled", cls: "badge badge--neutral" };
    case "EXPIRED":
      return { label: "Expired", cls: "badge badge--neutral" };
    default:
      return { label: "Inactive", cls: "badge badge--neutral" };
  }
}

const GRID = "2fr .9fr 1.5fr .6fr .8fr .3fr";

export default function MembersPage() {
  const router = useRouter();
  const { can, loading: authLoading } = useAdminAuth();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [levels, setLevels] = useState<LevelDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // "grant a class" modal target + selected level
  const [grantFor, setGrantFor] = useState<MemberRow | null>(null);
  const [grantLevelId, setGrantLevelId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // filter the list by held level ("" = all, levelId, or "__none__" = no level)
  const [filterLevel, setFilterLevel] = useState("");
  // filter by derived membership status ("" = all)
  const [filterStatus, setFilterStatus] = useState("");
  // free-text search by name/email (case-insensitive substring)
  const [search, setSearch] = useState("");
  // client-side pagination (the API returns the full list)
  const [page, setPage] = useState(0);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [m, l] = await Promise.all([api.listMembers(), api.listLevels()]);
      setMembers(m);
      setLevels(l);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load members");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading || !can("members", "read")) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  function openGrant(m: MemberRow) {
    setGrantFor(m);
    setGrantLevelId("");
  }

  async function addLevel() {
    if (!grantFor || !grantLevelId) return;
    setBusy(grantFor.id);
    setError(null);
    try {
      await api.addMemberLevel(grantFor.id, grantLevelId);
      setGrantFor(null);
      setGrantLevelId("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add class");
    } finally {
      setBusy(null);
    }
  }

  async function removeLevel(memberId: string, levelId: string) {
    setBusy(memberId);
    setError(null);
    try {
      await api.removeMemberLevel(memberId, levelId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove class");
    } finally {
      setBusy(null);
    }
  }

  const q = search.trim().toLowerCase();
  const filtered = members.filter((m) => {
    if (q) {
      const name = [m.firstName, m.lastName].filter(Boolean).join(" ");
      const hay = `${m.email} ${name} ${m.username}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filterStatus && memberStatus(m).label !== filterStatus) return false;
    if (filterLevel === "") return true;
    if (filterLevel === "__none__") return m.levels.length === 0;
    return m.levels.some((l) => l.id === filterLevel);
  });

  // Keep the page in range as filters change.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );
  const from = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const to = Math.min(filtered.length, (safePage + 1) * PAGE_SIZE);

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("members", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Members</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  return (
    <div>
      {error && <p className="error">{error}</p>}

      {/* filter row */}
      <div className="filter-row">
        <div className="filter-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder={`Search ${members.length.toLocaleString()} members…`}
            aria-label="Search members"
          />
        </div>
        <select
          className="filter-select"
          aria-label="Filter by status"
          value={filterStatus}
          onChange={(e) => {
            setFilterStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Status: All</option>
          <option value="Active">Active</option>
          <option value="Past due">Past due</option>
          <option value="Paused">Paused</option>
          <option value="Canceled">Canceled</option>
          <option value="Expired">Expired</option>
        </select>
        <select
          className="filter-select"
          aria-label="Filter by class"
          value={filterLevel}
          onChange={(e) => {
            setFilterLevel(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Class: All</option>
          {levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          <option value="__none__">No class</option>
        </select>
        <div className="filter-spacer" />
        <span className="filter-count">
          {members.length.toLocaleString()} members
        </span>
      </div>

      {/* members table */}
      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : members.length === 0 ? (
          <p className="muted">No members yet.</p>
        ) : filtered.length === 0 ? (
          <p className="muted">No members match this filter.</p>
        ) : (
          <>
            <div
              className="mini-grid mini-grid--head"
              style={{ gridTemplateColumns: GRID }}
            >
              <span>Member</span>
              <span>Plan</span>
              <span>Classes</span>
              <span>Joined</span>
              <span>Status</span>
              <span />
            </div>
            {pageRows.map((m) => {
              const name = [m.firstName, m.lastName].filter(Boolean).join(" ");
              const display = name || m.username || m.email;
              const st = memberStatus(m);
              return (
                <div
                  className="mini-grid"
                  style={{ gridTemplateColumns: GRID }}
                  key={m.id}
                >
                  <button
                    type="button"
                    className="mini-member"
                    style={{
                      border: "none",
                      background: "none",
                      padding: 0,
                      font: "inherit",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                    title="View subscription & payments"
                    onClick={() => router.push(`/members/${m.id}`)}
                  >
                    <span className="ava" aria-hidden="true">
                      {initialsOf(display, m.email)}
                    </span>
                    <span className="mini-member-main">
                      <span className="mini-member-name">{display}</span>
                      <span className="mini-member-sub">{m.email}</span>
                    </span>
                  </button>
                  <span className="mini-cell" style={{ fontSize: 12.5 }}>
                    {m.subscription?.planName ?? "—"}
                  </span>
                  <span>
                    {m.levels.length === 0 ? (
                      <span className="mini-cell--muted">—</span>
                    ) : (
                      <span className="chips">
                        {m.levels.map((l) => (
                          <span key={`${l.id}-${l.source}`} className="chip">
                            {l.name}
                            {l.lifetime ? (
                              <span className="muted" style={{ fontSize: 10.5 }}>
                                LIFETIME
                              </span>
                            ) : null}
                            {l.source === "MANUAL" ? (
                              <button
                                className="chip-x"
                                title="Remove manual grant"
                                disabled={busy === m.id}
                                onClick={() => removeLevel(m.id, l.id)}
                              >
                                ×
                              </button>
                            ) : null}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="mini-cell--muted">
                    {shortDate(m.registeredAt)}
                  </span>
                  <span>
                    <span className={st.cls} title={m.subscription?.status}>
                      {st.label}
                    </span>
                  </span>
                  <span style={{ textAlign: "right" }}>
                    <RowMenu
                      label={`Actions for ${display}`}
                      items={[
                        {
                          label: "View billing",
                          onClick: () => router.push(`/members/${m.id}`),
                        },
                        {
                          label: "Edit details",
                          onClick: () => router.push(`/members/${m.id}/edit`),
                        },
                        { label: "Add class…", onClick: () => openGrant(m) },
                      ]}
                    />
                  </span>
                </div>
              );
            })}
            <div className="table-foot">
              <span>
                Showing {from}–{to} of {filtered.length.toLocaleString()}
              </span>
              <div className="spacer" />
              <button
                type="button"
                className="page-btn"
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                ← Prev
              </button>
              <button
                type="button"
                className="page-btn"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </div>

      {/* add-class (manual grant) modal */}
      {grantFor && (
        <div
          className="modal-overlay modal-overlay--center"
          onClick={() => setGrantFor(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="modal modal--confirm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Add class</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setGrantFor(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="muted" style={{ marginTop: 0 }}>
                Manually grant{" "}
                <b style={{ color: "var(--ink-800)" }}>
                  {[grantFor.firstName, grantFor.lastName]
                    .filter(Boolean)
                    .join(" ") || grantFor.email}
                </b>{" "}
                a class. Manual grants coexist with paid subscriptions.
              </p>
              <div className="field">
                <label htmlFor="grant-level">Class</label>
                <select
                  id="grant-level"
                  value={grantLevelId}
                  onChange={(e) => setGrantLevelId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {levels
                    .filter(
                      (l) => !grantFor.levels.some((held) => held.id === l.id),
                    )
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setGrantFor(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!grantLevelId || busy === grantFor.id}
                  onClick={addLevel}
                >
                  {busy === grantFor.id ? "Adding…" : "Add class"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// (Per-member billing detail lives on its own page: app/members/[id]/page.tsx)
