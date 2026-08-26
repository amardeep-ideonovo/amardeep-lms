"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type {
  HelpdeskAdminListItemDTO,
  HelpdeskStatsDTO,
  HelpdeskStatus,
} from "@lms/types";
import { STR } from "@lms/types";
import { Button, buttonClass } from "@lms/ui";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";

const STATUS_TABS: { key: HelpdeskStatus | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "ESCALATED", label: "Open" },
  { key: "WAITING_ON_MEMBER", label: "Waiting on member" },
  { key: "RESOLVED", label: "Resolved" },
  { key: "CLOSED", label: "Closed" },
];

const STATUS_BADGE: Record<HelpdeskStatus, string> = {
  ESCALATED: "badge badge--warn",
  WAITING_ON_MEMBER: "badge badge--info",
  RESOLVED: "badge badge--ok",
  CLOSED: "badge badge--neutral",
};

const STATUS_LABEL: Record<HelpdeskStatus, string> = {
  ESCALATED: "Open",
  WAITING_ON_MEMBER: "Waiting on member",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function HelpdeskPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const [items, setItems] = useState<HelpdeskAdminListItemDTO[]>([]);
  const [stats, setStats] = useState<HelpdeskStatsDTO | null>(null);
  const [tab, setTab] = useState<HelpdeskStatus | "ALL">("ALL");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listHelpdeskConversations({
        status: tab === "ALL" ? undefined : tab,
        unreadOnly: unreadOnly || undefined,
        pageSize: 50,
      });
      setItems(res.items);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load conversations",
      );
    } finally {
      setLoading(false);
    }
  }, [tab, unreadOnly]);

  useEffect(() => {
    if (authLoading || !can("helpdesk", "read")) return;
    void load();
    void api
      .helpdeskStats(30)
      .then(setStats)
      .catch(() => undefined);
  }, [authLoading, can, load]);

  if (authLoading) return <p className="muted">{STR.common.loading}</p>;
  if (!can("helpdesk", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Member support</h1>
        </div>
        <p className="muted">{STR.errors.permissionDenied}</p>
      </div>
    );

  const deflectionRate =
    stats && stats.resolvedYes + stats.escalations > 0
      ? Math.round(
          (stats.resolvedYes / (stats.resolvedYes + stats.escalations)) * 100,
        )
      : null;

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>Member support</h1>
          <p className="subtitle">
            Conversations your members escalated from the help widget.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link
            href="/helpdesk/articles"
            className={buttonClass({ variant: "secondary" })}
          >
            FAQ articles
          </Link>
          <Button
            variant="secondary"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {stats && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              gap: 24,
              flexWrap: "wrap",
              fontSize: 13,
            }}
          >
            <span>
              <strong>{stats.cardViews}</strong> self-serve views
            </span>
            <span>
              <strong>{stats.resolvedYes}</strong> resolved without a human
            </span>
            <span>
              <strong>{stats.escalations}</strong> escalated
            </span>
            {deflectionRate !== null && (
              <span>
                <strong>{deflectionRate}%</strong> deflected (last {stats.days}{" "}
                days)
              </span>
            )}
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={
              tab === t.key ? "badge badge--info" : "badge badge--neutral"
            }
            style={{ cursor: "pointer", border: "none" }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
        <label
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
          }}
        >
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />
          Unread only
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        {loading ? (
          <p className="muted">{STR.common.loading}</p>
        ) : items.length === 0 ? (
          <p className="muted">No conversations here.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Category</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr
                    key={t.id}
                    style={
                      t.unreadForAdmins
                        ? { background: "var(--surface-2)" }
                        : undefined
                    }
                  >
                    <td>
                      <div style={{ fontWeight: 600 }}>
                        {t.memberName ?? t.memberEmail}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {t.memberEmail}
                      </div>
                    </td>
                    <td>
                      <Link href={`/helpdesk/${t.id}`} className="linklike">
                        {t.subject}
                      </Link>
                      {t.reopenCount > 0 && (
                        <span
                          className="badge badge--neutral"
                          style={{ marginLeft: 8 }}
                        >
                          reopened ×{t.reopenCount}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={STATUS_BADGE[t.status]}>
                        {STATUS_LABEL[t.status]}
                      </span>
                    </td>
                    <td className="muted" style={{ fontSize: 13 }}>
                      {t.category}
                    </td>
                    <td className="muted" style={{ fontSize: 13 }}>
                      {fmtDateTime(t.lastMessageAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
