"use client";

import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ChatCanvasDTO,
  ChatChannelDTO,
  ChatChannelDetailDTO,
  ChatDmDTO,
  ChatListDTO,
  ChatMessageDTO,
  UnreadSummaryDTO,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";
import QueueTable from "@/components/QueueTable";
import RichTextEditor from "@/components/RichTextEditor";
import {
  AdminLite,
  NameResolver,
  formatTime,
  initials,
  loadAdminRoster,
  makeNameResolver,
  resolveMentions,
} from "@/lib/projects";
import {
  getProjectsSocket,
  joinChannel,
  leaveChannel as socketLeaveChannel,
  sendTyping,
  onChatMessage,
  onChatMessageUpdate,
  onChatReaction,
  onChatTyping,
  onChatPresence,
  onConnect,
} from "@/lib/projectsSocket";

// Phase 3: realtime over a Socket.IO gateway delivers other admins' messages,
// edits and reactions live. We keep two safety polls behind it:
//  - UNREAD_POLL_MS: left-rail badge digest (cheap, cross-channel).
//  - MESSAGE_FALLBACK_POLL_MS: a SLOW catch-up for the open channel in case the
//    socket is down (the fast 4s append-poll is gone — the socket replaces it).
// The thread panel still polls at THREAD_POLL_MS (replies aren't on the socket).
const MESSAGE_FALLBACK_POLL_MS = 25000;
const THREAD_POLL_MS = 4000;
const UNREAD_POLL_MS = 10000;
// How long a teammate's "…typing" line lingers after their last keystroke.
const TYPING_TTL_MS = 4000;

// A small, fixed reaction palette for the quick-add picker.
const EMOJI_PALETTE = ["👍", "🎉", "❤️", "👀", "✅", "🙏", "🔥", "😄"];

export default function ProjectsPage() {
  const { can, loading: authLoading, me } = useAdminAuth();
  const myId = me?.id ?? "";

  // ----- roster (name resolution + mention autocomplete) -----
  const [roster, setRoster] = useState<AdminLite[]>([]);
  const resolveName: NameResolver = useMemo(
    () => makeNameResolver(roster),
    [roster],
  );

  // ----- channels (left rail) -----
  const [channels, setChannels] = useState<ChatChannelDTO[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unread, setUnread] = useState<UnreadSummaryDTO | null>(null);

  // ----- direct messages (left rail, below channels) -----
  // The DM rows (with their own unread/mention counts + last-activity sort), and
  // a lookup of any opened DM's ChatChannelDTO so the pane can render it (a DM
  // selected from the rail may not be in `channels`, which is CHANNEL-only).
  const [dms, setDms] = useState<ChatDmDTO[]>([]);
  const [dmChannels, setDmChannels] = useState<Map<string, ChatChannelDTO>>(
    new Map(),
  );
  const [dmPickerOpen, setDmPickerOpen] = useState(false);

  // ----- selected channel detail + messages (right pane) -----
  const [detail, setDetail] = useState<ChatChannelDetailDTO | null>(null);
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [paneError, setPaneError] = useState<string | null>(null);

  // ----- thread panel -----
  const [threadParent, setThreadParent] = useState<ChatMessageDTO | null>(null);

  // ----- channel header tab (Messages · each List · each Canvas) -----
  // The active tab is encoded as "messages" | `list:<id>` | `canvas:<id>`. DMs
  // have no tabs (the pane is always Messages). Resets to Messages on switch.
  const [activeTab, setActiveTab] = useState<string>("messages");

  // ----- realtime niceties -----
  // Admin ids currently "…typing" in the open channel, each with an expiry.
  const [typingIds, setTypingIds] = useState<string[]>([]);
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  // Admin ids with a live socket somewhere (presence dots).
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  // The highest seq we've rendered; drives the catch-up cursor (poll + socket
  // reconnect). The open channel id is mirrored into a ref so the long-lived
  // socket handlers always read the current selection without re-subscribing.
  const lastSeqRef = useRef(0);
  const selectedIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const canCreate = can("projects", "create");
  const canEdit = can("projects", "edit");
  const canDelete = can("projects", "delete");

  const selected = useMemo<ChatChannelDTO | null>(() => {
    if (!selectedId) return null;
    const ch = channels.find((c) => c.id === selectedId);
    if (ch) return ch;
    const dmCh = dmChannels.get(selectedId);
    if (dmCh) return dmCh;
    // A DM picked from the rail before its channel DTO is cached: synthesize a
    // minimal one from the DM row so the pane renders immediately.
    const dm = dms.find((d) => d.id === selectedId);
    if (dm) {
      return {
        id: dm.id,
        name: "",
        slug: null,
        topic: null,
        isPrivate: true,
        kind: dm.kind,
        memberAdminIds: [myId, ...dm.otherAdminIds],
        archivedAt: null,
        unreadCount: dm.unreadCount,
        mentionCount: dm.mentionCount,
        memberCount: dm.otherAdminIds.length + 1,
      };
    }
    return null;
  }, [channels, dmChannels, dms, selectedId, myId]);

  // Whether the open pane is a DM, and the title to show for it (the OTHER
  // member's name, or a comma list for a group DM). Falls back to detail.members
  // once loaded (covers a DM opened before its row lands in `dms`).
  const selectedIsDm = !!selected && selected.kind !== "CHANNEL";
  const dmTitle = useCallback(
    (memberAdminIds: string[]): string => {
      const others = memberAdminIds.filter((id) => id !== myId);
      if (others.length === 0) return "Just you";
      return others.map(resolveName).join(", ");
    },
    [myId, resolveName],
  );

  // Merge a freshly-fetched message into local state (replace by id, else append),
  // keeping the list ordered by seq and tracking the high-water mark.
  const upsertMessages = useCallback((incoming: ChatMessageDTO[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      const next = Array.from(byId.values()).sort((a, b) => a.seq - b.seq);
      const max = next.reduce((acc, m) => Math.max(acc, m.seq), 0);
      if (max > lastSeqRef.current) lastSeqRef.current = max;
      return next;
    });
  }, []);

  // ---- loaders ----
  const loadChannels = useCallback(async () => {
    setLoadingChannels(true);
    setError(null);
    try {
      const rows = await api.listChannels();
      setChannels(rows);
      setSelectedId((prev) => {
        if (prev && rows.some((r) => r.id === prev)) return prev;
        return rows[0]?.id ?? null;
      });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load channels",
      );
    } finally {
      setLoadingChannels(false);
    }
  }, []);

  const refreshUnread = useCallback(async () => {
    try {
      setUnread(await api.getUnread());
    } catch {
      /* badge refresh is best-effort */
    }
  }, []);

  // Load (or refresh) the DM rail. Best-effort — a failure leaves the existing
  // list in place (the channels still work).
  const loadDms = useCallback(async () => {
    try {
      setDms(await api.listDms());
    } catch {
      /* DM rail refresh is best-effort */
    }
  }, []);

  // Initial load (once auth resolves + permission present).
  useEffect(() => {
    if (authLoading || !can("projects", "read")) return;
    loadChannels();
    refreshUnread();
    loadDms();
    loadAdminRoster().then(setRoster);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  // On channel open: reset cursor, load detail + first page of messages, mark read.
  useEffect(() => {
    selectedIdRef.current = selectedId;
    // Switching channels always lands on the Messages tab.
    setActiveTab("messages");
    // Clear any stale typing indicators when switching channels.
    setTypingIds([]);
    typingTimers.current.forEach((t) => clearTimeout(t));
    typingTimers.current.clear();
    if (!selectedId) {
      setDetail(null);
      setMessages([]);
      setThreadParent(null);
      lastSeqRef.current = 0;
      return;
    }
    let cancelled = false;
    lastSeqRef.current = 0;
    setMessages([]);
    setThreadParent(null);
    setLoadingMessages(true);
    setPaneError(null);
    (async () => {
      try {
        const [d, msgs] = await Promise.all([
          api.getChannel(selectedId),
          api.listMessages(selectedId),
        ]);
        if (cancelled) return;
        setDetail(d);
        const ordered = [...msgs].sort((a, b) => a.seq - b.seq);
        lastSeqRef.current = ordered.reduce(
          (acc, m) => Math.max(acc, m.seq),
          0,
        );
        setMessages(ordered);
        // Mark read up to what we just loaded, then refresh the left-rail badges.
        await api.markRead(selectedId, lastSeqRef.current || undefined);
        refreshUnread();
        loadDms();
      } catch (err) {
        if (!cancelled)
          setPaneError(
            err instanceof ApiError ? err.message : "Failed to load messages",
          );
      } finally {
        if (!cancelled) setLoadingMessages(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, refreshUnread, loadDms]);

  // Reusable catch-up: pull anything newer than our high-water seq for the open
  // channel, merge it, and advance the read marker. Used by the SLOW safety poll
  // AND by the socket (re)connect handler to fill any gap the socket missed.
  const catchUpMessages = useCallback(async () => {
    const ch = selectedIdRef.current;
    if (!ch) return;
    try {
      const fresh = await api.listMessages(ch, lastSeqRef.current);
      if (fresh.length > 0) {
        upsertMessages(fresh);
        await api.markRead(ch, lastSeqRef.current || undefined);
        refreshUnread();
      }
    } catch {
      /* transient failure — next tick / next reconnect will retry */
    }
  }, [upsertMessages, refreshUnread]);

  // SLOW safety fallback poll (~25s). The socket is the primary transport now;
  // this only matters when the socket is down (server restart, network blip).
  useEffect(() => {
    if (!selectedId) return;
    const t = setInterval(catchUpMessages, MESSAGE_FALLBACK_POLL_MS);
    return () => clearInterval(t);
  }, [selectedId, catchUpMessages]);

  // Unread-poll every ~10s to keep the left-rail badges fresh across channels +
  // DMs (DMs aren't in the unread digest, so we re-pull listDms on the same tick).
  useEffect(() => {
    if (authLoading || !can("projects", "read")) return;
    const t = setInterval(() => {
      refreshUnread();
      loadDms();
    }, UNREAD_POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, refreshUnread, loadDms]);

  // Merge a socket reaction event into local state (open pane + thread parent),
  // replacing just the message's reaction chips.
  const mergeReaction = useCallback(
    (messageId: string, reactions: ChatMessageDTO["reactions"]) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, reactions } : m)),
      );
      setThreadParent((p) =>
        p && p.id === messageId ? { ...p, reactions } : p,
      );
    },
    [],
  );

  // Record a teammate as "…typing" with a short auto-expiry.
  const noteTyping = useCallback((adminId: string) => {
    if (adminId === myId) return; // ignore our own (server already excludes it)
    setTypingIds((prev) => (prev.includes(adminId) ? prev : [...prev, adminId]));
    const timers = typingTimers.current;
    const existing = timers.get(adminId);
    if (existing) clearTimeout(existing);
    timers.set(
      adminId,
      setTimeout(() => {
        timers.delete(adminId);
        setTypingIds((prev) => prev.filter((id) => id !== adminId));
      }, TYPING_TTL_MS),
    );
  }, [myId]);

  // ---- Socket lifecycle: subscribe ONCE while permitted; handlers read the
  // open channel via selectedIdRef so they never need to re-subscribe. On
  // (re)connect, run a single catch-up to fill any gap, then rely on the socket.
  useEffect(() => {
    if (authLoading || !can("projects", "read")) return;
    // Touch the singleton so it connects.
    getProjectsSocket();

    const offs = [
      onChatMessage((dto) => {
        if (dto.channelId !== selectedIdRef.current) return;
        upsertMessages([dto]);
        // New activity in the channel we're looking at — keep it marked read.
        if (dto.authorAdminId !== myId) {
          api
            .markRead(dto.channelId, lastSeqRef.current || undefined)
            .then(refreshUnread)
            .catch(() => {});
        }
      }),
      onChatMessageUpdate((dto) => {
        if (dto.channelId !== selectedIdRef.current) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === dto.id ? dto : m)),
        );
        setThreadParent((p) => (p && p.id === dto.id ? dto : p));
      }),
      onChatReaction((evt) => mergeReaction(evt.messageId, evt.reactions)),
      onChatTyping((evt) => {
        if (evt.channelId === selectedIdRef.current) noteTyping(evt.adminId);
      }),
      onChatPresence((evt) => setOnlineIds(new Set(evt.online))),
      // Fires on first connect AND every reconnect: (re)join the open room and
      // catch up on anything missed while the socket was down.
      onConnect(() => {
        const ch = selectedIdRef.current;
        if (ch) joinChannel(ch);
        catchUpMessages();
      }),
    ];
    return () => {
      offs.forEach((off) => off());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, myId, upsertMessages, mergeReaction, noteTyping, catchUpMessages, refreshUnread]);

  // ---- Join/leave the open channel's room as the selection changes. (The
  // connect handler also (re)joins on reconnect; this covers the in-session
  // channel switch while already connected.)
  useEffect(() => {
    if (authLoading || !can("projects", "read") || !selectedId) return;
    joinChannel(selectedId);
    return () => {
      socketLeaveChannel(selectedId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, selectedId]);

  // Keep the message pane pinned to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, selectedId]);

  // Per-channel unread/mention counts come from the batch unread digest (kept
  // fresher than the channel list itself); fall back to the channel row's own.
  const unreadFor = useCallback(
    (ch: ChatChannelDTO) => {
      const row = unread?.channels.find((c) => c.channelId === ch.id);
      return {
        unreadCount: row?.unreadCount ?? ch.unreadCount,
        mentionCount: row?.mentionCount ?? ch.mentionCount,
      };
    },
    [unread],
  );

  // ---- channel actions ----
  async function createChannel() {
    const name = await dialog.prompt({
      message: "New channel name",
      placeholder: "e.g. ops, launch-q3",
      confirmLabel: "Create",
    });
    if (!name || !name.trim()) return;
    try {
      const created = await api.createChannel({ name: name.trim() });
      await loadChannels();
      setSelectedId(created.id);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create channel",
      );
    }
  }

  // Open-or-get a DM with the chosen admins, stash its channel DTO so the pane
  // can render it, refresh the rail, and select it.
  async function openDm(adminIds: string[]) {
    if (adminIds.length === 0) return;
    try {
      const ch = await api.openDm(adminIds);
      setDmChannels((prev) => new Map(prev).set(ch.id, ch));
      setDmPickerOpen(false);
      await loadDms();
      setSelectedId(ch.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to open DM");
    }
  }

  // Re-pull the open channel's detail (members + lists + canvases) so the tab
  // bar reflects an added/removed list or canvas without a full reload.
  const refreshDetail = useCallback(async () => {
    const ch = selectedIdRef.current;
    if (!ch) return;
    try {
      setDetail(await api.getChannel(ch));
    } catch {
      /* best-effort: the next channel open re-fetches detail anyway */
    }
  }, []);

  // ---- tab actions: add a List / Canvas to the open channel ----
  async function addListTab() {
    if (!selectedId) return;
    const name = await dialog.prompt({
      message: "New list name",
      placeholder: "e.g. WEB QUEUE",
      confirmLabel: "Create list",
    });
    if (!name || !name.trim()) return;
    try {
      const created = await api.createList({
        name: name.trim(),
        channelId: selectedId,
      });
      await refreshDetail();
      setActiveTab(`list:${created.id}`);
    } catch (err) {
      setPaneError(
        err instanceof ApiError ? err.message : "Failed to create list",
      );
    }
  }

  async function addCanvasTab() {
    if (!selectedId) return;
    const title = await dialog.prompt({
      message: "New canvas title",
      placeholder: "e.g. Web SOP",
      confirmLabel: "Create canvas",
    });
    if (!title || !title.trim()) return;
    try {
      const created = await api.createCanvas(selectedId, { title: title.trim() });
      await refreshDetail();
      setActiveTab(`canvas:${created.id}`);
    } catch (err) {
      setPaneError(
        err instanceof ApiError ? err.message : "Failed to create canvas",
      );
    }
  }

  // A canvas was deleted from its tab editor: drop back to Messages + refresh.
  async function onCanvasDeleted() {
    setActiveTab("messages");
    await refreshDetail();
  }

  async function leaveChannel(ch: ChatChannelDTO) {
    const ok = await dialog.confirm({
      message: `Leave #${ch.name}? You can re-join from its detail later.`,
      danger: true,
      confirmLabel: "Leave",
    });
    if (!ok) return;
    try {
      await api.leaveChannel(ch.id);
      if (selectedId === ch.id) setSelectedId(null);
      await loadChannels();
      refreshUnread();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to leave");
    }
  }

  // Top-level (non-thread) messages, oldest -> newest.
  const rootMessages = useMemo(
    () => messages.filter((m) => !m.parentMessageId),
    [messages],
  );

  // How many members of the open channel currently have a live socket (presence).
  const onlineHere = useMemo(() => {
    if (!detail) return 0;
    return detail.members.reduce(
      (n, m) => (onlineIds.has(m.adminId) ? n + 1 : n),
      0,
    );
  }, [detail, onlineIds]);

  // ---- message mutations (shared by main pane + thread panel) ----
  const onReactionToggled = useCallback((updated: ChatMessageDTO) => {
    setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    setThreadParent((p) => (p && p.id === updated.id ? updated : p));
  }, []);

  async function toggleReaction(messageId: string, emoji: string) {
    try {
      const updated = await api.toggleReaction(messageId, emoji);
      onReactionToggled(updated);
    } catch (err) {
      setPaneError(
        err instanceof ApiError ? err.message : "Failed to react",
      );
    }
  }

  async function editMessage(m: ChatMessageDTO) {
    const body = await dialog.prompt({
      message: "Edit message",
      defaultValue: m.body,
      confirmLabel: "Save",
    });
    if (body === null || !body.trim() || body.trim() === m.body) return;
    try {
      const updated = await api.editMessage(m.id, body.trim());
      setMessages((prev) =>
        prev.map((x) => (x.id === updated.id ? updated : x)),
      );
      setThreadParent((p) => (p && p.id === updated.id ? updated : p));
    } catch (err) {
      setPaneError(err instanceof ApiError ? err.message : "Failed to edit");
    }
  }

  async function deleteMessage(m: ChatMessageDTO) {
    const ok = await dialog.confirm({
      message: "Delete this message?",
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      const updated = await api.deleteMessage(m.id);
      setMessages((prev) =>
        prev.map((x) => (x.id === updated.id ? updated : x)),
      );
      setThreadParent((p) => (p && p.id === updated.id ? updated : p));
    } catch (err) {
      setPaneError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  }

  // "Turn into task": pick (or create) a target list, then create the task.
  async function turnIntoTask(m: ChatMessageDTO) {
    if (!selectedId) return;
    try {
      let lists: ChatListDTO[] = await api.listLists(selectedId);
      let listId: string | undefined = lists[0]?.id;
      if (lists.length === 0) {
        const name = await dialog.prompt({
          message: "No list in this channel yet — name a new one",
          defaultValue: "Tasks",
          confirmLabel: "Create list",
        });
        if (!name || !name.trim()) return;
        const created = await api.createList({
          name: name.trim(),
          channelId: selectedId,
        });
        listId = created.id;
      } else if (lists.length > 1) {
        // Multiple lists: ask which one (by name); default to the first.
        const pick = await dialog.prompt({
          message: `Add to which list? ${lists
            .map((l) => l.name)
            .join(", ")}`,
          defaultValue: lists[0].name,
          confirmLabel: "Add task",
        });
        if (pick === null) return;
        const match = lists.find(
          (l) => l.name.toLowerCase() === pick.trim().toLowerCase(),
        );
        listId = (match ?? lists[0]).id;
      }
      if (!listId) return;
      await api.messageToTask(m.id, listId);
      await dialog.notify("Task created from this message.");
    } catch (err) {
      setPaneError(
        err instanceof ApiError ? err.message : "Failed to create task",
      );
    }
  }

  // Called by both composers (main + thread). Resolves @mentions, sends, then
  // merges the returned message in immediately (and refreshes badges).
  const sendMessage = useCallback(
    async (body: string, parentMessageId?: string) => {
      if (!selectedId) return;
      const mentionedAdminIds = resolveMentions(body, roster);
      const created = await api.sendMessage(selectedId, {
        body,
        parentMessageId,
        mentionedAdminIds: mentionedAdminIds.length
          ? mentionedAdminIds
          : undefined,
      });
      upsertMessages([created]);
      // Sending sets our own lastReadSeq server-side; refresh badges to match.
      refreshUnread();
      return created;
    },
    [selectedId, roster, upsertMessages, refreshUnread],
  );

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("projects", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Projects</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  return (
    <div>
      <div className="page-header">
        <h1>Projects</h1>
        <p className="subtitle">
          Internal team chat for back-office staff — channels, threads, reactions
          and tasks. Mention a teammate with <code>@name</code>.
        </p>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="pj-shell">
        {/* ---------------- Left: channel rail ---------------- */}
        <aside className="card pj-rail">
          <div className="card-head">
            <h2 style={{ fontSize: 16 }}>Channels</h2>
            {canCreate && (
              <button className="btn btn--sm" onClick={createChannel}>
                + New
              </button>
            )}
          </div>
          {loadingChannels ? (
            <p className="muted">Loading…</p>
          ) : channels.length === 0 ? (
            <p className="muted">
              No channels yet.{canCreate ? " Create one to begin." : ""}
            </p>
          ) : (
            <div className="pj-channel-list">
              {channels.map((ch) => {
                const active = ch.id === selectedId;
                const { unreadCount, mentionCount } = unreadFor(ch);
                return (
                  <button
                    key={ch.id}
                    onClick={() => setSelectedId(ch.id)}
                    className={`pj-channel${active ? " pj-channel--active" : ""}`}
                  >
                    <span className="pj-channel-name">
                      <span className="pj-hash">
                        {ch.isPrivate ? "🔒" : "#"}
                      </span>
                      <span
                        className={unreadCount > 0 ? "pj-channel-bold" : ""}
                      >
                        {ch.name}
                      </span>
                    </span>
                    <span className="pj-channel-badges">
                      {mentionCount > 0 && (
                        <span
                          className="pj-badge pj-badge--mention"
                          title={`${mentionCount} mention${
                            mentionCount === 1 ? "" : "s"
                          }`}
                        >
                          @{mentionCount}
                        </span>
                      )}
                      {unreadCount > 0 && (
                        <span className="pj-badge" title="Unread messages">
                          {unreadCount}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* ---------------- Direct messages section ---------------- */}
          <div className="card-head" style={{ marginTop: 18 }}>
            <h2 style={{ fontSize: 16 }}>Direct messages</h2>
            {canCreate && (
              <button
                className="btn btn--sm"
                onClick={() => setDmPickerOpen((v) => !v)}
              >
                + New message
              </button>
            )}
          </div>

          {dmPickerOpen && (
            <DmPicker
              roster={roster}
              myId={myId}
              onClose={() => setDmPickerOpen(false)}
              onOpen={openDm}
            />
          )}

          {dms.length === 0 ? (
            <p className="muted">No direct messages yet.</p>
          ) : (
            <div className="pj-channel-list">
              {dms.map((dm) => {
                const active = dm.id === selectedId;
                const others = dm.otherAdminIds;
                const label =
                  others.length === 0
                    ? "Just you"
                    : others.map(resolveName).join(", ");
                return (
                  <button
                    key={dm.id}
                    onClick={() => setSelectedId(dm.id)}
                    className={`pj-channel${active ? " pj-channel--active" : ""}`}
                  >
                    <span className="pj-channel-name">
                      <span
                        className="pj-avatar pj-avatar--sm"
                        aria-hidden="true"
                      >
                        {others.length === 1
                          ? initials(resolveName(others[0]))
                          : `${others.length}`}
                      </span>
                      <span
                        className={dm.unreadCount > 0 ? "pj-channel-bold" : ""}
                      >
                        {label}
                      </span>
                    </span>
                    <span className="pj-channel-badges">
                      {dm.mentionCount > 0 && (
                        <span
                          className="pj-badge pj-badge--mention"
                          title={`${dm.mentionCount} mention${
                            dm.mentionCount === 1 ? "" : "s"
                          }`}
                        >
                          @{dm.mentionCount}
                        </span>
                      )}
                      {dm.unreadCount > 0 && (
                        <span className="pj-badge" title="Unread messages">
                          {dm.unreadCount}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* ---------------- Right: message pane ---------------- */}
        <section className="card pj-pane">
          {!selected ? (
            <p className="muted">
              Select a channel on the left to view its messages.
            </p>
          ) : (
            <>
              <div className="pj-pane-head">
                <div>
                  <h2 className="pj-pane-title">
                    {selectedIsDm ? (
                      dmTitle(
                        detail?.members.map((m) => m.adminId) ??
                          selected.memberAdminIds ??
                          [],
                      )
                    ) : (
                      <>
                        {selected.isPrivate ? "🔒 " : "# "}
                        {selected.name}
                      </>
                    )}
                  </h2>
                  <p className="subtitle" style={{ fontSize: 13 }}>
                    {!selectedIsDm && detail?.topic ? (
                      detail.topic
                    ) : (
                      <>
                        {selected.memberCount} member
                        {selected.memberCount === 1 ? "" : "s"}
                      </>
                    )}
                    {onlineHere > 0 && (
                      <span className="pj-online" title={`${onlineHere} online`}>
                        <span className="pj-online-dot" aria-hidden="true" />
                        {onlineHere} online
                      </span>
                    )}
                  </p>
                </div>
                {/* DMs aren't "left"; only regular channels show the Leave action. */}
                {canEdit && !selectedIsDm && (
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => leaveChannel(selected)}
                  >
                    Leave
                  </button>
                )}
              </div>

              {/* Channel header tabs: Messages · each List · each Canvas · (+).
                  DMs have no tabs — they're always just the message pane. */}
              {!selectedIsDm && (
                <ChannelTabBar
                  lists={detail?.lists ?? []}
                  canvases={detail?.canvases ?? []}
                  activeTab={activeTab}
                  onSelect={setActiveTab}
                  canCreate={canCreate}
                  onAddList={addListTab}
                  onAddCanvas={addCanvasTab}
                />
              )}

              {paneError && <p className="error">{paneError}</p>}

              {/* ---- Messages tab (the existing pane; DMs only ever show this) ---- */}
              {(selectedIsDm || activeTab === "messages") && (
                <>
                  <div className="pj-messages" ref={scrollRef}>
                    {loadingMessages ? (
                      <p className="muted">Loading…</p>
                    ) : rootMessages.length === 0 ? (
                      <p className="muted">
                        No messages yet. Say hello below.
                      </p>
                    ) : (
                      rootMessages.map((m) => (
                        <MessageRow
                          key={m.id}
                          message={m}
                          mine={m.authorAdminId === myId}
                          resolveName={resolveName}
                          canEdit={canEdit}
                          canDelete={canDelete}
                          canCreate={canCreate}
                          onToggleReaction={toggleReaction}
                          onEdit={editMessage}
                          onDelete={deleteMessage}
                          onOpenThread={() => setThreadParent(m)}
                          onTurnIntoTask={() => turnIntoTask(m)}
                        />
                      ))
                    )}
                  </div>

                  {typingIds.length > 0 && (
                    <p className="pj-typing muted" aria-live="polite">
                      {typingIds.map(resolveName).join(", ")}{" "}
                      {typingIds.length === 1 ? "is" : "are"} typing…
                    </p>
                  )}

                  {canCreate && (
                    <Composer
                      key={selectedId}
                      roster={roster}
                      onSend={(body) => sendMessage(body)}
                      onType={() => selectedId && sendTyping(selectedId)}
                      placeholder={
                        selectedIsDm
                          ? `Message ${dmTitle(
                              detail?.members.map((m) => m.adminId) ??
                                selected.memberAdminIds ??
                                [],
                            )}`
                          : `Message #${selected.name}`
                      }
                    />
                  )}
                </>
              )}

              {/* ---- List tab (a channel queue table) ---- */}
              {!selectedIsDm && activeTab.startsWith("list:") && (
                <div className="pj-tab-body">
                  <QueueTable
                    key={activeTab}
                    listId={activeTab.slice("list:".length)}
                    roster={roster}
                    resolveName={resolveName}
                    meId={myId || null}
                    canCreate={canCreate}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    onError={setPaneError}
                  />
                </div>
              )}

              {/* ---- Canvas tab (a rich-text doc, the "Web SOP" tab) ---- */}
              {!selectedIsDm && activeTab.startsWith("canvas:") && (
                <div className="pj-tab-body">
                  <CanvasEditor
                    key={activeTab}
                    canvasId={activeTab.slice("canvas:".length)}
                    channelId={selectedId!}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    onError={setPaneError}
                    onDeleted={onCanvasDeleted}
                    onRenamed={refreshDetail}
                  />
                </div>
              )}
            </>
          )}
        </section>

        {/* ---------------- Thread panel ---------------- */}
        {threadParent && selected && (
          <ThreadPanel
            parent={threadParent}
            myId={myId}
            roster={roster}
            resolveName={resolveName}
            canEdit={canEdit}
            canDelete={canDelete}
            canCreate={canCreate}
            onClose={() => setThreadParent(null)}
            onSendReply={(body) => sendMessage(body, threadParent.id)}
            onToggleReaction={toggleReaction}
            onEdit={editMessage}
            onDelete={deleteMessage}
            onTurnIntoTask={turnIntoTask}
            // After replying, the parent's replyCount changes server-side; re-pull
            // the channel page to refresh it the next poll tick (cheap + simple).
          />
        )}
      </div>
    </div>
  );
}

// ---------------- New-message picker (choose admins to DM) ----------------
// A small inline picker under the "Direct messages" header: filter the roster,
// toggle one or more teammates (multi-select → a group DM), then "Start". The
// acting admin is excluded (the server adds them). Degrades gracefully when the
// roster is empty (the GET /admin/admins 403 for permission-scoped admins) — it
// shows a hint instead of an empty list.
function DmPicker({
  roster,
  myId,
  onClose,
  onOpen,
}: {
  roster: AdminLite[];
  myId: string;
  onClose: () => void;
  onOpen: (adminIds: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roster
      .filter((a) => a.id !== myId)
      .filter(
        (a) =>
          !q ||
          a.name.toLowerCase().includes(q) ||
          a.email.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [roster, myId, query]);

  function toggle(id: string) {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <div className="pj-dm-picker">
      <input
        placeholder="Search teammates…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search teammates"
        autoFocus
      />
      {roster.filter((a) => a.id !== myId).length === 0 ? (
        <p className="muted" style={{ marginTop: 8 }}>
          No teammates available.
        </p>
      ) : (
        <div className="pj-dm-picker-list">
          {candidates.length === 0 ? (
            <p className="muted">No matches.</p>
          ) : (
            candidates.map((a) => {
              const on = picked.includes(a.id);
              return (
                <button
                  type="button"
                  key={a.id}
                  className={`pj-mention-opt${
                    on ? " pj-mention-opt--active" : ""
                  }`}
                  onClick={() => toggle(a.id)}
                >
                  <span className="pj-avatar pj-avatar--sm" aria-hidden="true">
                    {initials(a.name)}
                  </span>
                  <span className="pj-mention-name">{a.name}</span>
                  <span className="pj-mention-email">{a.email}</span>
                  {on && <span aria-hidden="true">✓</span>}
                </button>
              );
            })
          )}
        </div>
      )}
      <div className="pj-dm-picker-actions">
        <button className="btn btn--ghost btn--sm" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn--sm"
          disabled={picked.length === 0}
          onClick={() => onOpen(picked)}
        >
          Start{picked.length > 1 ? ` (${picked.length})` : ""}
        </button>
      </div>
    </div>
  );
}

// ---------------- Single message row ----------------
function MessageRow({
  message: m,
  mine,
  resolveName,
  canEdit,
  canDelete,
  canCreate,
  compact = false,
  onToggleReaction,
  onEdit,
  onDelete,
  onOpenThread,
  onTurnIntoTask,
}: {
  message: ChatMessageDTO;
  mine: boolean;
  resolveName: NameResolver;
  canEdit: boolean;
  canDelete: boolean;
  canCreate: boolean;
  compact?: boolean;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onEdit: (m: ChatMessageDTO) => void;
  onDelete: (m: ChatMessageDTO) => void;
  onOpenThread?: () => void;
  onTurnIntoTask?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const deleted = !!m.deletedAt;
  // A workflow-authored message renders the workflow as the author (+ a WORKFLOW
  // badge) instead of the admin who triggered it.
  const byWorkflow = !!m.workflowName;
  const author = byWorkflow ? m.workflowName! : resolveName(m.authorAdminId);

  return (
    <div className="pj-msg">
      <span
        className={`pj-avatar${byWorkflow ? " pj-avatar--workflow" : ""}`}
        aria-hidden="true"
      >
        {byWorkflow ? "⚡" : initials(author)}
      </span>
      <div className="pj-msg-body">
        <div className="pj-msg-head">
          <span className="pj-author">{author}</span>
          {byWorkflow && <span className="pj-wf-badge">WORKFLOW</span>}
          <span className="pj-time">{formatTime(m.createdAt)}</span>
          {m.editedAt && !deleted && (
            <span className="pj-time" title="Edited">
              (edited)
            </span>
          )}
          {!compact && !deleted && (
            <div className="pj-msg-actions">
              <button
                className="pj-icon-btn"
                title="Add reaction"
                onClick={() => setPickerOpen((v) => !v)}
              >
                😊
              </button>
              {(canEdit || canDelete || canCreate) && (
                <div className="pj-menu-wrap">
                  <button
                    className="pj-icon-btn"
                    title="More"
                    onClick={() => setMenuOpen((v) => !v)}
                  >
                    ⋯
                  </button>
                  {menuOpen && (
                    <div
                      className="pj-menu"
                      onMouseLeave={() => setMenuOpen(false)}
                    >
                      {canCreate && onTurnIntoTask && (
                        <button
                          className="pj-menu-item"
                          onClick={() => {
                            setMenuOpen(false);
                            onTurnIntoTask();
                          }}
                        >
                          Turn into task
                        </button>
                      )}
                      {mine && canEdit && (
                        <button
                          className="pj-menu-item"
                          onClick={() => {
                            setMenuOpen(false);
                            onEdit(m);
                          }}
                        >
                          Edit
                        </button>
                      )}
                      {mine && canDelete && (
                        <button
                          className="pj-menu-item pj-menu-item--danger"
                          onClick={() => {
                            setMenuOpen(false);
                            onDelete(m);
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {deleted ? (
          <p className="pj-msg-text pj-msg-deleted">message deleted</p>
        ) : (
          <p className="pj-msg-text">{renderBody(m.body, resolveName)}</p>
        )}

        {/* Inline item card (the Image-1 task card) */}
        {!deleted && m.listItemCard && (
          <ListItemCard card={m.listItemCard} resolveName={resolveName} />
        )}

        {pickerOpen && !deleted && (
          <div className="pj-emoji-picker" onMouseLeave={() => setPickerOpen(false)}>
            {EMOJI_PALETTE.map((e) => (
              <button
                key={e}
                className="pj-emoji-opt"
                onClick={() => {
                  setPickerOpen(false);
                  onToggleReaction(m.id, e);
                }}
              >
                {e}
              </button>
            ))}
          </div>
        )}

        {/* reaction chips */}
        {m.reactions.length > 0 && !deleted && (
          <div className="pj-reactions">
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                className="pj-reaction"
                title={r.adminIds.map(resolveName).join(", ")}
                onClick={() => onToggleReaction(m.id, r.emoji)}
              >
                <span>{r.emoji}</span>
                <span className="pj-reaction-count">{r.adminIds.length}</span>
              </button>
            ))}
          </div>
        )}

        {/* thread affordance */}
        {!compact && onOpenThread && !deleted && (
          <button className="pj-thread-link" onClick={onOpenThread}>
            {m.replyCount > 0
              ? `💬 ${m.replyCount} repl${m.replyCount === 1 ? "y" : "ies"}`
              : "Reply in thread"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------- Thread panel (replies + reply composer) ----------------
function ThreadPanel({
  parent,
  myId,
  roster,
  resolveName,
  canEdit,
  canDelete,
  canCreate,
  onClose,
  onSendReply,
  onToggleReaction,
  onEdit,
  onDelete,
  onTurnIntoTask,
}: {
  parent: ChatMessageDTO;
  myId: string;
  roster: AdminLite[];
  resolveName: NameResolver;
  canEdit: boolean;
  canDelete: boolean;
  canCreate: boolean;
  onClose: () => void;
  onSendReply: (body: string) => Promise<ChatMessageDTO | undefined>;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onEdit: (m: ChatMessageDTO) => void;
  onDelete: (m: ChatMessageDTO) => void;
  onTurnIntoTask: (m: ChatMessageDTO) => void;
}) {
  const [replies, setReplies] = useState<ChatMessageDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const rows = await api.listReplies(parent.id);
      setReplies([...rows].sort((a, b) => a.seq - b.seq));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load thread");
    } finally {
      setLoading(false);
    }
  }, [parent.id]);

  useEffect(() => {
    load();
    const t = setInterval(load, THREAD_POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  return (
    <aside className="card pj-thread">
      <div className="pj-pane-head">
        <h2 className="pj-pane-title" style={{ fontSize: 16 }}>
          Thread
        </h2>
        <button className="modal-close" onClick={onClose} title="Close thread">
          ×
        </button>
      </div>

      <div className="pj-thread-scroll">
        <MessageRow
          message={parent}
          mine={parent.authorAdminId === myId}
          resolveName={resolveName}
          canEdit={canEdit}
          canDelete={canDelete}
          canCreate={canCreate}
          onToggleReaction={onToggleReaction}
          onEdit={onEdit}
          onDelete={onDelete}
          onTurnIntoTask={() => onTurnIntoTask(parent)}
        />
        <div className="pj-thread-divider">
          {parent.replyCount} repl{parent.replyCount === 1 ? "y" : "ies"}
        </div>
        {err && <p className="error">{err}</p>}
        {loading ? (
          <p className="muted">Loading…</p>
        ) : replies.length === 0 ? (
          <p className="muted">No replies yet.</p>
        ) : (
          replies.map((r) => (
            <MessageRow
              key={r.id}
              message={r}
              mine={r.authorAdminId === myId}
              resolveName={resolveName}
              canEdit={canEdit}
              canDelete={canDelete}
              canCreate={canCreate}
              compact
              onToggleReaction={onToggleReaction}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))
        )}
      </div>

      {canCreate && (
        <Composer
          roster={roster}
          placeholder="Reply…"
          onSend={async (body) => {
            await onSendReply(body);
            await load();
          }}
        />
      )}
    </aside>
  );
}

// ---------------- Composer (textarea + Send + @mention autocomplete) ----------------
function Composer({
  roster,
  placeholder,
  onSend,
  onType,
}: {
  roster: AdminLite[];
  placeholder: string;
  onSend: (body: string) => Promise<unknown>;
  // Fired (throttled) as the user types, to drive the realtime typing indicator.
  onType?: () => void;
}) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Throttle typing pings so a fast typist sends at most one per ~2s.
  const lastTypeRef = useRef(0);

  // Mention suggestions for the token currently being typed after an "@".
  const suggestions = useMemo(() => {
    if (mentionQuery === null || roster.length === 0) return [];
    const q = mentionQuery.toLowerCase();
    return roster
      .filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.email.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [mentionQuery, roster]);

  // Detect an in-progress "@token" at the caret and surface the picker.
  function onChange(next: string) {
    setValue(next);
    // Throttled typing ping (only when there's actual content being added).
    if (onType && next.length > 0) {
      const now = Date.now();
      if (now - lastTypeRef.current > 2000) {
        lastTypeRef.current = now;
        onType();
      }
    }
    const el = taRef.current;
    const caret = el ? el.selectionStart : next.length;
    const upto = next.slice(0, caret);
    const match = upto.match(/(?:^|\s)@([\w.\-]*)$/);
    if (match && roster.length > 0) {
      setMentionQuery(match[1]);
      setActiveIdx(0);
    } else {
      setMentionQuery(null);
    }
  }

  // Replace the in-progress @token with the chosen admin's handle.
  function applyMention(a: AdminLite) {
    const el = taRef.current;
    const caret = el ? el.selectionStart : value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const handle = a.name.replace(/\s+/g, "");
    const replaced = before.replace(/@([\w.\-]*)$/, `@${handle} `);
    const next = replaced + after;
    setValue(next);
    setMentionQuery(null);
    // Restore focus + caret just after the inserted handle.
    requestAnimationFrame(() => {
      if (el) {
        const pos = replaced.length;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const body = value.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSend(body);
      setValue("");
      setMentionQuery(null);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyMention(suggestions[activeIdx]);
        return;
      }
      if (e.key === "Escape") {
        setMentionQuery(null);
        return;
      }
    }
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form className="pj-composer" onSubmit={submit}>
      {mentionQuery !== null && suggestions.length > 0 && (
        <div className="pj-mention-pop">
          {suggestions.map((a, i) => (
            <button
              type="button"
              key={a.id}
              className={`pj-mention-opt${
                i === activeIdx ? " pj-mention-opt--active" : ""
              }`}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => applyMention(a)}
            >
              <span className="pj-avatar pj-avatar--sm" aria-hidden="true">
                {initials(a.name)}
              </span>
              <span className="pj-mention-name">{a.name}</span>
              <span className="pj-mention-email">{a.email}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={taRef}
        className="pj-composer-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={2}
        aria-label="Message"
      />
      <button
        className="btn"
        type="submit"
        disabled={sending || !value.trim()}
      >
        {sending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}

// Render a message body with @mentions emphasised. Plain text otherwise (no HTML
// injection — we only wrap matched @tokens in styled spans).
function renderBody(body: string, resolveName?: NameResolver) {
  // Two mention shapes: plain @handle (typed by a person) and <@adminId>
  // (emitted by a workflow). Highlight both; resolve <@id> to a display name.
  const parts = body.split(/(<@[\w.\-]+>|@[\w.\-]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith("<@") && part.endsWith(">")) {
      const id = part.slice(2, -1);
      const label = resolveName ? resolveName(id) : id;
      return (
        <span key={i} className="pj-mention-token">
          @{label}
        </span>
      );
    }
    if (part.startsWith("@") && part.length > 1) {
      return (
        <span key={i} className="pj-mention-token">
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ---------------- Inline list-item card (the Image-1 task card) ----------------
// Rendered beneath a message whose `listItemCard` is set (workflow auto-post, or
// a message turned into a task). Bordered card: the item title as a header + a
// small grid of field name -> rendered value (colored chip for SELECT, avatar +
// name for PERSON, readable text otherwise). Reuses the violet pj- tokens.
function ListItemCard({
  card,
  resolveName,
}: {
  card: NonNullable<ChatMessageDTO["listItemCard"]>;
  resolveName: NameResolver;
}) {
  return (
    <div className="pj-card">
      <div className="pj-card-head">
        <span className="pj-card-icon" aria-hidden="true">
          🗂
        </span>
        <span className="pj-card-title">{card.title}</span>
      </div>
      {card.fields.length > 0 && (
        <div className="pj-card-grid">
          {card.fields.map((f) => (
            <div className="pj-card-field" key={f.name}>
              <span className="pj-card-field-name">{f.name}</span>
              <span className="pj-card-field-value">
                {renderCardValue(f, resolveName)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Render one card field value by type (mirrors the lists table cell renders, but
// read-only + compact). SELECT -> colored chip; PERSON -> avatar + name; DATE ->
// readable date; MULTI_SELECT -> comma chips; else the stringified value.
function renderCardValue(
  field: NonNullable<ChatMessageDTO["listItemCard"]>["fields"][number],
  resolveName: NameResolver,
) {
  switch (field.type) {
    case "SELECT":
      return (
        <span className="chip" style={cardChipStyle(field.color)}>
          {field.label ?? cardValueText(field.value)}
        </span>
      );
    case "PERSON": {
      const id = cardValueText(field.value);
      const name = resolveName(id);
      return (
        <span className="pj-tbl-person">
          <span className="pj-avatar pj-avatar--sm">{initials(name)}</span>
          <span className="pj-tbl-personname">{name}</span>
        </span>
      );
    }
    case "MULTI_PERSON": {
      const ids = Array.isArray(field.value)
        ? (field.value as unknown[]).filter(
            (x): x is string => typeof x === "string",
          )
        : [];
      if (ids.length === 0) return <span>—</span>;
      return (
        <span className="pj-multiperson-list">
          {ids.map((id) => {
            const name = resolveName(id);
            return (
              <span className="pj-tbl-person" key={id}>
                <span className="pj-avatar pj-avatar--sm">{initials(name)}</span>
                <span className="pj-tbl-personname">{name}</span>
              </span>
            );
          })}
        </span>
      );
    }
    case "DATE": {
      const raw = cardValueText(field.value);
      const d = raw ? new Date(raw) : null;
      return (
        <span>
          {d && !Number.isNaN(d.getTime())
            ? d.toLocaleDateString()
            : raw || "—"}
        </span>
      );
    }
    case "MULTI_SELECT":
      return (
        <span>
          {Array.isArray(field.value)
            ? (field.value as unknown[]).join(", ")
            : cardValueText(field.value)}
        </span>
      );
    case "CHECKBOX":
      return <span>{field.value === true ? "Yes" : "No"}</span>;
    default:
      return <span>{cardValueText(field.value)}</span>;
  }
}

function cardValueText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

// SELECT chip tint from an option color (mirrors the lists page chipStyle).
function cardChipStyle(color?: string | null): React.CSSProperties {
  if (!color) return {};
  const m = color.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return { color };
  return { background: `rgba(${r}, ${g}, ${b}, 0.16)`, color };
}

// ---------------- Channel header tab bar (Messages · Lists · Canvases · +) ----
// Mirrors the Slack channel header tabs (Messages · Web SOP · WEB QUEUE · …).
// "Messages" is always first + default; then one tab per List (by name) and per
// Canvas (by title), in their server position order; then a "+" menu to add a
// list or a canvas. Reuses the violet pj-tab tokens.
function ChannelTabBar({
  lists,
  canvases,
  activeTab,
  onSelect,
  canCreate,
  onAddList,
  onAddCanvas,
}: {
  lists: { id: string; name: string }[];
  canvases: { id: string; title: string }[];
  activeTab: string;
  onSelect: (tab: string) => void;
  canCreate: boolean;
  onAddList: () => void;
  onAddCanvas: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="pj-tabbar" role="tablist">
      <button
        role="tab"
        aria-selected={activeTab === "messages"}
        className={`pj-tab${activeTab === "messages" ? " pj-tab--active" : ""}`}
        onClick={() => onSelect("messages")}
      >
        💬 Messages
      </button>

      {lists.map((l) => {
        const tab = `list:${l.id}`;
        return (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            className={`pj-tab${activeTab === tab ? " pj-tab--active" : ""}`}
            onClick={() => onSelect(tab)}
            title={`${l.name} (list)`}
          >
            🗂 {l.name}
          </button>
        );
      })}

      {canvases.map((c) => {
        const tab = `canvas:${c.id}`;
        return (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            className={`pj-tab${activeTab === tab ? " pj-tab--active" : ""}`}
            onClick={() => onSelect(tab)}
            title={`${c.title} (canvas)`}
          >
            📄 {c.title}
          </button>
        );
      })}

      {canCreate && (
        <div
          className="pj-tab-addwrap"
          onMouseLeave={() => setMenuOpen(false)}
        >
          <button
            className="pj-tab pj-tab--add"
            title="Add a list or canvas"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            +
          </button>
          {menuOpen && (
            <div className="pj-menu" role="menu">
              <button
                className="pj-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onAddList();
                }}
              >
                🗂 Add list
              </button>
              <button
                className="pj-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onAddCanvas();
                }}
              >
                📄 Add canvas
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------- Canvas editor (a rich-text channel tab, the "Web SOP" doc) --
// Loads the canvas by id (off the channel's canvases list — there's no single
// canvas GET; the set is small), shows an editable title + a RichTextEditor
// bound to the content, and persists via PATCH. Save is explicit; we also flush
// on blur of the editor so edits aren't lost on tab switch. Delete removes it.
function CanvasEditor({
  canvasId,
  channelId,
  canEdit,
  canDelete,
  onError,
  onDeleted,
  onRenamed,
}: {
  canvasId: string;
  channelId: string;
  canEdit: boolean;
  canDelete: boolean;
  onError: (msg: string) => void;
  onDeleted: () => void | Promise<void>;
  // Title changed server-side → let the parent refresh the tab bar label.
  onRenamed: () => void | Promise<void>;
}) {
  const [canvas, setCanvas] = useState<ChatCanvasDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  // Dirty when the local draft diverges from the last-saved canvas.
  const dirty =
    !!canvas && (title !== canvas.title || content !== canvas.content);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.listCanvases(channelId);
      const found = rows.find((c) => c.id === canvasId) ?? null;
      setCanvas(found);
      if (found) {
        setTitle(found.title);
        setContent(found.content);
      } else {
        onError("This canvas no longer exists.");
      }
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to load canvas");
    } finally {
      setLoading(false);
    }
  }, [canvasId, channelId, onError]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!canvas || !dirty) return;
    const t = title.trim();
    if (!t) {
      onError("A canvas needs a title.");
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateCanvas(canvas.id, {
        title: t,
        content,
      });
      setCanvas(updated);
      setTitle(updated.title);
      setContent(updated.content);
      // Refresh the tab bar label if the title moved.
      if (updated.title !== canvas.title) await onRenamed();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to save canvas");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!canvas) return;
    const ok = await dialog.confirm({
      message: `Delete canvas "${canvas.title}"? This cannot be undone.`,
      danger: true,
      confirmLabel: "Delete canvas",
    });
    if (!ok) return;
    try {
      await api.deleteCanvas(canvas.id);
      await onDeleted();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to delete canvas");
    }
  }

  if (loading && !canvas) return <p className="muted">Loading…</p>;
  if (!canvas)
    return (
      <div className="card" style={{ margin: 0 }}>
        <p className="muted">Canvas unavailable.</p>
      </div>
    );

  return (
    <div className="pj-canvas">
      <div className="pj-canvas-head">
        <input
          className="pj-canvas-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={!canEdit}
          placeholder="Canvas title"
          aria-label="Canvas title"
          // Save the title on blur if it changed (explicit Save still available).
          onBlur={() => {
            if (canEdit && dirty) save();
          }}
        />
        <div className="pj-canvas-actions">
          {canEdit && (
            <button
              className="btn btn--sm"
              onClick={save}
              disabled={saving || !dirty}
              title={dirty ? "Save changes" : "No changes to save"}
            >
              {saving ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
          )}
          {canDelete && (
            <button className="btn btn--ghost btn--sm" onClick={remove}>
              Delete
            </button>
          )}
        </div>
      </div>

      <div
        className="pj-canvas-body"
        // Flush an unsaved edit when focus leaves the editor (e.g. clicking a tab).
        onBlur={() => {
          if (canEdit && dirty) save();
        }}
      >
        {canEdit ? (
          <RichTextEditor value={content} onChange={setContent} />
        ) : (
          // Read-only viewers (no edit cap) get the rendered HTML.
          <div
            className="pj-canvas-readonly tiptap"
            dangerouslySetInnerHTML={{ __html: content || "<p></p>" }}
          />
        )}
      </div>
    </div>
  );
}
