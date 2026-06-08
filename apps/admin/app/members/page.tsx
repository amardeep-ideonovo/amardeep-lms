"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { LevelDTO, MemberRow } from "@lms/types";
import { ApiError, api } from "@/lib/api";

export default function MembersPage() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [levels, setLevels] = useState<LevelDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // per-member "add level" select value
  const [pending, setPending] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // filter the list by held level ("" = all, levelId, or "__none__" = no level)
  const [filterLevel, setFilterLevel] = useState("");
  // free-text search by email (case-insensitive substring)
  const [search, setSearch] = useState("");

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
    load();
  }, []);

  async function addLevel(memberId: string) {
    const levelId = pending[memberId];
    if (!levelId) return;
    setBusy(memberId);
    setError(null);
    try {
      await api.addMemberLevel(memberId, levelId);
      setPending((p) => ({ ...p, [memberId]: "" }));
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
    if (q && !m.email.toLowerCase().includes(q)) return false;
    if (filterLevel === "") return true;
    if (filterLevel === "__none__") return m.levels.length === 0;
    return m.levels.some((l) => l.id === filterLevel);
  });

  return (
    <div>
      <div className="page-header">
        <h1>Members</h1>
        <p className="subtitle">
          Edit a member’s details, or manually grant/revoke a class. Manual
          grants coexist with paid subscriptions.
        </p>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : members.length === 0 ? (
          <p className="muted">No members yet.</p>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 14,
                flexWrap: "wrap",
              }}
            >
              <label htmlFor="member-search" style={{ fontWeight: 600 }}>
                Search email
              </label>
              <input
                id="member-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type an email…"
                style={{ minWidth: 220 }}
              />
              <label htmlFor="level-filter" style={{ fontWeight: 600 }}>
                Filter by class
              </label>
              <select
                id="level-filter"
                value={filterLevel}
                onChange={(e) => setFilterLevel(e.target.value)}
              >
                <option value="">All classes</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
                <option value="__none__">No class</option>
              </select>
              <span className="muted" style={{ fontSize: 13 }}>
                Showing {filtered.length} of {members.length}
              </span>
            </div>
            {filtered.length === 0 ? (
              <p className="muted">No members match this filter.</p>
            ) : (
              <div className="table-wrap"><table className="table">
                <thead>
              <tr>
                <th>First name</th>
                <th>Last name</th>
                <th>Email</th>
                <th>Registered</th>
                <th>Classes</th>
                <th>Subscription</th>
                <th>Add class</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const heldIds = new Set(m.levels.map((l) => l.id));
                const available = levels.filter((l) => !heldIds.has(l.id));
                return (
                  <tr key={m.id}>
                    <td>{m.firstName || <span className="muted">—</span>}</td>
                    <td>{m.lastName || <span className="muted">—</span>}</td>
                    <td>
                      <Link
                        href={`/members/${m.id}`}
                        className="linklike"
                        title="View subscription & payments"
                      >
                        {m.email}
                      </Link>
                    </td>
                    <td>
                      {new Date(m.registeredAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td>
                      {m.levels.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        <div className="chips">
                          {m.levels.map((l) => (
                            <span key={`${l.id}-${l.source}`} className="chip">
                              {l.name}
                              <span className="muted" style={{ fontSize: 11 }}>
                                {l.lifetime ? "LIFETIME" : l.status}
                              </span>
                              {l.source === "MANUAL" ? (
                                <button
                                  className="chip-x"
                                  title="Remove manual grant"
                                  disabled={busy === m.id}
                                  onClick={() => removeLevel(m.id, l.id)}
                                >
                                  ×
                                </button>
                              ) : (
                                <span
                                  className="muted"
                                  style={{ fontSize: 11 }}
                                  title="From a paid subscription — manage it in Subscriptions / Stripe, not here"
                                >
                                  · paid
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      {m.subscription ? (
                        <span
                          className={`chip${m.subscription.active ? "" : " chip--muted"}`}
                          title={`Subscription ${m.subscription.status}`}
                        >
                          {m.subscription.planName}
                          <span className="muted" style={{ fontSize: 11 }}>
                            {m.subscription.active
                              ? m.subscription.status
                              : "INACTIVE"}
                          </span>
                        </span>
                      ) : (
                        <span className="muted">None</span>
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        <select
                          value={pending[m.id] ?? ""}
                          onChange={(e) =>
                            setPending((p) => ({
                              ...p,
                              [m.id]: e.target.value,
                            }))
                          }
                        >
                          <option value="">Select…</option>
                          {available.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn btn--sm"
                          disabled={busy === m.id || !pending[m.id]}
                          onClick={() => addLevel(m.id)}
                        >
                          Add
                        </button>
                      </div>
                    </td>
                    <td>
                      <Link
                        href={`/members/${m.id}/edit`}
                        className="btn btn--ghost btn--sm"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
              </table></div>
            )}
          </>
        )}
      </div>

    </div>
  );
}

// (Per-member billing detail now lives on its own page: app/members/[id]/page.tsx)
