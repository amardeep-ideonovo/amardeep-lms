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

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  STR,
  categoryForText,
  formatDateLong,
  formatMoney,
  routeHelpdeskText,
} from "@lms/types";
import type {
  ClassTileDTO,
  HelpdeskArticleDTO,
  HelpdeskCategory,
  HelpdeskConversationSummaryDTO,
  HelpdeskMessageDTO,
  HelpdeskThreadDTO,
  LiveSessionBarDTO,
  MySubscriptionDTO,
} from "@lms/types";
import { ApiError, api, getToken } from "@/lib/api";
import { HELPDESK_OPEN_EVENT } from "@/lib/helpdesk-bus";
import {
  qk,
  useHelpdeskArticles,
  useHelpdeskConfig,
  useHelpdeskConversations,
  useHelpdeskThread,
  useLiveCurrent,
  useMemberDashboard,
  useMe,
  useMyCertificates,
  useMyClasses,
  useMyInvoices,
  useMySubStatuses,
  useMySubscriptions,
} from "@/lib/queries";
import { useToast } from "@/components/Toast";

type View = "home" | "answer" | "article" | "compose" | "thread";

/** Topics the widget can answer inline from the member's own account. */
const ANSWERABLE: HelpdeskCategory[] = [
  "ACCESS",
  "TECHNICAL",
  "BILLING",
  "LIVE_SESSION",
  "CERTIFICATE",
  "ACCOUNT",
];

const TOPIC_LABEL: Partial<Record<HelpdeskCategory, string>> = {
  ACCESS: STR.helpdesk.menuClasses,
  TECHNICAL: STR.helpdesk.menuCourses,
  BILLING: STR.helpdesk.menuPayments,
  LIVE_SESSION: STR.helpdesk.menuLive,
  CERTIFICATE: STR.helpdesk.menuCertificates,
  ACCOUNT: STR.helpdesk.menuAccount,
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
  const [view, setView] = useState<View>("home");
  const [answer, setAnswer] = useState<HelpdeskCategory>("ACCESS");
  const [articleId, setArticleId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  /** Editable message to a human — kept here so leaving the compose view and
   *  coming back doesn't destroy what the member was typing. */
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  /** Topics consulted this visit, sent with a ticket as admin context. */
  const [trail, setTrail] = useState<string[]>([]);
  // Render nothing until mounted so the server (no localStorage token) and the
  // first client render agree — avoids a hydration mismatch on the FAB.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /** Latest openAnswer, for the contextual-entry event listener below — the
   *  handler is registered once but must call into current state setters. */
  const openAnswerRef = useRef<(c: HelpdeskCategory) => void>(() => {});
  useEffect(() => {
    const onOpen = (e: Event) => {
      if (!getToken()) return;
      const category = (e as CustomEvent<{ category?: HelpdeskCategory }>)
        .detail?.category;
      setOpen(true);
      if (category && ANSWERABLE.includes(category))
        openAnswerRef.current(category);
    };
    window.addEventListener(HELPDESK_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(HELPDESK_OPEN_EVENT, onOpen);
  }, []);

  /** Topics whose cardView has been counted this visit (reset on close). */
  const viewedRef = useRef<Set<HelpdeskCategory>>(new Set());
  /** Last topic actually opened — escalations are filed against it so the
   *  deflection numerator and denominator share one taxonomy. */
  const lastViewedRef = useRef<HelpdeskCategory | null>(null);

  const config = useHelpdeskConfig();
  const me = useMe();
  const signedIn = mounted && typeof window !== "undefined" && !!getToken();
  const live = useLiveCurrent(signedIn && open);
  // This academy's published FAQ — listed on home, and fed to the composer's
  // router so a typed question can open the matching article directly.
  const articlesQuery = useHelpdeskArticles(signedIn && open);
  const articles = articlesQuery.data ?? [];
  // ALL of the member's tickets, closed ones included — config.openConversations
  // excludes CLOSED, which used to leave closed history unreachable.
  const allConversations = useHelpdeskConversations(signedIn && open);

  // Never render for guests, before mount, or when the widget is turned off.
  if (!mounted || !signedIn) return null;
  if (config.data && !config.data.enabled) return null;

  const unread = config.data?.unread ?? 0;
  const openConversations = config.data?.openConversations ?? [];
  const conversations = allConversations.data ?? openConversations;
  const hasLive = (live.data?.length ?? 0) > 0;
  const topics = ANSWERABLE.filter((c) => c !== "LIVE_SESSION" || hasLive);
  // Mirror the server's cap (helpdesk.service.ts OPEN_STATUSES): RESOLVED is
  // reopenable and does NOT count toward it.
  const atCap =
    !!config.data &&
    openConversations.filter(
      (c) => c.status === "ESCALATED" || c.status === "WAITING_ON_MEMBER",
    ).length >= (config.data.maxOpenPerMember ?? 3);

  const greeting = (
    config.data?.greeting ?? STR.helpdesk.greetingFallback
  ).replace(
    /\s*\{firstName\}/g,
    me.data?.firstName ? ` ${me.data.firstName}` : "",
  );

  function openAnswer(category: HelpdeskCategory) {
    const label = TOPIC_LABEL[category] ?? STR.helpdesk.title;
    setTrail((t) => (t.includes(label) ? t : [...t, label]));
    lastViewedRef.current = category;
    setAnswer(category);
    setView("answer");
  }
  openAnswerRef.current = openAnswer;

  function openArticle(a: HelpdeskArticleDTO) {
    setTrail((t) => (t.includes(a.title) ? t : [...t, a.title]));
    // Articles carry a category, so a read-then-escalate files against the
    // same bucket its cardView counted under — one taxonomy, both directions.
    lastViewedRef.current = a.category;
    countView(a.category, true);
    setArticleId(a.id);
    setView("article");
  }

  /** Count a self-serve view — once per topic per visit, and only when the
   *  answer actually contained data. An empty card is not a deflection. */
  function countView(category: HelpdeskCategory, hadData: boolean) {
    if (!hadData || viewedRef.current.has(category)) return;
    viewedRef.current.add(category);
    fireStat(category, "cardView");
  }

  function startCompose(seed: string) {
    setDraft(seed);
    setFiles([]);
    setView("compose");
  }

  function onSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    const intent = routeHelpdeskText(text, topics, articles);
    // A question we can answer goes straight to that answer — faster than
    // filing a ticket, and it keeps the deflection honest.
    if (intent.kind === "topic") return openAnswer(intent.category);
    if (intent.kind === "article") {
      const a = articles.find((x) => x.id === intent.articleId);
      if (a) return openArticle(a);
    }
    // Anything else becomes a message to the team, pre-filled.
    return startCompose(text);
  }

  function openThread(id: string) {
    setActiveId(id);
    setView("thread");
  }

  const canBack = view !== "home";
  const activeArticle =
    view === "article" && articleId
      ? (articles.find((a) => a.id === articleId) ?? null)
      : null;

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
                onClick={() => setView("home")}
              >
                ‹ {STR.helpdesk.back}
              </button>
            ) : null}
            <h2>
              {view === "answer"
                ? (TOPIC_LABEL[answer] ?? STR.helpdesk.title)
                : view === "article"
                  ? (activeArticle?.title ?? STR.helpdesk.title)
                  : STR.helpdesk.title}
            </h2>
            <button
              type="button"
              className="helpdesk-iconbtn"
              aria-label={STR.helpdesk.close}
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>

          {/* ---------------- home: a launchpad, not a transcript ------------ */}
          {view === "home" && (
            <div className="helpdesk-body">
              <p className="helpdesk-greeting">{greeting}</p>

              <p className="helpdesk-section">{STR.helpdesk.findAnswer}</p>
              {topics.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="helpdesk-menu-item"
                  onClick={() => openAnswer(c)}
                >
                  <span>{TOPIC_LABEL[c]}</span>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
              <button
                type="button"
                className="helpdesk-menu-item"
                onClick={() => {
                  setAnswer("OTHER");
                  setView("answer");
                }}
              >
                <span>{STR.helpdesk.menuSomethingElse}</span>
                <span aria-hidden="true">›</span>
              </button>

              {articles.length > 0 && (
                <>
                  <p className="helpdesk-section">
                    {STR.helpdesk.articlesHeading}
                  </p>
                  {articles.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="helpdesk-menu-item"
                      onClick={() => openArticle(a)}
                    >
                      <span>{a.title}</span>
                      <span aria-hidden="true">›</span>
                    </button>
                  ))}
                </>
              )}

              {conversations.length > 0 && (
                <>
                  <p className="helpdesk-section">
                    {STR.helpdesk.yourRequests}
                  </p>
                  <RequestList items={conversations} onOpen={openThread} />
                </>
              )}
            </div>
          )}

          {/* ---------------- answer: one topic, then back ------------------- */}
          {view === "answer" && (
            <div className="helpdesk-body">
              {/* Account answers live in ONE elevated card under a "From your
                  account" eyebrow — live personal data must not look like the
                  menu rows that led to it. The FAQ (OTHER) is academy content,
                  not account data, so it stays outside the card. */}
              {answer !== "OTHER" ? (
                <div className="helpdesk-answer-card">
                  <span className="helpdesk-eyebrow">
                    {STR.helpdesk.fromYourAccount}
                  </span>
                  {answer === "ACCESS" && (
                    <ClassesView
                      onAnswered={(had) => countView("ACCESS", had)}
                    />
                  )}
                  {answer === "TECHNICAL" && (
                    <CoursesView
                      onAnswered={(had) => countView("TECHNICAL", had)}
                    />
                  )}
                  {answer === "BILLING" && (
                    <PaymentsView
                      onAnswered={(had) => countView("BILLING", had)}
                    />
                  )}
                  {answer === "LIVE_SESSION" && (
                    <LiveView
                      onAnswered={(had) => countView("LIVE_SESSION", had)}
                    />
                  )}
                  {answer === "CERTIFICATE" && (
                    <CertificatesView
                      onAnswered={(had) => countView("CERTIFICATE", had)}
                    />
                  )}
                  {answer === "ACCOUNT" && (
                    <AccountView
                      onAnswered={(had) => countView("ACCOUNT", had)}
                    />
                  )}
                </div>
              ) : (
                <ArticlesAnswer />
              )}

              {answer !== "OTHER" && (
                <>
                  <p className="helpdesk-section">
                    {STR.helpdesk.relatedHeading}
                  </p>
                  {/* Chips, not menu rows: wayfinding reads as secondary to the
                      answer above it. */}
                  <div className="helpdesk-next">
                    {topics
                      .filter((c) => c !== answer)
                      .map((c) => (
                        <button
                          key={c}
                          type="button"
                          className="helpdesk-chip"
                          onClick={() => openAnswer(c)}
                        >
                          {TOPIC_LABEL[c]}
                        </button>
                      ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ---------------- article: one FAQ entry, then back -------------- */}
          {view === "article" && activeArticle && (
            <div className="helpdesk-body">
              <div className="helpdesk-answer-card">
                <span className="helpdesk-eyebrow">
                  {STR.helpdesk.helpArticleEyebrow}
                </span>
                <div className="helpdesk-article-body">
                  {activeArticle.body
                    .split(/\n{2,}/)
                    .filter((p) => p.trim())
                    .map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                </div>
              </div>

              {articles.length > 1 && (
                <>
                  <p className="helpdesk-section">
                    {STR.helpdesk.relatedHeading}
                  </p>
                  <div className="helpdesk-next">
                    {articles
                      .filter((a) => a.id !== activeArticle.id)
                      .slice(0, 4)
                      .map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className="helpdesk-chip"
                          onClick={() => openArticle(a)}
                        >
                          {a.title}
                        </button>
                      ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ---------------- compose / thread ------------------------------- */}
          {view === "compose" && (
            <div className="helpdesk-body">
              <ComposeView
                text={draft}
                onText={setDraft}
                files={files}
                onFiles={setFiles}
                replyTimeNote={config.data?.replyTimeNote ?? null}
                breadcrumbs={trail}
                escalationCategory={lastViewedRef.current}
                atCap={atCap}
                onSent={(thread) => {
                  setDraft("");
                  setFiles([]);
                  openThread(thread.id);
                }}
              />
            </div>
          )}
          {view === "thread" && activeId && (
            <ThreadView
              id={activeId}
              replyTimeNote={config.data?.replyTimeNote ?? null}
            />
          )}

          {/* The permanent, quiet route to a person — on home and on every
              answer, so no card has to offer it and nobody has to guess. */}
          {(view === "home" || view === "answer" || view === "article") && (
            <div className="helpdesk-strip">
              <button type="button" onClick={() => startCompose("")}>
                {STR.helpdesk.stillStuck} {STR.helpdesk.messageTeam}
              </button>
            </div>
          )}

          {/* One box: a recognised question opens that answer, anything else
              becomes a message to the team pre-filled with what was typed. */}
          {(view === "home" || view === "answer" || view === "article") && (
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
            if (v) {
              // Closing ends the visit: reset the per-visit cardView de-dupe so
              // web and mobile feed HelpdeskDayStat on the same scale.
              viewedRef.current.clear();
            } else {
              setView("home");
            }
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

/** The member's tickets, newest activity first. */
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
/** Once-per-resolution CSAT — deliberately the ONLY feedback ask in the whole
 *  helpdesk. Renders the prompt only while the request is resolved and
 *  unrated; after a past-session rating it renders nothing (no eternal
 *  "thanks" banner). A 👎 opens one optional note box. */
function CsatCard({
  id,
  satisfactionUp,
  onUpdated,
}: {
  id: string;
  satisfactionUp: boolean | null;
  onUpdated: (t: HelpdeskThreadDTO) => void;
}) {
  const show = useToast();
  const [ratedNow, setRatedNow] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [noteSent, setNoteSent] = useState(false);

  const rate = useMutation({
    scope: { id: `helpdesk:${id}` },
    mutationFn: (input: { up: boolean; note?: string }) =>
      api.helpdeskRate(id, input),
    onSuccess: (updated, input) => {
      onUpdated(updated);
      setRatedNow(input.up);
      if (input.note !== undefined) setNoteSent(true);
    },
    onError: () => show(STR.errors.generic),
  });

  if (satisfactionUp !== null && ratedNow === null) return null;

  if (ratedNow !== null) {
    return (
      <div className="helpdesk-csat">
        <p className="helpdesk-csat-thanks">{STR.helpdesk.csatThanks}</p>
        {ratedNow === false && !noteSent && (
          <div className="helpdesk-csat-note">
            <input
              type="text"
              value={note}
              maxLength={500}
              placeholder={STR.helpdesk.csatNotePlaceholder}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              type="button"
              className="helpdesk-btn"
              disabled={rate.isPending || note.trim().length === 0}
              onClick={() => rate.mutate({ up: false, note: note.trim() })}
            >
              {STR.helpdesk.csatSendNote}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="helpdesk-csat">
      <p className="helpdesk-csat-prompt">{STR.helpdesk.csatPrompt}</p>
      <div className="helpdesk-csat-actions">
        <button
          type="button"
          className="helpdesk-btn"
          disabled={rate.isPending}
          onClick={() => rate.mutate({ up: true })}
        >
          {STR.helpdesk.csatYes}
        </button>
        <button
          type="button"
          className="helpdesk-btn"
          disabled={rate.isPending}
          onClick={() => rate.mutate({ up: false })}
        >
          {STR.helpdesk.csatNo}
        </button>
      </div>
    </div>
  );
}

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

/** Progress as a BAR, not a fraction in prose — the state reads before the
 *  numbers, which is what makes an answer look like data instead of a menu.
 *  Track uses --surface-2 (the tokens file's own "track bars" tone); the fill
 *  flips to the success tone when complete. */
function ProgressRow({
  label,
  completed,
  total,
  meta,
  href,
}: {
  label: string;
  completed: number;
  total: number;
  meta?: string;
  href?: string;
}) {
  const pct =
    total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const done = total > 0 && completed >= total;
  return (
    <div className="helpdesk-progress">
      <div className="helpdesk-progress-head">
        <span className="helpdesk-progress-label">
          {href ? <a href={href}>{label}</a> : label}
        </span>
        <span className={`helpdesk-progress-meta${done ? " is-done" : ""}`}>
          {done ? "✓ " : ""}
          {completed}/{total}
        </span>
      </div>
      <div
        className="helpdesk-track"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={STR.helpdesk.progressSpoken(
          Math.min(completed, total),
          total,
        )}
        aria-label={label}
      >
        <div
          className={`helpdesk-fill${done ? " is-done" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {meta ? <p className="helpdesk-progress-sub">{meta}</p> : null}
    </div>
  );
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
        <ProgressRow
          key={c.id}
          label={c.name}
          completed={c.progress?.completed ?? 0}
          total={c.progress?.total ?? 0}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- courses

function CoursesView({ onAnswered }: { onAnswered?: OnAnswered }) {
  const dash = useMemberDashboard();
  // No cast: fetchMemberDashboard returns extras as a Map, and the old
  // `as MemberDashboardDTO` cast laundered it into a Record — so `extras[id]`
  // compiled happily and was ALWAYS undefined at runtime. Every class rendered
  // without lesson counts or the up-next line, silently.
  const data = dash.data;
  const owned = (data?.classes ?? []).filter((c) => c.owned);
  useAnswered(onAnswered, !dash.isLoading, owned.length > 0);
  if (dash.isLoading) return <Loading />;

  return (
    <div className="helpdesk-answer">
      {owned.length === 0 && (
        <p className="helpdesk-empty">{STR.helpdesk.summaryNoCourses}</p>
      )}
      {owned.map((c) => {
        const extra = data?.extras.get(c.id);
        return (
          <ProgressRow
            key={c.id}
            label={c.name}
            href={c.slug ? `/classes/${c.slug}` : undefined}
            completed={extra ? extra.lessonTotal - extra.lessonsLeft : 0}
            total={extra?.lessonTotal ?? 0}
            meta={
              extra?.next ? `Up next: ${extra.next.lesson.title}` : undefined
            }
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- payments

function PaymentsView({ onAnswered }: { onAnswered?: OnAnswered }) {
  const subs = useMySubStatuses(true);
  const classes = useMyClasses(true);
  // The two facts a member actually comes here for: the last charge and the
  // next one. Both endpoints were already consumed elsewhere; the widget just
  // never rendered them.
  const invoices = useMyInvoices();
  const details = useMySubscriptions();
  const show = useToast();
  const [busy, setBusy] = useState(false);
  const rows = subs.data ?? [];
  useAnswered(
    onAnswered,
    !subs.isLoading && !invoices.isPending,
    rows.length > 0 || (invoices.data ?? []).length > 0,
  );
  if (subs.isLoading || classes.isLoading || invoices.isPending)
    return <Loading />;

  const lastPaid = (invoices.data ?? []).find((i) => i.status === "paid");
  const nextBilling = (details.data ?? []).find(
    (d) => d.status?.toLowerCase() === "active" && d.currentPeriodEnd,
  )?.currentPeriodEnd;

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
      {lastPaid && (
        <div className="helpdesk-hero">
          <span className="helpdesk-amount">
            {formatMoney(lastPaid.amountPaid, lastPaid.currency)}
          </span>
          <span className="helpdesk-amount-meta">
            {lastPaid.description ?? STR.helpdesk.membershipItem} ·{" "}
            {formatDateLong(lastPaid.created)}
          </span>
        </div>
      )}
      {nextBilling && (
        <p className="helpdesk-fact">
          {STR.helpdesk.summaryNextBilling(formatDateLong(nextBilling))}
        </p>
      )}
      {rows.length === 0 && !lastPaid && (
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

// ---------------------------------------------------------------- certificates

function CertificatesView({ onAnswered }: { onAnswered?: OnAnswered }) {
  const certsQ = useMyCertificates();
  const certs = certsQ.data ?? [];
  useAnswered(onAnswered, !certsQ.isLoading, certs.length > 0);
  if (certsQ.isLoading) return <Loading />;
  if (certsQ.isError)
    return <p className="helpdesk-empty">{STR.errors.generic}</p>;
  if (certs.length === 0)
    return <p className="helpdesk-empty">{STR.helpdesk.summaryNoCerts}</p>;

  return (
    <div className="helpdesk-answer">
      <p className="helpdesk-lead">
        {STR.helpdesk.summaryCertsCount(certs.length)}
      </p>
      {certs.map((c) => (
        <div key={c.id} className="helpdesk-fact-row">
          <span className="helpdesk-fact-key">{c.className}</span>
          <span className="helpdesk-fact-val">
            {formatDateLong(c.issuedAt)}
          </span>
        </div>
      ))}
      <div className="helpdesk-actions">
        <a className="helpdesk-btn" href="/certificates">
          {STR.helpdesk.viewCertificates}
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- account

function AccountView({ onAnswered }: { onAnswered?: OnAnswered }) {
  const me = useMe();
  useAnswered(onAnswered, !me.isLoading, !!me.data);
  if (me.isLoading) return <Loading />;
  if (!me.data) return <p className="helpdesk-empty">{STR.errors.generic}</p>;

  const name = [me.data.firstName, me.data.lastName].filter(Boolean).join(" ");
  return (
    <div className="helpdesk-answer">
      {name && <p className="helpdesk-lead">{name}</p>}
      <div className="helpdesk-fact-row">
        <span className="helpdesk-fact-key">{STR.labels.email}</span>
        <span className="helpdesk-fact-val">{me.data.email}</span>
      </div>
      <div className="helpdesk-fact-row">
        <span className="helpdesk-fact-key">{STR.labels.username}</span>
        <span className="helpdesk-fact-val">{me.data.username}</span>
      </div>
      <p className="helpdesk-hint">{STR.helpdesk.accountManageHint}</p>
      <div className="helpdesk-actions">
        <a className="helpdesk-btn" href="/account">
          {STR.helpdesk.manageAccount}
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- help / FAQ

/** The "Something else" catch-all. Articles used to live here as accordions;
 *  they now sit on home as rows and route from the composer, so this keeps
 *  only the account-settings pointer. */
function ArticlesAnswer() {
  return (
    <div className="helpdesk-articles">
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
  atCap,
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
  /** Server-mirrored open-ticket cap — say so rather than failing on send. */
  atCap: boolean;
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

  // After the hooks, never before them — an early return above would change
  // hook order between renders.
  if (atCap)
    return <p className="helpdesk-empty">{STR.helpdesk.tooManyOpen}</p>;

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

  const resolve = useMutation({
    scope: { id: `helpdesk:${id}` },
    mutationFn: () => api.helpdeskResolve(id),
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.helpdeskThread(id), updated);
      void queryClient.invalidateQueries({ queryKey: qk.helpdeskConfig });
      void queryClient.invalidateQueries({
        queryKey: qk.helpdeskConversations,
      });
    },
    onError: () => show(STR.errors.generic),
  });

  const data = thread.data;
  const closed = data?.status === "CLOSED";
  const open =
    data?.status === "ESCALATED" || data?.status === "WAITING_ON_MEMBER";
  const resolved = data?.status === "RESOLVED" || closed;

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

        {/* The member's own way out: one quiet, reversible tap — replying to
            a resolved request reopens it, so no confirmation is needed. */}
        {open && (
          <button
            type="button"
            className="helpdesk-resolve"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate()}
          >
            ✓ {STR.helpdesk.markResolved}
          </button>
        )}

        {resolved && data && (
          <CsatCard
            id={id}
            satisfactionUp={data.satisfactionUp}
            onUpdated={(updated) =>
              queryClient.setQueryData(qk.helpdeskThread(id), updated)
            }
          />
        )}
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
