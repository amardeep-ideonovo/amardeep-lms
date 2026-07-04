"use client";

import { useCallback, useEffect, useState } from "react";
import type { EmailLogListDTO, EmailSendStatus } from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";

// EmailLog statuses (mirrors the EmailStatus enum) with label + badge maps.
const STATUSES: EmailSendStatus[] = [
  "QUEUED",
  "SENT",
  "FAILED",
  "BOUNCED",
  "COMPLAINED",
];
const STATUS_LABEL: Record<EmailSendStatus, string> = {
  QUEUED: "Queued",
  SENT: "Sent",
  FAILED: "Failed",
  BOUNCED: "Bounced",
  COMPLAINED: "Complained",
};
const STATUS_BADGE: Record<EmailSendStatus, string> = {
  QUEUED: "badge--neutral",
  SENT: "badge--ok",
  FAILED: "badge--danger",
  BOUNCED: "badge--danger",
  COMPLAINED: "badge--warn",
};

const PAGE_SIZE = 50;

export default function EmailLogsPage() {
  const { can, loading: authLoading } = useAdminAuth();

  const [list, setList] = useState<EmailLogListDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // filters
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<EmailSendStatus | "">("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listEmailLogs({
        status: statusFilter || undefined,
        q: debouncedSearch || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setList(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load email logs");
      setList(null);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, debouncedSearch, page]);

  // Initial + filter-driven load (once auth resolves + permission present).
  useEffect(() => {
    if (authLoading || !can("email", "read")) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, statusFilter, debouncedSearch, page]);

  // Debounce the search box (250ms) and reset to page 1 on a new query.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 when the status filter changes.
  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const totalPages = list
    ? Math.max(1, Math.ceil(list.total / list.pageSize))
    : 1;

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("email", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Email logs</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  return (
    <div>
      <div className="page-header">
        <h1>Email logs</h1>
        <p className="subtitle">
          The outbound send ledger — every email the system attempted, with its
          delivery status, the template that produced it, and any provider
          feedback (bounces / complaints).
        </p>
      </div>

      <div className="card" style={{ margin: 0 }}>
        {/* filter toolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 14,
            flexWrap: "wrap",
          }}
        >
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipient or subject…"
            style={{ minWidth: 240 }}
            aria-label="Search email logs"
          />
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as EmailSendStatus | "")
            }
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          {(statusFilter || debouncedSearch) && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setStatusFilter("");
                setSearch("");
              }}
            >
              Clear
            </button>
          )}
          {list && (
            <span className="muted" style={{ fontSize: 13 }}>
              {list.total} message{list.total === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        {loading ? (
          <p className="muted">Loading…</p>
        ) : !list || list.items.length === 0 ? (
          <p className="muted">No emails match.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>To</th>
                    <th>Subject</th>
                    <th>Status</th>
                    <th>Template</th>
                    <th>Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((log) => (
                    <tr key={log.id}>
                      <td>{log.to}</td>
                      <td>
                        {log.subject || <span className="muted">—</span>}
                        {log.error && (
                          <div
                            className="muted"
                            style={{ fontSize: 12, marginTop: 2, color: "var(--danger)" }}
                            title={log.error}
                          >
                            {log.error.length > 80
                              ? `${log.error.slice(0, 80)}…`
                              : log.error}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[log.status]}`}>
                          {STATUS_LABEL[log.status]}
                        </span>
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {log.templateKey ?? (log.campaignId ? "campaign" : "—")}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {new Date(log.sentAt ?? log.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 10,
                  marginTop: 14,
                }}
              >
                <button
                  className="btn btn--ghost btn--sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ← Prev
                </button>
                <span className="muted" style={{ fontSize: 13 }}>
                  Page {page} of {totalPages}
                </span>
                <button
                  className="btn btn--ghost btn--sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
