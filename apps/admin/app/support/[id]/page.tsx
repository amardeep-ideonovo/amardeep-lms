"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type {
  SupportThreadDTO,
  SupportMessageDTO,
  SupportMessageAuthorKind,
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

// Plain-English label for who wrote a message.
const KIND_LABEL: Record<SupportMessageAuthorKind, string> = {
  ADMIN: "You",
  CLIENT: "Account owner",
  OPERATOR: "Support team",
  SYSTEM: "System",
};

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

// Right-aligned bubble for this admin's own messages; left for everyone else.
function MessageBubble({ m }: { m: SupportMessageDTO }) {
  const mine = m.authorKind === "ADMIN";
  const who = m.authorName || m.authorEmail;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: mine ? "flex-end" : "flex-start",
        gap: 4,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--muted)",
          display: "flex",
          gap: 6,
          alignItems: "baseline",
        }}
      >
        <span>{KIND_LABEL[m.authorKind]}</span>
        {!mine && m.authorKind !== "SYSTEM" && who && (
          <span style={{ fontWeight: 400 }}>· {who}</span>
        )}
      </div>
      <div
        style={{
          maxWidth: "78%",
          padding: "9px 13px",
          borderRadius: 14,
          borderTopRightRadius: mine ? 4 : 14,
          borderTopLeftRadius: mine ? 14 : 4,
          background: mine ? "var(--ink-800)" : "var(--surface-2)",
          color: mine ? "#fff" : "var(--ink-800)",
          fontSize: 14,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {m.body}
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>
        {fmtDateTime(m.createdAt)}
      </div>
    </div>
  );
}

// CSAT prompt — 1..5 buttons + optional comment. Shown only when the operator
// resolved the ticket and asked for a rating that hasn't been given yet.
function CsatPrompt({
  onSubmit,
  submitting,
}: {
  onSubmit: (rating: number, comment: string) => void;
  submitting: boolean;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ marginBottom: 4 }}>How did we do?</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Rate the support you got on this ticket (1 = poor, 5 = great).
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            aria-pressed={rating >= n}
            onClick={() => setRating(n)}
            className={rating >= n ? "btn" : "btn btn--ghost"}
            style={{ minWidth: 44, fontSize: 16 }}
          >
            {rating >= n ? "★" : "☆"}
          </button>
        ))}
      </div>
      <div className="field">
        <label>
          Comment <span className="muted">(optional)</span>
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Anything you'd like to add?"
          maxLength={1000}
          style={{ minHeight: 72 }}
        />
      </div>
      <div className="row-actions">
        <button
          className="btn"
          type="button"
          disabled={submitting || rating < 1}
          onClick={() => onSubmit(rating, comment.trim())}
        >
          {submitting ? "Sending…" : "Submit rating"}
        </button>
      </div>
    </div>
  );
}

export default function SupportThreadPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [thread, setThread] = useState<SupportThreadDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [csatSubmitting, setCsatSubmitting] = useState(false);

  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Loading the thread clears the unread badge server-side.
        const t = await api.getSupportThread(id);
        if (active) setThread(t);
      } catch (err) {
        if (active)
          setError(
            err instanceof ApiError ? err.message : "Failed to load ticket",
          );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [thread?.messages.length]);

  async function sendReply(e: FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    setError(null);
    try {
      const t = await api.replySupportTicket(id, reply.trim());
      setThread(t);
      setReply("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  }

  async function submitCsat(rating: number, comment: string) {
    setCsatSubmitting(true);
    setError(null);
    try {
      const t = await api.submitSupportCsat(id, {
        rating,
        comment: comment || undefined,
      });
      setThread(t);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to submit rating");
    } finally {
      setCsatSubmitting(false);
    }
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (error && !thread) {
    return (
      <div>
        <div className="page-header with-action">
          <h1>Support</h1>
          <Link href="/support" className="btn btn--ghost">
            ← Back to support
          </Link>
        </div>
        <p className="error">{error}</p>
      </div>
    );
  }
  if (!thread) return null;

  const st = STATUS_META[thread.status];
  const isClosed = thread.status === "CLOSED";
  const showCsat =
    !!thread.csatPromptedAt &&
    !thread.csatSubmittedAt &&
    thread.status === "RESOLVED";

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1 style={{ marginBottom: 6 }}>{thread.subject}</h1>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span className={`badge ${st.cls}`}>{st.label}</span>
            <span className="muted" style={{ fontSize: 13 }}>
              {PRIORITY_LABEL[thread.priority]} priority ·{" "}
              {CATEGORY_LABEL[thread.category]}
            </span>
          </div>
        </div>
        <Link href="/support" className="btn btn--ghost">
          ← Back to support
        </Link>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {thread.messages.map((m) => (
            <MessageBubble key={m.id} m={m} />
          ))}
          <div ref={endRef} />
        </div>
      </div>

      {showCsat && (
        <CsatPrompt onSubmit={submitCsat} submitting={csatSubmitting} />
      )}

      {thread.csatSubmittedAt && thread.csatRating != null && (
        <p className="muted" style={{ marginTop: 4 }}>
          Thanks — you rated this ticket {thread.csatRating}/5.
        </p>
      )}

      {isClosed ? (
        <p className="muted" style={{ marginTop: 16 }}>
          This ticket is closed. Open a new ticket if you still need help.
        </p>
      ) : (
        <form onSubmit={sendReply} style={{ marginTop: 16 }}>
          <div className="field">
            <label>Reply</label>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Type your reply…"
              maxLength={5000}
              style={{ minHeight: 110 }}
            />
          </div>
          <div className="row-actions">
            <button
              className="btn"
              type="submit"
              disabled={sending || !reply.trim()}
            >
              {sending ? "Sending…" : "Send reply"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
