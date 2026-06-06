"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type {
  AdminNotificationDTO,
  AdminNotificationListDTO,
  AdminNotificationSeverity,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";

const PAGE_SIZE = 20;

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const SEVERITY_META: Record<
  AdminNotificationSeverity,
  { label: string; bg: string; fg: string }
> = {
  INFO: { label: "Info", bg: "#e0f2fe", fg: "#075985" },
  WARNING: { label: "Warning", bg: "#fef9c3", fg: "#854d0e" },
  CRITICAL: { label: "Critical", bg: "#fee2e2", fg: "#991b1b" },
};

export default function NotificationsPage() {
  const [data, setData] = useState<AdminNotificationListDTO | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.listNotifications({ page: p, pageSize: PAGE_SIZE }));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load notifications",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page);
  }, [page, load]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const unread = data?.unreadCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const markRead = async (n: AdminNotificationDTO) => {
    if (n.read) return;
    setData((d) =>
      d
        ? {
            ...d,
            items: d.items.map((x) =>
              x.id === n.id ? { ...x, read: true } : x,
            ),
            unreadCount: Math.max(0, d.unreadCount - 1),
          }
        : d,
    );
    try {
      await api.markNotificationRead(n.id);
    } catch {
      load(page);
    }
  };

  const markAll = async () => {
    setData((d) =>
      d
        ? {
            ...d,
            items: d.items.map((x) => ({ ...x, read: true })),
            unreadCount: 0,
          }
        : d,
    );
    try {
      await api.markAllNotificationsRead();
    } catch {
      load(page);
    }
  };

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>Notifications</h1>
          <p className="subtitle">
            Subscription, payment and cancellation events. Read state is
            per-admin.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn--ghost"
            onClick={markAll}
            disabled={loading || unread === 0}
          >
            Mark all read
          </button>
          <button
            className="btn btn--ghost"
            onClick={() => load(page)}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="muted">No notifications yet.</p>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Event</th>
                  <th>Member</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((n) => {
                  const sev = SEVERITY_META[n.severity];
                  return (
                    <tr
                      key={n.id}
                      style={n.read ? undefined : { background: "#eff6ff" }}
                    >
                      <td>
                        <span
                          className="badge"
                          style={{ background: sev.bg, color: sev.fg }}
                        >
                          {sev.label}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{n.title}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {n.body}
                        </div>
                      </td>
                      <td>
                        {n.userId ? (
                          <Link
                            href={`/members/${n.userId}`}
                            className="linklike"
                          >
                            View member
                          </Link>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: 13 }}>
                        {fmtDateTime(n.createdAt)}
                      </td>
                      <td>
                        {n.read ? (
                          <span className="muted" style={{ fontSize: 12 }}>
                            Read
                          </span>
                        ) : (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={() => markRead(n)}
                          >
                            Mark read
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 14,
              }}
            >
              <span className="muted" style={{ fontSize: 13 }}>
                Page {page} of {totalPages} · {total} total · {unread} unread
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                >
                  Prev
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
