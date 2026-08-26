"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { api, getToken } from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import {
  OPTIMISTIC_NETWORK_MODE,
  mutationErrorMessage,
  useMountedRef,
} from "@/lib/mutations";
import type { AdminNotificationDTO } from "@lms/types";
import { STR } from "@lms/types";
import { Button } from "@lms/ui";

// Low-urgency feed → poll the unread badge every 30s (the app's only poll).
const POLL_MS = 30_000;

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diffMs / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AdminNotificationDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const mounted = useMountedRef();
  // Mirrors of the two pieces an optimistic mark touches, so a revert restores
  // what was on screen when the write started.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const unreadRef = useRef(unread);
  unreadRef.current = unread;

  const fetchUnread = useCallback(async () => {
    if (!getToken()) return;
    try {
      const { count } = await api.notificationsUnreadCount();
      setUnread(count);
    } catch {
      // transient — the next poll retries
    }
  }, []);

  const loadList = useCallback(async () => {
    if (!getToken()) return;
    setLoading(true);
    try {
      const res = await api.listNotifications({ pageSize: 10 });
      setItems(res.items);
      setUnread(res.unreadCount);
    } catch {
      // leave the list as-is; the badge poll keeps the count fresh
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling, paused while the tab is hidden so many open admin
  // tabs don't hammer the API; refetch immediately on becoming visible again.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer == null) timer = setInterval(() => void fetchUnread(), POLL_MS);
    };
    const stop = () => {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void fetchUnread();
        start();
      }
    };
    void fetchUnread();
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchUnread]);

  // Close the panel on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void loadList();
  };

  // The touched slice for both marks is the same pair: which rows show as read,
  // and the badge count. Snapshots read it through the refs so they capture
  // the state at run time, not at render time.
  const snapshotRead = () => ({
    items: itemsRef.current,
    unread: unreadRef.current,
  });
  const restoreRead = (snap: {
    items: AdminNotificationDTO[];
    unread: number;
  }) => {
    setItems(snap.items);
    setUnread(snap.unread);
  };

  // Both marks below follow docs/coding-standards.md D4: useMutation with an
  // onMutate snapshot and a verbatim onError rollback is the optimistic
  // engine. The failed-write heal (fetchUnread) keeps the badge honest.
  //
  // Mark-all keeps its old queue key (`notifications:mark-all`) as a v5
  // mutation scope. Overlap can't actually occur — the button disables at
  // unread 0, which the optimistic paint sets — so the scope is belt and
  // braces.
  const markAllMutation = useMutation({
    scope: { id: "notifications:mark-all" },
    networkMode: OPTIMISTIC_NETWORK_MODE,
    mutationFn: () => api.markAllNotificationsRead(),
    onMutate: () => {
      const snapshot = snapshotRead();
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnread(0);
      return snapshot;
    },
    onError: (error, _vars, snapshot) => {
      if (!mounted.current || !snapshot) return;
      restoreRead(snapshot);
      void fetchUnread();
      toast(
        mutationErrorMessage(error, "Couldn’t mark your notifications read."),
        {
          action: {
            label: "Retry",
            onAction: () => markAllMutation.mutate(),
          },
        },
      );
    },
  });

  // Per-notification: marking one read never races another row, so different
  // rows stay free to overlap. No `scope`: the old per-row queue key
  // (`notification:<id>`) has no v5 equivalent on a single hook instance
  // (scope ids are fixed per hook, and one scope would serialize DIFFERENT
  // rows). Re-marking the SAME row can't happen — the optimistic paint sets
  // `read`, and onItem only mutates unread rows.
  const markReadMutation = useMutation({
    networkMode: OPTIMISTIC_NETWORK_MODE,
    mutationFn: (n: AdminNotificationDTO) => api.markNotificationRead(n.id),
    onMutate: (n) => {
      const snapshot = snapshotRead();
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)),
      );
      setUnread((u) => Math.max(0, u - 1));
      return snapshot;
    },
    onError: (error, n, snapshot) => {
      if (!mounted.current || !snapshot) return;
      restoreRead(snapshot);
      void fetchUnread();
      toast(
        mutationErrorMessage(error, "Couldn’t mark that notification read."),
        {
          action: {
            label: "Retry",
            onAction: () => markReadMutation.mutate(n),
          },
        },
      );
    },
  });

  const markAll = () => {
    markAllMutation.mutate();
  };

  const onItem = (n: AdminNotificationDTO) => {
    if (!n.read) {
      markReadMutation.mutate(n);
    }
    // The navigation below is deliberately NOT part of the optimistic write:
    // the bell lives in the persistent shell, so it stays mounted across the
    // route change and can still revert its own badge if the mark fails.
    setOpen(false);
    // Explicit deep-link target wins; fall back to the member link. Without
    // this, support and helpdesk notifications navigate nowhere.
    if (n.entityType === "helpdesk" && n.entityId) {
      router.push(`/helpdesk/${n.entityId}`);
    } else if (n.entityType === "support" && n.entityId) {
      router.push(`/support/${n.entityId}`);
    } else if (n.userId) {
      router.push(`/members/${n.userId}`);
    }
  };

  return (
    <div className="notif" ref={rootRef}>
      <button
        type="button"
        className="notif-btn"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        onClick={toggle}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="notif-badge">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-panel__head">
            <span>Notifications</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={markAll}
              disabled={unread === 0}
            >
              Mark all read
            </Button>
          </div>
          <div className="notif-list">
            {loading ? (
              <p className="notif-empty">{STR.common.loading}</p>
            ) : items.length === 0 ? (
              <p className="notif-empty">No notifications yet.</p>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={
                    n.read ? "notif-item" : "notif-item notif-item--unread"
                  }
                  role="button"
                  tabIndex={0}
                  onClick={() => onItem(n)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onItem(n);
                    }
                  }}
                >
                  {!n.read && (
                    <span className="notif-item__dot" aria-hidden="true" />
                  )}
                  <div className="notif-item__main">
                    <div className="notif-item__title">{n.title}</div>
                    <div className="notif-item__body">{n.body}</div>
                    <div className="notif-item__time">
                      {timeAgo(n.createdAt)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          <Link
            className="notif-panel__foot"
            href="/notifications"
            onClick={() => setOpen(false)}
          >
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
