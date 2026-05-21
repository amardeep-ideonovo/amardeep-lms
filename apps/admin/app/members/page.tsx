"use client";

import { useEffect, useState } from "react";
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
      setError(err instanceof ApiError ? err.message : "Failed to add level");
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
      setError(err instanceof ApiError ? err.message : "Failed to remove level");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Members</h1>
        <p className="subtitle">
          Manually grant or revoke a level. Manual grants coexist with paid
          subscriptions.
        </p>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : members.length === 0 ? (
          <p className="muted">No members yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Registered</th>
                <th>Levels</th>
                <th>Add level</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const heldIds = new Set(m.levels.map((l) => l.id));
                const available = levels.filter((l) => !heldIds.has(l.id));
                return (
                  <tr key={m.id}>
                    <td>{m.username}</td>
                    <td>{m.email}</td>
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
                            <span key={l.id} className="chip">
                              {l.name}
                              <span className="muted" style={{ fontSize: 11 }}>
                                {l.status}
                              </span>
                              <button
                                className="chip-x"
                                title="Remove level"
                                disabled={busy === m.id}
                                onClick={() => removeLevel(m.id, l.id)}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
