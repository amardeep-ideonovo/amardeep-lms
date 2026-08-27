"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { HelpdeskStatus } from "@lms/types";
import { STR } from "@lms/types";
import { Button, buttonClass } from "@lms/ui";
import { ApiError, api } from "@/lib/api";
import { qk } from "@/lib/queries";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import {
  CATEGORY_LABEL,
  STATUS_BADGE,
  STATUS_LABEL,
  STATUS_TABS,
  fmtHelpdeskDateTime,
} from "./labels";

export default function HelpdeskPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const queryClient = useQueryClient();
  const canRead = !authLoading && can("helpdesk", "read");

  const [tab, setTab] = useState<HelpdeskStatus | "ALL">("ALL");
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Reads live in the query cache (docs/coding-standards.md D4). The key
  // carries the filters, so changing a tab / the unread toggle refetches.
  const listQuery = useQuery({
    queryKey: qk.helpdeskConversations(tab, unreadOnly),
    queryFn: () =>
      api.listHelpdeskConversations({
        status: tab === "ALL" ? undefined : tab,
        unreadOnly: unreadOnly || undefined,
        pageSize: 50,
      }),
    enabled: canRead,
  });
  const statsQuery = useQuery({
    queryKey: qk.helpdeskStats,
    queryFn: () => api.helpdeskStats(30),
    enabled: canRead,
  });

  const items = listQuery.data?.items ?? [];
  const stats = statsQuery.data ?? null;
  const loading = listQuery.isPending;
  const error =
    listQuery.error instanceof ApiError
      ? listQuery.error.message
      : listQuery.error
        ? "Failed to load conversations"
        : null;

  if (authLoading) return <p className="muted">{STR.common.loading}</p>;
  if (!can("helpdesk", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>{STR.helpdesk.adminSectionTitle}</h1>
        </div>
        <p className="muted">{STR.errors.permissionDenied}</p>
      </div>
    );

  // Deflection is measured PASSIVELY: of the answers members opened, how many
  // did NOT end in a ticket. The clients no longer ask "did this help?" after
  // every answer (no mainstream support bot does), so the old
  // resolvedYes/(resolvedYes+escalations) ratio would decay to a confident,
  // false 0% as the 30-day window rolled over. Clamped because a member can
  // escalate from a topic they never opened (e.g. straight from the menu).
  const deflection = (views: number, escalations: number) =>
    views > 0 ? Math.max(0, Math.round((1 - escalations / views) * 100)) : null;

  const deflectionRate = stats
    ? deflection(stats.cardViews, stats.escalations)
    : null;

  // Per-topic breakdown, busiest escalations first — the "which topic keeps
  // sending people to a human" signal. Hide topics with no activity in-window.
  const byCategory = (stats?.byCategory ?? [])
    .filter((c) => c.cardViews + c.escalations > 0)
    .sort((a, b) => b.escalations - a.escalations || b.cardViews - a.cardViews);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["helpdeskConversations"] });
    void queryClient.invalidateQueries({ queryKey: qk.helpdeskStats });
  };

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>{STR.helpdesk.adminSectionTitle}</h1>
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
          <Button variant="secondary" onClick={refresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {stats && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div
            style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13 }}
          >
            <span>
              <strong>{stats.cardViews}</strong> self-serve views
            </span>
            <span>
              <strong>{stats.escalations}</strong> escalated
            </span>
            <span>
              {deflectionRate === null ? (
                <>no self-serve views yet (last {stats.days} days)</>
              ) : (
                <>
                  <strong>{deflectionRate}%</strong> deflected (last{" "}
                  {stats.days} days)
                </>
              )}
            </span>
          </div>
        </div>
      )}

      {byCategory.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
            By topic — where members self-served vs escalated
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Views</th>
                  <th>Escalated</th>
                  <th>Deflected</th>
                </tr>
              </thead>
              <tbody>
                {byCategory.map((c) => {
                  const rate = deflection(c.cardViews, c.escalations);
                  return (
                    <tr key={c.category}>
                      <td>{CATEGORY_LABEL[c.category]}</td>
                      <td>{c.cardViews}</td>
                      <td>{c.escalations}</td>
                      <td className="muted">
                        {rate === null ? "—" : `${rate}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
                      {CATEGORY_LABEL[t.category]}
                    </td>
                    <td className="muted" style={{ fontSize: 13 }}>
                      {fmtHelpdeskDateTime(t.lastMessageAt)}
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
