"use client";

// Floating member-helpdesk launcher + guided support panel. Mounts once
// globally in app/layout.tsx (inside QueryProvider + ToastProvider, next to
// <PreviewBanner />). Renders for signed-in members only when the academy has
// the widget enabled; logged-out visitors fire NO request and see nothing.
//
// The guided flow: greeting → topic menu (answered from the member's OWN
// account data via existing endpoints) → next-step suggestions. No language
// model: every branch is a button, every answer is the member's data.
//
// An answer never asks the member to rate it — it offers somewhere useful to go
// next, and the one route to a human lives permanently in the bottom strip.
// Deflection is measured passively as 1 − escalations/cardViews.

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { STR, categoryForText, routeHelpdeskText } from "@lms/types";
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

type View = "chat" | "thread";

/** Topics the web widget can answer inline from the member's own account. */
const ANSWERABLE: HelpdeskCategory[] = [
  "ACCESS",
  "TECHNICAL",
  "BILLING",
  "LIVE_SESSION",
];

const TOPIC_LABEL: Partial<Record<HelpdeskCategory, string>> = {
  ACCESS: STR.helpdesk.menuClasses,
  TECHNICAL: STR.helpdesk.menuCourses,
  BILLING: STR.helpdesk.menuPayments,
  LIVE_SESSION: STR.helpdesk.menuLive,
};

/** The bot "thinks" for a beat so an answer reads as a reply, not a repaint. */
const TYPING_MS = 450;

type ChipDef = {
  key: string;
  label: string;
  category?: HelpdeskCategory;
  action?: "requests" | "articles";
};

type Turn = {
  id: string;
  role: "bot" | "member";
  text?: string;
  /** Render this topic's account-data card inside the bubble. */
  answer?: HelpdeskCategory;
  /** Render the member's existing tickets inside the bubble. */
  requests?: boolean;
  /** Render the academy's FAQ articles inside the bubble. */
  articles?: boolean;
  /** Quick replies — only ever shown under the LAST turn. */
  chips?: ChipDef[];
};

function fireStat(
  category: HelpdeskCategory,
  event: "cardView" | "resolvedYes" | "escalation",
) {
  // Fire-and-forget deflection analytics — never blocks the UI, never throws.
  void api.helpdeskStatEvent(category, event).catch(() => undefined);
}

export default function HelpdeskWidget() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("chat");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  /** Text the member will send to a human if they confirm. */
  const [pendingEscalation, setPendingEscalation] = useState<string | null>(
    null,
  );
  /** Editable escalation body — lifted out of ComposeView so a topic change or
   *  a background config refetch can't destroy what the member was typing. */
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  /** Topic labels consulted this session — sent with a ticket so the admin
   *  sees what the member already looked at before asking for a person. */
  const [trail, setTrail] = useState<string[]>([]);
  /** The last topic the member actually OPENED. Escalations are filed against
   *  it for stats so the numerator and denominator share a taxonomy. */
  const lastViewedRef = useRef<HelpdeskCategory | null>(null);
  // Render nothing until mounted so the server (no localStorage token) and the
  // first client render agree — avoids a hydration mismatch on the FAB.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const seq = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  /** The bot turn currently waiting on its typing delay (at most one). */
  const pendingReply = useRef<{
    turn: Omit<Turn, "id" | "role">;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  // Topics already counted this session — deflection is 1 - escalations/cardViews
  // so the denominator must mean "distinct topics consulted", not clicks.
  const viewedRef = useRef<Set<HelpdeskCategory>>(new Set());

  const config = useHelpdeskConfig();
  const me = useMe();
  // Gate on an actually-open panel: hooks must run unconditionally (they sit
  // above the guest early-return), so the `enabled` flag is what keeps a
  // logged-out visitor from firing these on every page load.
  const signedIn = mounted && typeof window !== "undefined" && !!getToken();
  const live = useLiveCurrent(signedIn && open);
  // ALL of the member's tickets, closed ones included — config.openConversations
  // excludes CLOSED, which used to leave closed history unreachable here.
  const allConversations = useHelpdeskConversations(signedIn && open);
  const hasToken = signedIn;

  const greetingText = config.data?.greeting;
  const firstName = me.data?.firstName;
  const enabled = config.data?.enabled === true;
  const hasLive = (live.data?.length ?? 0) > 0;
  const waitingOnUs =
    (config.data?.unread ?? 0) > 0 ||
    (config.data?.openConversations.length ?? 0) > 0;

  const topicChips = useCallback(
    (exclude?: HelpdeskCategory): ChipDef[] => [
      ...ANSWERABLE.filter(
        (c) => c !== exclude && (c !== "LIVE_SESSION" || hasLive),
      ).map((c) => ({ key: c, label: TOPIC_LABEL[c] ?? c, category: c })),
      {
        key: "articles",
        label: STR.helpdesk.menuSomethingElse,
        action: "articles" as const,
      },
      {
        key: "requests",
        label: STR.helpdesk.myRequests,
        action: "requests" as const,
      },
    ],
    [hasLive],
  );

  // Open with the greeting + the topic menu as quick replies.
  useEffect(() => {
    // Don't freeze the opening turn until the data it renders has settled —
    // otherwise it keeps a nameless greeting and a menu missing "Live session".
    if (!enabled || !open || me.isPending || live.isPending) return;
    setTurns((prev) => {
      if (prev.length > 0) return prev;
      const greeting = (greetingText || STR.helpdesk.greetingFallback).replace(
        /\s*\{firstName\}/g,
        firstName ? ` ${firstName}` : "",
      );
      const opening: Turn[] = [
        { id: `t${++seq.current}`, role: "bot", text: greeting },
      ];
      // If a reply is waiting (what the unread badge pointed at) or a request
      // is still open, put it on screen rather than making them hunt for it.
      if (waitingOnUs)
        opening.push({
          id: `t${++seq.current}`,
          role: "bot",
          requests: true,
          chips: topicChips(),
        });
      else opening[0].chips = topicChips();
      return opening;
    });
  }, [
    enabled,
    open,
    greetingText,
    firstName,
    topicChips,
    me.isPending,
    live.isPending,
  ]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  // Keep the newest message in view — a transcript that doesn't follow itself
  // hides the answer below the fold on every turn.
  useEffect(() => {
    bodyRef.current?.scrollTo({
      top: bodyRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, typing, pendingEscalation, open, view]);

  // Never render for guests, before mount, or when the widget is turned off.
  if (!mounted || !hasToken) return null;
  if (config.data && !config.data.enabled) return null;

  const unread = config.data?.unread ?? 0;
  const openConversations = config.data?.openConversations ?? [];
  const conversations = allConversations.data ?? openConversations;
  // Mirror the server's rule (helpdesk.service.ts OPEN_STATUSES): RESOLVED is
  // reopenable and does NOT count. openConversations is "not CLOSED", which
  // includes RESOLVED — counting it locked members out of escalating at all.
  const atCap =
    !!config.data &&
    openConversations.filter(
      (c) => c.status === "ESCALATED" || c.status === "WAITING_ON_MEMBER",
    ).length >= (config.data.maxOpenPerMember ?? 3);

  /** Abandon a pending escalation, including its draft and attachments — a
   *  screenshot picked for one message must never ride onto another ticket. */
  function clearEscalation() {
    setPendingEscalation(null);
    setDraft("");
    setFiles([]);
  }

  /** Count a self-serve view — once per topic per visit, and only when the
   *  answer actually contained data. */
  function countView(category: HelpdeskCategory, hadData: boolean) {
    if (!hadData || viewedRef.current.has(category)) return;
    viewedRef.current.add(category);
    fireStat(category, "cardView");
  }

  function push(turn: Omit<Turn, "id">) {
    setTurns((t) => [...t, { ...turn, id: `t${++seq.current}` }]);
  }

  /** Land any bot turn still waiting on its typing delay, so a fast second
   *  question can never overtake the answer to the first. */
  function flushPending() {
    if (!pendingReply.current) return;
    clearTimeout(pendingReply.current.timer);
    push({ ...pendingReply.current.turn, role: "bot" });
    pendingReply.current = null;
  }

  function botReply(turn: Omit<Turn, "id" | "role">) {
    setTyping(true);
    const timer = setTimeout(() => {
      pendingReply.current = null;
      setTyping(false);
      push({ ...turn, role: "bot" });
    }, TYPING_MS);
    pendingReply.current = { turn, timer };
    timers.current.push(timer);
  }

  function answerTopic(category: HelpdeskCategory, echo: string) {
    flushPending();
    push({ role: "member", text: echo });
    clearEscalation();
    setTrail((t) => (t.includes(echo) ? t : [...t, echo]));
    lastViewedRef.current = category;
    // The cardView is fired by the answer itself once it knows whether it had
    // anything to say — an empty card is not a self-serve success.
    botReply({ answer: category, chips: topicChips(category) });
  }

  function showRequests(echo: string) {
    flushPending();
    push({ role: "member", text: echo });
    clearEscalation();
    // Always render the list turn and let it read the LIVE list — a frozen
    // emptiness check told members with only closed tickets they'd never written.
    botReply({ requests: true, chips: topicChips() });
  }

  function showArticles(echo: string) {
    flushPending();
    push({ role: "member", text: echo });
    clearEscalation();
    if (!viewedRef.current.has("OTHER")) {
      viewedRef.current.add("OTHER");
      fireStat("OTHER", "cardView");
    }
    botReply({ articles: true, chips: topicChips() });
  }

  /** Open the escalation box seeded with `text`. `echo` renders the member's
   *  own words first (skip it when they pressed the permanent button). */
  function startEscalation(text: string, echo = false) {
    flushPending();
    if (echo) push({ role: "member", text });
    if (atCap) {
      setPendingEscalation(null);
      botReply({ text: STR.helpdesk.tooManyOpen, chips: topicChips() });
      return;
    }
    // A NEW seed each time, so a second unmatched message replaces the first
    // rather than silently keeping the original text.
    setDraft(text);
    setFiles([]);
    setPendingEscalation(text);
    // Keep the menu alive: an unanswered message must not strand the member.
    botReply({
      text: text ? STR.helpdesk.cantAnswer : STR.helpdesk.describeIssue,
      chips: topicChips(),
    });
  }

  function onChip(c: ChipDef) {
    if (c.action === "requests") return showRequests(c.label);
    if (c.action === "articles") return showArticles(c.label);
    if (c.category) return answerTopic(c.category, c.label);
  }

  function onSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    const intent = routeHelpdeskText(
      text,
      ANSWERABLE.filter((c) => c !== "LIVE_SESSION" || hasLive),
    );
    if (intent.kind === "topic") return answerTopic(intent.category, text);
    if (intent.kind === "requests") return showRequests(text);
    if (intent.kind === "human") {
      // They asked for a person — don't tell them we couldn't understand.
      push({ role: "member", text });
      return startEscalation(text);
    }
    return startEscalation(text, true);
  }

  function openThread(id: string) {
    setActiveId(id);
    setView("thread");
  }

  const lastIndex = turns.length - 1;

  return (
    <div className="helpdesk">
      {open && (
        <div
          className="helpdesk-panel"
          role="dialog"
          aria-label={STR.helpdesk.title}
        >
          <div className="helpdesk-head">
            {view === "thread" ? (
              <button
                type="button"
                className="helpdesk-iconbtn"
                aria-label={STR.helpdesk.back}
                onClick={() => setView("chat")}
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

          {view === "thread" && activeId ? (
            <ThreadView
              id={activeId}
              replyTimeNote={config.data?.replyTimeNote ?? null}
            />
          ) : (
            <>
              <div className="helpdesk-body" ref={bodyRef} role="log">
                {turns.map((turn, i) => (
                  <div key={turn.id} className="helpdesk-turn">
                    {turn.role === "bot" && (
                      <span className="helpdesk-who">
                        {STR.helpdesk.botName}
                      </span>
                    )}
                    <div
                      className={`helpdesk-msg from-${
                        turn.role === "member" ? "member" : "bot"
                      }`}
                    >
                      {turn.text && <p>{turn.text}</p>}
                      {turn.answer === "ACCESS" && (
                        <ClassesView
                          onAnswered={(had) => countView("ACCESS", had)}
                        />
                      )}
                      {turn.answer === "TECHNICAL" && (
                        <CoursesView
                          onAnswered={(had) => countView("TECHNICAL", had)}
                        />
                      )}
                      {turn.answer === "BILLING" && (
                        <PaymentsView
                          onAnswered={(had) => countView("BILLING", had)}
                        />
                      )}
                      {turn.answer === "LIVE_SESSION" && (
                        <LiveView
                          onAnswered={(had) => countView("LIVE_SESSION", had)}
                        />
                      )}
                      {turn.articles && <ArticlesAnswer />}
                      {turn.requests &&
                        (conversations.length > 0 ? (
                          <RequestList
                            items={conversations}
                            onOpen={openThread}
                          />
                        ) : (
                          <p>{STR.helpdesk.noRequests}</p>
                        ))}
                    </div>
                    {/* Chips belong to the newest bot turn only — older menus
                        are spent, as they are in any real bot transcript. */}
                    {turn.role === "bot" &&
                      i === lastIndex &&
                      turn.chips &&
                      turn.chips.length > 0 && (
                        <div className="helpdesk-next">
                          {turn.chips.map((c) => (
                            <button
                              key={c.key}
                              type="button"
                              className="helpdesk-chip"
                              onClick={() => onChip(c)}
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      )}
                  </div>
                ))}

                {typing && (
                  <div className="helpdesk-turn">
                    <span className="helpdesk-who">{STR.helpdesk.botName}</span>
                    <div className="helpdesk-msg from-bot">
                      <p className="helpdesk-typing">{STR.helpdesk.typing}</p>
                    </div>
                  </div>
                )}

                {pendingEscalation !== null && !atCap && (
                  <ComposeView
                    text={draft}
                    onText={setDraft}
                    files={files}
                    onFiles={setFiles}
                    breadcrumbs={trail}
                    escalationCategory={lastViewedRef.current}
                    replyTimeNote={config.data?.replyTimeNote ?? null}
                    onSent={(thread) => {
                      setPendingEscalation(null);
                      openThread(thread.id);
                    }}
                  />
                )}
              </div>

              {/* The ONE permanent, discoverable route to a person. Quiet, but
                  always present, so no individual answer has to offer it and no
                  member has to guess a magic word. */}
              <div className="helpdesk-strip">
                <button
                  type="button"
                  onClick={() => startEscalation("")}
                  disabled={atCap}
                >
                  {atCap
                    ? STR.helpdesk.tooManyOpen
                    : `${STR.helpdesk.stillStuck} ${STR.helpdesk.messageTeam}`}
                </button>
              </div>

              <form
                className="helpdesk-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  onSend();
                }}
              >
                <input
                  className="helpdesk-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={STR.helpdesk.composerPlaceholder}
                  aria-label={STR.helpdesk.composerPlaceholder}
                  maxLength={4000}
                />
                <button
                  type="submit"
                  className="helpdesk-btn is-primary"
                  disabled={input.trim().length === 0}
                >
                  {STR.helpdesk.send}
                </button>
              </form>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        className="helpdesk-fab"
        aria-label={STR.helpdesk.open}
        aria-expanded={open}
        onClick={() =>
          setOpen((v) => {
            // Closing ends the visit: reset the per-visit cardView de-dupe so
            // web and mobile contribute to HelpdeskDayStat on the same scale.
            if (v) viewedRef.current.clear();
            return !v;
          })
        }
      >
        {STR.helpdesk.open}
        {unread > 0 && <span className="helpdesk-badge">{unread}</span>}
      </button>
    </div>
  );
}

/** The member's existing tickets, rendered inside a bot bubble. */
function RequestList({
  items,
  onOpen,
}: {
  items: HelpdeskConversationSummaryDTO[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="helpdesk-reqlist">
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
    </div>
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

/** Reported once an answer settles: did it actually contain anything? */
type OnAnswered = (hadData: boolean) => void;

/** Fire `onAnswered` once, when the query settles. */
function useAnswered(
  onAnswered: OnAnswered | undefined,
  settled: boolean,
  hadData: boolean,
) {
  useEffect(() => {
    if (settled) onAnswered?.(hadData);
  }, [onAnswered, settled, hadData]);
}

// ---------------------------------------------------------------- classes

function ClassesView({ onAnswered }: { onAnswered?: OnAnswered }) {
  const classes = useMyClasses(true);
  const subs = useMySubStatuses(true);
  const owned = (classes.data ?? []).filter((c) => c.owned);
  useAnswered(onAnswered, !classes.isLoading, owned.length > 0);
  if (classes.isLoading || subs.isLoading) return <Loading />;

  const nameByLevel = new Map<string, string>(
    (classes.data ?? []).map((c) => [c.id, c.name]),
  );
  const pastDue = (subs.data ?? []).filter(
    (s: MySubscriptionDTO) => s.status === "PAST_DUE",
  );

  return (
    <div className="helpdesk-answer">
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
        <p className="helpdesk-empty">{STR.helpdesk.summaryNoClasses}</p>
      )}

      {owned.length > 0 && (
        <p className="helpdesk-lead">
          {STR.helpdesk.summaryClassesCount(owned.length)}
        </p>
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
    </div>
  );
}

// ---------------------------------------------------------------- courses

function CoursesView({ onAnswered }: { onAnswered?: OnAnswered }) {
  const dash = useMemberDashboard();
  const data = dash.data as MemberDashboardDTO | undefined;
  const owned = (data?.classes ?? []).filter((c) => c.owned);
  useAnswered(onAnswered, !dash.isLoading, owned.length > 0);
  if (dash.isLoading) return <Loading />;

  return (
    <div className="helpdesk-answer">
      {owned.length === 0 && (
        <p className="helpdesk-empty">{STR.helpdesk.summaryNoCourses}</p>
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
    </div>
  );
}

// ---------------------------------------------------------------- payments

function PaymentsView({ onAnswered }: { onAnswered?: OnAnswered }) {
  const subs = useMySubStatuses(true);
  const classes = useMyClasses(true);
  const show = useToast();
  const [busy, setBusy] = useState(false);
  const rows = subs.data ?? [];
  useAnswered(onAnswered, !subs.isLoading, rows.length > 0);
  if (subs.isLoading || classes.isLoading) return <Loading />;

  const nameByLevel = new Map<string, string>(
    (classes.data ?? []).map((c) => [c.id, c.name]),
  );

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
    <div className="helpdesk-answer">
      {rows.length === 0 && (
        <p className="helpdesk-empty">{STR.helpdesk.summaryNoPayments}</p>
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
    </div>
  );
}

// ---------------------------------------------------------------- live

function LiveView({ onAnswered }: { onAnswered?: OnAnswered }) {
  const live = useLiveCurrent(true);
  const sessions = live.data ?? [];
  useAnswered(onAnswered, !live.isLoading, sessions.length > 0);
  if (live.isLoading) return <Loading />;

  return (
    <div className="helpdesk-answer">
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
    </div>
  );
}

// ---------------------------------------------------------------- help / FAQ

function ArticlesAnswer() {
  const articles = useHelpdeskArticles(true);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="helpdesk-articles">
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
    </div>
  );
}

// ---------------------------------------------------------------- compose

function ComposeView({
  text,
  onText,
  files,
  onFiles,
  replyTimeNote,
  breadcrumbs,
  escalationCategory,
  onSent,
}: {
  /** Seeded with the message the router could not answer, so the member never
   *  retypes it — and CONTROLLED by the widget so switching topics mid-draft
   *  doesn't destroy it. */
  text: string;
  onText: (v: string) => void;
  files: File[];
  onFiles: (f: File[]) => void;
  replyTimeNote: string | null;
  /** Topics consulted before escalating — the admin queue shows these. */
  breadcrumbs: string[];
  /** Topic the member actually consulted, for the deflection stat. */
  escalationCategory: HelpdeskCategory | null;
  onSent: (thread: HelpdeskThreadDTO) => void;
}) {
  const queryClient = useQueryClient();
  const show = useToast();

  const mutation = useMutation({
    mutationFn: async (issue: string) => {
      // Category comes from what is actually SENT, not the original seed — the
      // member may have rewritten the message entirely in the box.
      const thread = await api.helpdeskStart({
        issue,
        category: categoryForText(issue),
        breadcrumbs,
      });
      const msgId = lastMemberMessageId(thread);
      if (files.length > 0 && msgId) {
        return api.helpdeskUploadAttachments(thread.id, msgId, files);
      }
      return thread;
    },
    onSuccess: (thread) => {
      // Attribute the escalation to the category the SERVER filed it under, so
      // the admin's per-topic deflection numerator and denominator agree.
      // Against the topic actually consulted when there was one, so the
      // numerator matches the cardView denominator.
      fireStat(escalationCategory ?? thread.category, "escalation");
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
    <div className="helpdesk-sendbox">
      <textarea
        className="helpdesk-textarea"
        placeholder={STR.helpdesk.issuePlaceholder}
        aria-label={STR.helpdesk.describeIssue}
        value={text}
        maxLength={4000}
        onChange={(e) => onText(e.target.value)}
      />
      {replyTimeNote && <p className="helpdesk-replynote">{replyTimeNote}</p>}
      <div className="helpdesk-actions">
        <FilePick files={files} onChange={onFiles} />
        <button
          type="button"
          className="helpdesk-btn is-primary"
          disabled={mutation.isPending || text.trim().length === 0}
          onClick={() => mutation.mutate(text.trim())}
        >
          {mutation.isPending ? STR.helpdesk.sending : STR.helpdesk.sendToTeam}
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
