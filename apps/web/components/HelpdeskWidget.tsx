"use client";

// Floating member-helpdesk launcher + guided support panel. Mounts once
// globally in app/layout.tsx (inside QueryProvider + ToastProvider, next to
// <PreviewBanner />). Renders for signed-in members only when the academy has
// the widget enabled; logged-out visitors fire NO request and see nothing.
//
// The guided flow: greeting → topic menu (answered from the member's OWN
// account data via existing endpoints) → "did this help?" → escalate into a
// ticket the admin dashboard shows. No language model: every branch is a
// button, every answer is the member's data.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { STR } from "@lms/types";
import type {
  ClassTileDTO,
  HelpdeskCategory,
  HelpdeskConversationSummaryDTO,
  HelpdeskMessageDTO,
  HelpdeskThreadDTO,
  LiveSessionBarDTO,
  MemberDashboardDTO,
  MySubscriptionDTO,
} from "@lms/types";
import { ApiError, api, getToken } from "@/lib/api";
import {
  qk,
  useHelpdeskArticles,
  useHelpdeskConfig,
  useHelpdeskConversations,
  useHelpdeskThread,
  useLiveCurrent,
  useMemberDashboard,
  useMe,
  useMyClasses,
  useMySubStatuses,
} from "@/lib/queries";
import { useToast } from "@/components/Toast";

type View =
  | "menu"
  | "classes"
  | "courses"
  | "payments"
  | "live"
  | "help"
  | "compose"
  | "requests"
  | "thread";

function fireStat(
  category: HelpdeskCategory,
  event: "cardView" | "resolvedYes" | "escalation",
) {
  // Fire-and-forget deflection analytics — never blocks the UI, never throws.
  void api.helpdeskStatEvent(category, event).catch(() => undefined);
}

export default function HelpdeskWidget() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [trail, setTrail] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [seedCategory, setSeedCategory] = useState<HelpdeskCategory>("OTHER");
  // Render nothing until mounted so the server (no localStorage token) and the
  // first client render agree — avoids a hydration mismatch on the FAB.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const config = useHelpdeskConfig();
  const me = useMe();
  const hasToken = typeof window !== "undefined" && !!getToken();

  // Never render for guests, before mount, or when the widget is turned off.
  if (!mounted || !hasToken) return null;
  if (config.data && !config.data.enabled) return null;

  const unread = config.data?.unread ?? 0;
  const openConversations = config.data?.openConversations ?? [];

  function go(next: View, label?: string, category?: HelpdeskCategory) {
    if (label) setTrail((t) => [...t, label]);
    if (category) {
      setSeedCategory(category);
      fireStat(category, "cardView");
    }
    setView(next);
  }

  function reset() {
    setView("menu");
    setTrail([]);
    setActiveId(null);
  }

  function openThread(id: string) {
    setActiveId(id);
    setView("thread");
  }

  function toCompose(category: HelpdeskCategory) {
    setSeedCategory(category);
    setView("compose");
  }

  const canBack = view !== "menu";

  return (
    <div className="helpdesk">
      {open && (
        <div
          className="helpdesk-panel"
          role="dialog"
          aria-label={STR.helpdesk.title}
        >
          <div className="helpdesk-head">
            {canBack ? (
              <button
                type="button"
                className="helpdesk-iconbtn"
                aria-label={STR.helpdesk.back}
                onClick={() =>
                  view === "thread" ? setView("requests") : reset()
                }
              >
                ‹ {STR.helpdesk.back}
              </button>
            ) : null}
            <h2>{STR.helpdesk.title}</h2>
            <button
              type="button"
              className="helpdesk-iconbtn"
              aria-label={STR.helpdesk.close}
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>

          {view === "menu" && (
            <MenuView
              greeting={(
                config.data?.greeting ?? STR.helpdesk.greetingFallback
              ).replace(
                /\s*\{firstName\}/g,
                me.data?.firstName ? ` ${me.data.firstName}` : "",
              )}
              openConversations={openConversations}
              onNavigate={go}
              onRequests={() => setView("requests")}
              onOpenThread={openThread}
            />
          )}
          {view === "classes" && (
            <ClassesView
              onEscalate={() => toCompose("ACCESS")}
              onDone={reset}
            />
          )}
          {view === "courses" && (
            <CoursesView
              onEscalate={() => toCompose("TECHNICAL")}
              onDone={reset}
            />
          )}
          {view === "payments" && (
            <PaymentsView
              onEscalate={() => toCompose("BILLING")}
              onDone={reset}
            />
          )}
          {view === "live" && (
            <LiveView
              onEscalate={() => toCompose("LIVE_SESSION")}
              onDone={reset}
            />
          )}
          {view === "help" && (
            <HelpView onEscalate={() => toCompose("OTHER")} />
          )}
          {view === "compose" && (
            <ComposeView
              category={seedCategory}
              breadcrumbs={trail}
              onSent={(thread) => openThread(thread.id)}
            />
          )}
          {view === "requests" && (
            <RequestsView
              onOpen={openThread}
              onNew={() => toCompose("OTHER")}
            />
          )}
          {view === "thread" && activeId && (
            <ThreadView
              id={activeId}
              replyTimeNote={config.data?.replyTimeNote ?? null}
            />
          )}
        </div>
      )}

      <button
        type="button"
        className="helpdesk-fab"
        aria-label={STR.helpdesk.open}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) reset();
        }}
      >
        {STR.helpdesk.open}
        {unread > 0 && <span className="helpdesk-badge">{unread}</span>}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- menu

function MenuView({
  greeting,
  openConversations,
  onNavigate,
  onRequests,
  onOpenThread,
}: {
  greeting: string;
  openConversations: HelpdeskConversationSummaryDTO[];
  onNavigate: (v: View, label: string, category?: HelpdeskCategory) => void;
  onRequests: () => void;
  onOpenThread: (id: string) => void;
}) {
  // The live-session slot is conditional — shown only when the member actually
  // has a session to ask about (empty menu items erode trust in the widget).
  const live = useLiveCurrent(true);
  const showLive = (live.data?.length ?? 0) > 0;

  return (
    <div className="helpdesk-body">
      <p className="helpdesk-greeting">{greeting}</p>
      <div className="helpdesk-menu">
        <MenuButton
          label={STR.helpdesk.menuClasses}
          onClick={() =>
            onNavigate("classes", STR.helpdesk.menuClasses, "ACCESS")
          }
        />
        <MenuButton
          label={STR.helpdesk.menuCourses}
          onClick={() =>
            onNavigate("courses", STR.helpdesk.menuCourses, "TECHNICAL")
          }
        />
        <MenuButton
          label={STR.helpdesk.menuPayments}
          onClick={() =>
            onNavigate("payments", STR.helpdesk.menuPayments, "BILLING")
          }
        />
        {showLive && (
          <MenuButton
            label={STR.helpdesk.menuLive}
            onClick={() =>
              onNavigate("live", STR.helpdesk.menuLive, "LIVE_SESSION")
            }
          />
        )}
        <MenuButton
          label={STR.helpdesk.menuSomethingElse}
          onClick={() =>
            onNavigate("help", STR.helpdesk.menuSomethingElse, "OTHER")
          }
        />
      </div>

      {openConversations.length > 0 && (
        <>
          <div className="helpdesk-help-foot">
            <span>{STR.helpdesk.myRequests}</span>
            <button
              type="button"
              className="helpdesk-btn is-link"
              onClick={onRequests}
            >
              {STR.helpdesk.viewAll}
            </button>
          </div>
          {openConversations.slice(0, 3).map((c) => (
            <button
              key={c.id}
              type="button"
              className="helpdesk-menu-item"
              onClick={() => onOpenThread(c.id)}
            >
              <span>{c.subject}</span>
              <StatusPill status={c.status} />
            </button>
          ))}
        </>
      )}
    </div>
  );
}

function MenuButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="helpdesk-menu-item" onClick={onClick}>
      <span>{label}</span>
      <span className="chev" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

function StatusPill({ status }: { status: HelpdeskThreadDTO["status"] }) {
  const label =
    status === "WAITING_ON_MEMBER"
      ? STR.helpdesk.statusWaiting
      : status === "RESOLVED"
        ? STR.helpdesk.statusResolved
        : status === "CLOSED"
          ? STR.helpdesk.statusClosed
          : STR.helpdesk.statusOpen;
  const cls = status === "WAITING_ON_MEMBER" ? "is-waiting" : "is-open";
  return <span className={`helpdesk-pill ${cls}`}>{label}</span>;
}

// A reusable "did this help?" footer under every data card.
function HelpFoot({
  category,
  onEscalate,
  onDone,
}: {
  category: HelpdeskCategory;
  onEscalate: () => void;
  onDone: () => void;
}) {
  return (
    <div className="helpdesk-help-foot">
      <span>{STR.helpdesk.didThisHelp}</span>
      <div className="helpdesk-actions">
        <button
          type="button"
          className="helpdesk-btn"
          onClick={() => {
            fireStat(category, "resolvedYes");
            onDone();
          }}
        >
          {STR.helpdesk.yesThanks}
        </button>
        <button
          type="button"
          className="helpdesk-btn is-primary"
          onClick={onEscalate}
        >
          {STR.helpdesk.talkToHuman}
        </button>
      </div>
    </div>
  );
}

function Loading() {
  return <p className="helpdesk-empty">{STR.common.loading}</p>;
}

// Private image: fetch a short-lived scoped token, then render via ?token= (an
// <img> can't send an Authorization header).
function AttachmentThumb({
  attachmentId,
  name,
}: {
  attachmentId: string;
  name: string;
}) {
  const { data } = useQuery({
    queryKey: qk.helpdeskAttachment(attachmentId),
    queryFn: () => api.helpdeskAttachmentToken(attachmentId),
    staleTime: 120_000,
  });
  if (!data) return null;
  const url = api.helpdeskAttachmentUrl(attachmentId, data.token);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="helpdesk-thumb"
      title={name}
    >
      <img src={url} alt={name} />
    </a>
  );
}

const MAX_FILES = 3;

// A compact image picker used by the compose + reply composers.
function FilePick({
  files,
  onChange,
}: {
  files: File[];
  onChange: (f: File[]) => void;
}) {
  return (
    <label className="helpdesk-btn" style={{ cursor: "pointer" }}>
      {files.length > 0
        ? `${files.length} image${files.length > 1 ? "s" : ""} attached`
        : "Attach image"}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []).slice(0, MAX_FILES);
          onChange(picked);
        }}
      />
    </label>
  );
}

// Given a fresh thread, find the member message just posted (to attach to).
function lastMemberMessageId(thread: HelpdeskThreadDTO): string | null {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    if (thread.messages[i].authorKind === "MEMBER")
      return thread.messages[i].id;
  }
  return null;
}

// ---------------------------------------------------------------- classes

function ClassesView({
  onEscalate,
  onDone,
}: {
  onEscalate: () => void;
  onDone: () => void;
}) {
  const classes = useMyClasses(true);
  const subs = useMySubStatuses(true);
  if (classes.isLoading || subs.isLoading) return <Loading />;

  const owned = (classes.data ?? []).filter((c) => c.owned);
  const nameByLevel = new Map<string, string>(
    (classes.data ?? []).map((c) => [c.id, c.name]),
  );
  const pastDue = (subs.data ?? []).filter(
    (s: MySubscriptionDTO) => s.status === "PAST_DUE",
  );

  return (
    <div className="helpdesk-body">
      {pastDue.map((s) => (
        <div key={s.levelId} className="helpdesk-card is-alert">
          <h3>{nameByLevel.get(s.levelId) ?? "A class"}</h3>
          <p>
            {STR.helpdesk.pastDueLocked(nameByLevel.get(s.levelId) ?? "It")}
          </p>
          <div className="helpdesk-actions">
            <a className="helpdesk-btn is-primary" href="/account/payments">
              {STR.helpdesk.fixPayment}
            </a>
          </div>
        </div>
      ))}

      {owned.length === 0 && pastDue.length === 0 && (
        <p className="helpdesk-empty">{STR.helpdesk.noRequests}</p>
      )}

      {owned.map((c: ClassTileDTO) => (
        <div key={c.id} className="helpdesk-card">
          <div className="helpdesk-row">
            <strong>{c.name}</strong>
            {c.progress && c.progress.total > 0 ? (
              <span className="helpdesk-pill is-open">
                {c.progress.completed}/{c.progress.total}
              </span>
            ) : null}
          </div>
        </div>
      ))}

      <HelpFoot category="ACCESS" onEscalate={onEscalate} onDone={onDone} />
    </div>
  );
}

// ---------------------------------------------------------------- courses

function CoursesView({
  onEscalate,
  onDone,
}: {
  onEscalate: () => void;
  onDone: () => void;
}) {
  const dash = useMemberDashboard();
  if (dash.isLoading) return <Loading />;
  const data = dash.data as MemberDashboardDTO | undefined;
  const owned = (data?.classes ?? []).filter((c) => c.owned);

  return (
    <div className="helpdesk-body">
      {owned.length === 0 && (
        <p className="helpdesk-empty">{STR.helpdesk.noRequests}</p>
      )}
      {owned.map((c) => {
        const extra = data?.extras[c.id];
        return (
          <div key={c.id} className="helpdesk-card">
            <h3>{c.name}</h3>
            {extra ? (
              <p>
                {extra.lessonTotal - extra.lessonsLeft}/{extra.lessonTotal}{" "}
                lessons complete
                {extra.next ? ` — up next: ${extra.next.lesson.title}` : ""}
              </p>
            ) : null}
            {c.slug ? (
              <div className="helpdesk-actions">
                <a className="helpdesk-btn" href={`/classes/${c.slug}`}>
                  {STR.helpdesk.openItem}
                </a>
              </div>
            ) : null}
          </div>
        );
      })}
      <HelpFoot category="TECHNICAL" onEscalate={onEscalate} onDone={onDone} />
    </div>
  );
}

// ---------------------------------------------------------------- payments

function PaymentsView({
  onEscalate,
  onDone,
}: {
  onEscalate: () => void;
  onDone: () => void;
}) {
  const subs = useMySubStatuses(true);
  const classes = useMyClasses(true);
  const show = useToast();
  const [busy, setBusy] = useState(false);
  if (subs.isLoading || classes.isLoading) return <Loading />;

  const nameByLevel = new Map<string, string>(
    (classes.data ?? []).map((c) => [c.id, c.name]),
  );
  const rows = subs.data ?? [];

  async function openPortal() {
    setBusy(true);
    try {
      const { url } = await api.portal();
      window.location.href = url;
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        show(err instanceof ApiError ? err.message : STR.errors.generic);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="helpdesk-body">
      {rows.length === 0 && (
        <p className="helpdesk-empty">{STR.helpdesk.noRequests}</p>
      )}
      {rows.map((s: MySubscriptionDTO) => (
        <div
          key={s.levelId}
          className={`helpdesk-card${s.status === "PAST_DUE" ? " is-alert" : ""}`}
        >
          <div className="helpdesk-row">
            <strong>{nameByLevel.get(s.levelId) ?? s.levelId}</strong>
            <span
              className={`helpdesk-pill ${s.status === "PAST_DUE" ? "is-pastdue" : "is-open"}`}
            >
              {s.status === "PAST_DUE" ? "Past due" : "Active"}
            </span>
          </div>
          {s.status === "PAST_DUE" && (
            <p>
              {STR.helpdesk.pastDueLocked(nameByLevel.get(s.levelId) ?? "It")}
            </p>
          )}
        </div>
      ))}

      <div className="helpdesk-actions">
        <button
          type="button"
          className="helpdesk-btn is-primary"
          disabled={busy}
          onClick={() => void openPortal()}
        >
          {STR.helpdesk.manageBilling}
        </button>
        <a className="helpdesk-btn" href="/account/payments">
          {STR.helpdesk.paymentHistory}
        </a>
      </div>

      <HelpFoot category="BILLING" onEscalate={onEscalate} onDone={onDone} />
    </div>
  );
}

// ---------------------------------------------------------------- live

function LiveView({
  onEscalate,
  onDone,
}: {
  onEscalate: () => void;
  onDone: () => void;
}) {
  const live = useLiveCurrent(true);
  if (live.isLoading) return <Loading />;
  const sessions = live.data ?? [];

  return (
    <div className="helpdesk-body">
      {sessions.length === 0 && (
        <p className="helpdesk-empty">{STR.helpdesk.noLiveSessions}</p>
      )}
      {sessions.map((s: LiveSessionBarDTO) => (
        <div key={s.id} className="helpdesk-card">
          <div className="helpdesk-row">
            <strong>{s.title}</strong>
            {s.isLive ? (
              <span className="helpdesk-pill is-waiting">Live now</span>
            ) : (
              <span className="helpdesk-pill is-open">
                {new Date(s.startsAt).toLocaleString()}
              </span>
            )}
          </div>
          <div className="helpdesk-actions">
            <a className="helpdesk-btn is-primary" href={`/live/${s.id}`}>
              {STR.helpdesk.openItem}
            </a>
          </div>
        </div>
      ))}
      <HelpFoot
        category="LIVE_SESSION"
        onEscalate={onEscalate}
        onDone={onDone}
      />
    </div>
  );
}

// ---------------------------------------------------------------- help / FAQ

function HelpView({ onEscalate }: { onEscalate: () => void }) {
  const articles = useHelpdeskArticles(true);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="helpdesk-body">
      {(articles.data?.length ?? 0) > 0 && (
        <>
          <p className="helpdesk-greeting">{STR.helpdesk.articlesHeading}</p>
          {(articles.data ?? []).map((a) => (
            <div key={a.id} className="helpdesk-card">
              <button
                type="button"
                className="helpdesk-btn is-link"
                onClick={() => setOpenId((id) => (id === a.id ? null : a.id))}
              >
                {a.title}
              </button>
              {openId === a.id && <p>{a.body}</p>}
            </div>
          ))}
        </>
      )}

      <p className="helpdesk-greeting">{STR.helpdesk.accountHeading}</p>
      <div className="helpdesk-actions">
        <a className="helpdesk-btn" href="/account">
          {STR.helpdesk.manageAccount}
        </a>
      </div>

      <div className="helpdesk-help-foot">
        <span>{STR.helpdesk.describeIssue}</span>
        <button
          type="button"
          className="helpdesk-btn is-primary"
          onClick={onEscalate}
        >
          {STR.helpdesk.talkToHuman}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- compose

function ComposeView({
  category,
  breadcrumbs,
  onSent,
}: {
  category: HelpdeskCategory;
  breadcrumbs: string[];
  onSent: (thread: HelpdeskThreadDTO) => void;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const queryClient = useQueryClient();
  const show = useToast();

  const mutation = useMutation({
    mutationFn: async (issue: string) => {
      const thread = await api.helpdeskStart({ issue, category, breadcrumbs });
      const msgId = lastMemberMessageId(thread);
      if (files.length > 0 && msgId) {
        return api.helpdeskUploadAttachments(thread.id, msgId, files);
      }
      return thread;
    },
    onSuccess: (thread) => {
      fireStat(category, "escalation");
      queryClient.setQueryData(qk.helpdeskThread(thread.id), thread);
      void queryClient.invalidateQueries({ queryKey: qk.helpdeskConfig });
      void queryClient.invalidateQueries({
        queryKey: qk.helpdeskConversations,
      });
      show(STR.helpdesk.sent, { tone: "success" });
      onSent(thread);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) return;
      const msg =
        err instanceof ApiError && err.code === "HELPDESK_TOO_MANY_OPEN"
          ? STR.helpdesk.tooManyOpen
          : err instanceof ApiError && err.code === "HELPDESK_DISABLED"
            ? STR.helpdesk.disabled
            : err instanceof ApiError
              ? err.message
              : STR.errors.generic;
      show(msg);
    },
  });

  return (
    <div className="helpdesk-body">
      <p className="helpdesk-greeting">{STR.helpdesk.describeIssue}</p>
      <textarea
        className="helpdesk-textarea"
        placeholder={STR.helpdesk.issuePlaceholder}
        value={text}
        maxLength={4000}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="helpdesk-actions">
        <FilePick files={files} onChange={setFiles} />
        <button
          type="button"
          className="helpdesk-btn is-primary"
          disabled={mutation.isPending || text.trim().length === 0}
          onClick={() => mutation.mutate(text.trim())}
        >
          {mutation.isPending ? STR.helpdesk.sending : STR.helpdesk.send}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- requests

function RequestsView({
  onOpen,
  onNew,
}: {
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const list = useHelpdeskConversations(true);
  if (list.isLoading) return <Loading />;
  const items = list.data ?? [];

  return (
    <div className="helpdesk-body">
      {items.length === 0 && (
        <p className="helpdesk-empty">{STR.helpdesk.noRequests}</p>
      )}
      {items.map((c) => (
        <button
          key={c.id}
          type="button"
          className="helpdesk-menu-item"
          onClick={() => onOpen(c.id)}
        >
          <span>{c.subject}</span>
          <StatusPill status={c.status} />
        </button>
      ))}
      <div className="helpdesk-actions">
        <button type="button" className="helpdesk-btn" onClick={onNew}>
          {STR.helpdesk.talkToHuman}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- thread

function ThreadView({
  id,
  replyTimeNote,
}: {
  id: string;
  replyTimeNote: string | null;
}) {
  const thread = useHelpdeskThread(id);
  const queryClient = useQueryClient();
  const show = useToast();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  // Mark read on open (explicit — never a GET side effect) and refresh the
  // unread badge.
  useEffect(() => {
    void api
      .helpdeskMarkRead(id)
      .then(() =>
        queryClient.invalidateQueries({ queryKey: qk.helpdeskConfig }),
      )
      .catch(() => undefined);
  }, [id, queryClient]);

  const reply = useMutation({
    scope: { id: `helpdesk:${id}` },
    mutationFn: async (body: string) => {
      const updated = await api.helpdeskReply(id, body);
      const msgId = lastMemberMessageId(updated);
      if (files.length > 0 && msgId) {
        return api.helpdeskUploadAttachments(id, msgId, files);
      }
      return updated;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.helpdeskThread(id), updated);
      setText("");
      setFiles([]);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) return;
      const msg =
        err instanceof ApiError && err.code === "HELPDESK_CLOSED"
          ? STR.helpdesk.statusClosed
          : err instanceof ApiError
            ? err.message
            : STR.errors.generic;
      show(msg);
    },
  });

  const data = thread.data;
  const closed = data?.status === "CLOSED";

  return (
    <>
      <div className="helpdesk-body">
        {thread.isLoading && <Loading />}
        {data && (
          <div className="helpdesk-thread">
            {data.messages.map((m: HelpdeskMessageDTO) => (
              <div
                key={m.id}
                className={`helpdesk-msg from-${m.authorKind.toLowerCase()}`}
              >
                {m.authorKind === "ADMIN" && (
                  <span className="who">{m.authorName ?? "Support"}</span>
                )}
                {m.body}
                {m.attachments.length > 0 && (
                  <div className="helpdesk-thumbs">
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
          </div>
        )}
        {replyTimeNote && <p className="helpdesk-note">{replyTimeNote}</p>}
      </div>

      {!closed && (
        <div className="helpdesk-composer">
          <input
            type="text"
            placeholder={STR.helpdesk.replyPlaceholder}
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim() && !reply.isPending) {
                reply.mutate(text.trim());
              }
            }}
          />
          <FilePick files={files} onChange={setFiles} />
          <button
            type="button"
            className="helpdesk-btn is-primary"
            disabled={reply.isPending || text.trim().length === 0}
            onClick={() => reply.mutate(text.trim())}
          >
            {STR.helpdesk.reply}
          </button>
        </div>
      )}
    </>
  );
}
