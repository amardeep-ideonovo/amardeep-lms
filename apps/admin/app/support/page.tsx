"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  SupportTicketListItemDTO,
  SupportTicketStatus,
  SupportTicketPriority,
  SupportTicketCategory,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";

const STATUS_META: Record<
  SupportTicketStatus,
  { label: string; cls: string }
> = {
  OPEN: { label: "Open", cls: "badge--info" },
  PENDING: { label: "Pending", cls: "badge--warn" },
  RESOLVED: { label: "Resolved", cls: "badge--ok" },
  CLOSED: { label: "Closed", cls: "badge--neutral" },
};

const PRIORITY_LABEL: Record<SupportTicketPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

const CATEGORY_LABEL: Record<SupportTicketCategory, string> = {
  BILLING: "Billing",
  TECHNICAL: "Technical",
  BUG: "Bug",
  HOWTO: "How-to",
  FEATURE_REQUEST: "Feature request",
  ACCOUNT: "Account",
  OTHER: "Other",
};

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function SupportPage() {
  const [items, setItems] = useState<SupportTicketListItemDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listSupportTickets();
      setItems(res.items);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load support tickets",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>Support</h1>
          <p className="subtitle">
            Get help from the team behind your site. Tickets are shared across
            all admins on this account.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn--ghost"
            onClick={load}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <Link href="/support/new" className="btn">
            + New ticket
          </Link>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="muted">
            No support tickets yet — open one if you need help.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Category</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => {
                  const st = STATUS_META[t.status];
                  return (
                    <tr
                      key={t.id}
                      style={
                        t.unread ? { background: "var(--surface-2)" } : undefined
                      }
                    >
                      <td>
                        <Link href={`/support/${t.id}`} className="linklike">
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 8,
                              fontWeight: 600,
                            }}
                          >
                            {t.unread && (
                              <span
                                aria-label="Unread"
                                title="Unread reply"
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: 999,
                                  background: "var(--teal)",
                                  flex: "0 0 auto",
                                }}
                              />
                            )}
                            {t.subject}
                          </span>
                        </Link>
                      </td>
                      <td>
                        <span className={`badge ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="muted" style={{ fontSize: 13 }}>
                        {PRIORITY_LABEL[t.priority]}
                      </td>
                      <td className="muted" style={{ fontSize: 13 }}>
                        {CATEGORY_LABEL[t.category]}
                      </td>
                      <td className="muted" style={{ fontSize: 13 }}>
                        {fmtDateTime(t.lastMessageAt)}
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
