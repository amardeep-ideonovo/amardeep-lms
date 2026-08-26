"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type {
  HelpdeskAdminThreadDTO,
  HelpdeskCategory,
  HelpdeskPriority,
} from "@lms/types";
import { HELPDESK_CATEGORIES, HELPDESK_PRIORITIES, STR } from "@lms/types";
import { Button, buttonClass } from "@lms/ui";
import {
  STATUS_BADGE,
  STATUS_LABEL,
  fmtHelpdeskDateTime as fmtDateTime,
} from "../labels";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";

// A member screenshot: fetch a short-lived scoped token, then render via
// ?token= (an <img> can't send an Authorization header).
function AttachmentThumb({
  attachmentId,
  name,
}: {
  attachmentId: string;
  name: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void api
      .helpdeskAttachmentToken(attachmentId)
      .then((r) => {
        if (active) setUrl(api.helpdeskAttachmentUrl(attachmentId, r.token));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [attachmentId]);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={name}
      style={{
        display: "inline-block",
        lineHeight: 0,
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <img
        src={url}
        alt={name}
        style={{
          width: 110,
          height: 110,
          objectFit: "cover",
          display: "block",
        }}
      />
    </a>
  );
}

export default function HelpdeskThreadPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { can } = useAdminAuth();
  const canEdit = can("helpdesk", "edit");

  const [thread, setThread] = useState<HelpdeskAdminThreadDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);

  const endRef = useRef<HTMLDivElement | null>(null);
  const sendingRef = useRef(false);

  // Initial load + mark read (explicit POST, not a GET side effect).
  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const t = await api.getHelpdeskConversation(id);
        if (active) setThread(t);
        void api.markHelpdeskRead(id).catch(() => undefined);
      } catch (err) {
        if (active)
          setError(err instanceof ApiError ? err.message : "Failed to load");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  // Silent 6s poll: paused on hidden tab / in-flight send; instant on focus.
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (document.hidden || sendingRef.current) return;
      try {
        const t = await api.getHelpdeskConversation(id);
        if (active && !sendingRef.current) setThread(t);
      } catch {
        /* transient poll failure — keep last good thread */
      }
    };
    const onRefresh = () => void refresh();
    const iv = window.setInterval(onRefresh, 6000);
    window.addEventListener("focus", onRefresh);
    return () => {
      active = false;
      window.clearInterval(iv);
      window.removeEventListener("focus", onRefresh);
    };
  }, [id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [thread?.messages.length]);

  async function sendReply(e: { preventDefault: () => void }, resolve = false) {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    sendingRef.current = true;
    setError(null);
    try {
      const t = await api.replyHelpdeskConversation(id, {
        body: reply.trim(),
        internal,
        resolve,
      });
      setThread(t);
      setReply("");
      setInternal(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send reply");
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }

  async function runAction(fn: () => Promise<HelpdeskAdminThreadDTO>) {
    setBusy(true);
    setError(null);
    try {
      setThread(await fn());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">{STR.common.loading}</p>;
  if (!thread) return <p className="error">{error ?? "Not found"}</p>;

  const closed = thread.status === "CLOSED";

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1 style={{ marginBottom: 6 }}>{thread.subject}</h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className={STATUS_BADGE[thread.status]}>
              {STATUS_LABEL[thread.status]}
            </span>
            <span className="muted" style={{ fontSize: 13 }}>
              {thread.member.name
                ? `${thread.member.name} · ${thread.member.email}`
                : thread.member.email}
            </span>
          </div>
        </div>
        <Link href="/helpdesk" className={buttonClass({ variant: "ghost" })}>
          ← Back
        </Link>
      </div>

      {error && <p className="error">{error}</p>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 240px",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* Thread */}
        <div className="card">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {thread.messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf:
                    m.authorKind === "MEMBER" ? "flex-start" : "flex-end",
                  maxWidth: "88%",
                  padding: "9px 12px",
                  borderRadius: 10,
                  whiteSpace: "pre-wrap",
                  fontSize: 14,
                  lineHeight: 1.5,
                  background: m.internal
                    ? "var(--warn-surface, var(--surface-2))"
                    : m.authorKind === "MEMBER"
                      ? "var(--surface-2)"
                      : m.authorKind === "SYSTEM"
                        ? "transparent"
                        : "var(--teal-surface, var(--surface-2))",
                  border: m.internal ? "1px dashed var(--border)" : "none",
                  color:
                    m.authorKind === "SYSTEM" ? "var(--muted)" : "var(--text)",
                  fontStyle: m.authorKind === "SYSTEM" ? "italic" : "normal",
                }}
              >
                <div
                  className="muted"
                  style={{ fontSize: 11, fontWeight: 700, marginBottom: 2 }}
                >
                  {m.authorKind === "MEMBER"
                    ? (m.authorName ?? "Member")
                    : m.authorKind === "SYSTEM"
                      ? "Context"
                      : `${m.authorName ?? "You"}${m.internal ? " · internal note" : ""}`}{" "}
                  · {fmtDateTime(m.createdAt)}
                </div>
                {m.body}
                {m.attachments.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      marginTop: 6,
                    }}
                  >
                    {m.attachments.map((a) => (
                      <AttachmentThumb
                        key={a.id}
                        attachmentId={a.id}
                        name={a.originalName}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </div>

        {/* Context + actions rail */}
        <div className="card">
          <div className="field">
            <label>Category</label>
            <select
              value={thread.category}
              disabled={!canEdit || busy}
              onChange={(e) =>
                void runAction(() =>
                  api.updateHelpdeskTicket(id, {
                    category: e.target.value as HelpdeskCategory,
                  }),
                )
              }
            >
              {HELPDESK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Priority</label>
            <select
              value={thread.priority}
              disabled={!canEdit || busy}
              onChange={(e) =>
                void runAction(() =>
                  api.updateHelpdeskTicket(id, {
                    priority: e.target.value as HelpdeskPriority,
                  }),
                )
              }
            >
              {HELPDESK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            {thread.assigneeAdminId ? "Assigned" : "Unassigned"}
            {thread.reopenCount > 0 ? ` · reopened ×${thread.reopenCount}` : ""}
          </p>
          {canEdit && !closed && (
            <div className="row-actions" style={{ flexDirection: "column" }}>
              <Button
                variant="secondary"
                block
                disabled={busy}
                onClick={() =>
                  void runAction(() => api.resolveHelpdeskConversation(id))
                }
              >
                Mark resolved
              </Button>
              <Button
                variant="danger"
                block
                disabled={busy}
                onClick={() =>
                  void runAction(() => api.closeHelpdeskConversation(id))
                }
              >
                Close
              </Button>
            </div>
          )}
        </div>
      </div>

      {canEdit && !closed && (
        <form onSubmit={(e) => void sendReply(e)} style={{ marginTop: 16 }}>
          <div className="field">
            <label>
              {internal ? "Internal note (members can’t see this)" : "Reply"}
            </label>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={
                internal ? "Add a private note…" : "Type your reply…"
              }
              maxLength={4000}
              style={{ minHeight: 110 }}
            />
          </div>
          <div
            className="row-actions"
            style={{ alignItems: "center", gap: 12 }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={internal}
                onChange={(e) => setInternal(e.target.checked)}
              />
              Internal note
            </label>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              {!internal && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={sending || !reply.trim()}
                  onClick={(e) => void sendReply(e, true)}
                >
                  Reply &amp; resolve
                </Button>
              )}
              <Button type="submit" disabled={sending || !reply.trim()}>
                {sending ? "Sending…" : internal ? "Add note" : "Send reply"}
              </Button>
            </div>
          </div>
        </form>
      )}
      {closed && (
        <p className="muted" style={{ marginTop: 16 }}>
          This conversation is closed. A member message starts a new one.
        </p>
      )}
    </div>
  );
}
