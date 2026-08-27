// Member support — a real conversation, not a menu.
//
// The guided phase is an append-only TRANSCRIPT: the bot greets, the member's
// tap or typed message is echoed as their own bubble, and the answer arrives as
// a bot bubble carrying that topic's account data. Quick-reply chips sit under
// the LAST bot bubble and are consumed when used — the behaviour that turns a
// button menu into a chat (Ada and Zendesk both do exactly this).
//
// No language model: every answer is the member's own data, and the composer is
// backed by a deterministic keyword router (@lms/types helpdesk-router). When
// nothing matches we say so and offer to pass the message to a human.
//
// An answer never asks the member to rate it. JS-only; ships via EAS OTA.
import { useEffect, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { STR, categoryForText, routeHelpdeskText } from "@lms/types";
import type {
  HelpdeskCategory,
  HelpdeskConversationSummaryDTO,
  HelpdeskStatus,
  HelpdeskThreadDTO,
} from "@lms/types";

import { api, ApiError } from "../api";
import { ANSWERABLE } from "../helpdesk-answerable";
import {
  qk,
  useHelpdeskConfig,
  useHelpdeskConversations,
  useMe,
} from "../queries";
import {
  ClassesSummary,
  CoursesSummary,
  PaymentsSummary,
} from "./helpdesk-summaries";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { Press } from "../components/Press";
import { EmptyState, ErrorState } from "../components/Screen";
import { Skeleton } from "../components/Skeleton";
import { fmtDate } from "../format";
import type { ScreenProps } from "../navigation";
import { contentColumn } from "../responsive";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

type PickedImage = { uri: string; mimeType?: string };

const MAX_FILES = 3;
/** How long the bot "thinks" before its bubble lands. Pacing is a designed
 *  feature of every mainstream support chat — an instant answer reads as a
 *  settings panel repainting, not as a reply. */
const TYPING_MS = 450;

const TOPIC_LABEL: Partial<Record<HelpdeskCategory, string>> = {
  ACCESS: STR.helpdesk.menuClasses,
  TECHNICAL: STR.helpdesk.menuCourses,
  BILLING: STR.helpdesk.menuPayments,
};

type ChipDef = {
  key: string;
  label: string;
  category?: HelpdeskCategory;
  action?: "requests";
};

type Turn = {
  id: string;
  role: "bot" | "member";
  /** Bubble text. */
  text?: string;
  /** Render this topic's account-data card inside the bubble. */
  answer?: HelpdeskCategory;
  /** Render the member's existing tickets inside the bubble. */
  requests?: boolean;
  /** Quick replies — only ever shown under the LAST turn. */
  chips?: ChipDef[];
};

const topicChips = (exclude?: HelpdeskCategory): ChipDef[] => [
  ...ANSWERABLE.filter((c) => c !== exclude).map((c) => ({
    key: c,
    label: TOPIC_LABEL[c] ?? c,
    category: c,
  })),
  {
    key: "requests",
    label: STR.helpdesk.myRequests,
    action: "requests" as const,
  },
];

function statusChip(status: HelpdeskStatus): {
  label: string;
  tone: "default" | "success" | "warning";
} {
  if (status === "WAITING_ON_MEMBER")
    return { label: STR.helpdesk.statusWaiting, tone: "warning" };
  if (status === "RESOLVED")
    return { label: STR.helpdesk.statusResolved, tone: "success" };
  if (status === "CLOSED")
    return { label: STR.helpdesk.statusClosed, tone: "default" };
  return { label: STR.helpdesk.statusOpen, tone: "warning" };
}

function lastMemberMessageId(thread: HelpdeskThreadDTO): string | null {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    if (thread.messages[i].authorKind === "MEMBER")
      return thread.messages[i].id;
  }
  return null;
}

async function pickAttachments(): Promise<PickedImage[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: MAX_FILES,
    quality: 0.7,
  });
  if (result.canceled || !result.assets?.length) return [];
  return result.assets
    .slice(0, MAX_FILES)
    .map((a) => ({ uri: a.uri, mimeType: a.mimeType }));
}

export function HelpdeskScreen({ navigation }: ScreenProps<"HelpdeskHome">) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const me = useMe();

  const configQuery = useHelpdeskConfig();
  const config = configQuery.data ?? null;
  const convQuery = useHelpdeskConversations(config?.enabled === true);
  const conversations: HelpdeskConversationSummaryDTO[] =
    convQuery.data ?? config?.openConversations ?? [];

  const [turns, setTurns] = useState<Turn[]>([]);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Text the member will send to a human if they confirm. */
  const [pendingEscalation, setPendingEscalation] = useState<string | null>(
    null,
  );
  /** Editable body of the escalation — seeded from what the member typed, but
   *  theirs to rewrite before it becomes a ticket. */
  const [draft, setDraft] = useState("");

  const seq = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  // Topics already counted this visit — deflection is 1 - escalations/cardViews,
  // so the denominator must mean "distinct topics consulted", not taps.
  const viewedRef = useRef<Set<HelpdeskCategory>>(new Set());
  /** Topic labels consulted this visit — sent with a ticket so the admin sees
   *  what the member already looked at. Mobile used to send none at all. */
  const [trail, setTrail] = useState<string[]>([]);
  /** The last topic the member actually OPENED. Escalations are filed against
   *  it for stats so the deflection numerator and denominator share a
   *  taxonomy — otherwise the topic that failed to deflect reads as 100%. */
  const lastViewedRef = useRef<HelpdeskCategory | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  /** The bot turn currently waiting on its typing delay (at most one). */
  const pendingReply = useRef<{
    turn: Omit<Turn, "id" | "role">;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  // Mirror the server's cap (helpdesk.service.ts OPEN_STATUSES): RESOLVED is
  // reopenable and does NOT count. openConversations is "not CLOSED".
  const atCap =
    !!config &&
    config.openConversations.filter(
      (c) => c.status === "ESCALATED" || c.status === "WAITING_ON_MEMBER",
    ).length >= config.maxOpenPerMember;
  const enabled = config?.enabled === true && config.requiresSignIn !== true;
  const hasOpenRequest = (config?.openConversations.length ?? 0) > 0;
  const firstName = me.data?.firstName;
  const greetingText = config?.greeting;

  // Open with the greeting + the topic menu as quick replies.
  useEffect(() => {
    // Wait for /auth/me so the opening line keeps the member's first name.
    if (!enabled || me.isPending) return;
    setTurns((prev) => {
      if (prev.length > 0) return prev;
      const greeting = (greetingText || STR.helpdesk.greetingFallback).replace(
        /\s*\{firstName\}/g,
        firstName ? ` ${firstName}` : "",
      );
      const opening: Turn[] = [
        { id: `t${++seq.current}`, role: "bot", text: greeting },
      ];
      // If a reply is waiting (that's what the unread badge pointed at), or a
      // request is still open, put it on screen instead of making them hunt.
      const waiting = (config?.unread ?? 0) > 0 || hasOpenRequest;
      if (waiting)
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
    greetingText,
    firstName,
    me.isPending,
    hasOpenRequest,
    config?.unread,
  ]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  /** Abandon any pending escalation, including its draft and attachments —
   *  a screenshot picked for one message must never be uploaded onto another. */
  function clearEscalation() {
    setPendingEscalation(null);
    setDraft("");
    setImages([]);
    setError(null);
  }

  /** Count a self-serve view — once per topic per visit, and only when the
   *  answer actually contained data. */
  function countView(category: HelpdeskCategory, hadData: boolean) {
    if (!hadData || viewedRef.current.has(category)) return;
    viewedRef.current.add(category);
    api.helpdeskStatEvent(category, "cardView");
  }

  function push(turn: Omit<Turn, "id">) {
    setTurns((t) => [...t, { ...turn, id: `t${++seq.current}` }]);
  }

  /** Land any bot turn that is still waiting on its typing delay, so a fast
   *  second question can never overtake the answer to the first. */
  function flushPending() {
    if (!pendingReply.current) return;
    clearTimeout(pendingReply.current.timer);
    push({ ...pendingReply.current.turn, role: "bot" });
    pendingReply.current = null;
  }

  /** The bot replies after a beat, so an answer reads as a reply. */
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
    // anything to say — see onAnswered below.
    botReply({ answer: category, chips: topicChips(category) });
  }

  function showRequests(echo: string) {
    flushPending();
    push({ role: "member", text: echo });
    clearEscalation();
    // Always render the list turn and let it read the LIVE list — freezing an
    // emptiness check here told members with only closed tickets, or whose
    // list had not loaded yet, that they had never contacted support.
    botReply({ requests: true, chips: topicChips() });
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
    // Fresh draft + fresh attachments: a picked image must never ride along
    // with a LATER, unrelated escalation.
    setDraft(text);
    setImages([]);
    setPendingEscalation(text);
    // Keep the menu alive — an unanswered message must not strand the member.
    botReply({
      text: text ? STR.helpdesk.cantAnswer : STR.helpdesk.describeIssue,
      chips: topicChips(),
    });
  }

  function onChip(c: ChipDef) {
    if (c.action === "requests") return showRequests(c.label);
    if (c.category) return answerTopic(c.category, c.label);
  }

  function onSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setError(null);
    const intent = routeHelpdeskText(text, ANSWERABLE);
    if (intent.kind === "topic") return answerTopic(intent.category, text);
    if (intent.kind === "requests") return showRequests(text);
    if (intent.kind === "human") {
      // They asked for a person — don't claim we couldn't understand.
      push({ role: "member", text });
      return startEscalation(text);
    }
    return startEscalation(text, true);
  }

  const startMutation = useMutation({
    mutationFn: async () => {
      const issue = draft.trim();
      const thread = await api.helpdeskStart({
        issue,
        category: categoryForText(issue),
        breadcrumbs: trail,
      });
      let latest = thread;
      const msgId = lastMemberMessageId(thread);
      if (images.length > 0 && msgId) {
        for (const img of images) {
          latest = await api.uploadHelpdeskAttachment(
            thread.id,
            msgId,
            img.uri,
            img.mimeType,
          );
        }
      }
      return latest;
    },
    onSuccess: (thread) => {
      // Attribute to the topic actually consulted when there was one; the
      // TICKET still carries the text-derived category for admin triage.
      api.helpdeskStatEvent(
        lastViewedRef.current ?? thread.category,
        "escalation",
      );
      queryClient.setQueryData(qk.helpdeskThread(thread.id), thread);
      void queryClient.invalidateQueries({ queryKey: qk.helpdeskConfig });
      void queryClient.invalidateQueries({
        queryKey: qk.helpdeskConversations,
      });
      setImages([]);
      setDraft("");
      setPendingEscalation(null);
      navigation.navigate("HelpdeskThread", {
        conversationId: thread.id,
        subject: thread.subject,
        replyTimeNote: thread.replyTimeNote,
      });
    },
    onError: (e) => {
      setError(
        e instanceof ApiError && e.code === "HELPDESK_TOO_MANY_OPEN"
          ? STR.helpdesk.tooManyOpen
          : e instanceof ApiError && e.code === "HELPDESK_DISABLED"
            ? STR.helpdesk.disabled
            : e instanceof Error
              ? e.message
              : STR.errors.generic,
      );
    },
  });

  if (configQuery.isError && config === null && !configQuery.isFetching) {
    // A 404 means this instance's API predates the helpdesk (the fleet can run
    // mixed image tags). Degrade to a friendly notice, not a retry loop.
    if (
      configQuery.error instanceof ApiError &&
      configQuery.error.status === 404
    )
      return <EmptyState message={STR.helpdesk.disabled} />;
    return (
      <ErrorState
        message={
          configQuery.error instanceof Error
            ? configQuery.error.message
            : STR.errors.generic
        }
        onRetry={() => void configQuery.refetch()}
      />
    );
  }
  if (config === null)
    return (
      <View style={styles.skeletons}>
        <Skeleton height={72} radius={14} style={styles.skelRow} />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={56} radius={12} style={styles.skelRow} />
        ))}
      </View>
    );
  if (!config.enabled) return <EmptyState message={STR.helpdesk.disabled} />;
  if (config.requiresSignIn)
    return <EmptyState message={STR.helpdesk.signInPrompt} />;

  async function onPickImages() {
    try {
      const picked = await pickAttachments();
      if (picked.length) setImages(picked);
    } catch {
      /* permission denied / cancelled */
    }
  }

  const lastIndex = turns.length - 1;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() =>
          scrollRef.current?.scrollToEnd({ animated: true })
        }
      >
        {turns.map((turn, i) => {
          const mine = turn.role === "member";
          const isLast = i === lastIndex;
          return (
            <View key={turn.id} style={styles.turn}>
              {!mine && <Text style={styles.who}>{STR.helpdesk.botName}</Text>}
              <View
                style={[
                  styles.bubble,
                  mine ? styles.bubbleMine : styles.bubbleThem,
                ]}
              >
                {turn.text ? (
                  <Text style={mine ? styles.textMine : styles.text}>
                    {turn.text}
                  </Text>
                ) : null}
                {turn.answer === "ACCESS" && (
                  <ClassesSummary
                    onAnswered={(had) => countView("ACCESS", had)}
                  />
                )}
                {turn.answer === "TECHNICAL" && (
                  <CoursesSummary
                    onAnswered={(had) => countView("TECHNICAL", had)}
                  />
                )}
                {turn.answer === "BILLING" && (
                  <PaymentsSummary
                    navigation={navigation}
                    onAnswered={(had) => countView("BILLING", had)}
                  />
                )}
                {turn.requests && conversations.length === 0 && (
                  <Text style={styles.text}>{STR.helpdesk.noRequests}</Text>
                )}
                {turn.requests && conversations.length > 0 && (
                  <View style={styles.reqList}>
                    {conversations.map((c) => {
                      const chip = statusChip(c.status);
                      return (
                        <Press
                          key={c.id}
                          style={styles.reqRow}
                          accessibilityRole="button"
                          onPress={() =>
                            navigation.navigate("HelpdeskThread", {
                              conversationId: c.id,
                              subject: c.subject,
                              replyTimeNote: null,
                            })
                          }
                        >
                          <View style={styles.reqText}>
                            <Text style={styles.reqName} numberOfLines={1}>
                              {c.subject}
                            </Text>
                            <Text style={styles.reqDate}>
                              {fmtDate(c.lastMessageAt)}
                            </Text>
                          </View>
                          <Chip label={chip.label} tone={chip.tone} />
                        </Press>
                      );
                    })}
                  </View>
                )}
              </View>
              {/* Chips belong to the newest bot turn only — older menus are
                  spent, exactly as they are in Ada/Zendesk transcripts. */}
              {!mine && isLast && turn.chips && turn.chips.length > 0 && (
                <View style={styles.chipRow}>
                  {turn.chips.map((c) => (
                    <Press
                      key={c.key}
                      style={styles.chip}
                      accessibilityRole="button"
                      onPress={() => onChip(c)}
                    >
                      <Text style={styles.chipText}>{c.label}</Text>
                    </Press>
                  ))}
                </View>
              )}
            </View>
          );
        })}

        {typing && (
          <View style={styles.turn}>
            <Text style={styles.who}>{STR.helpdesk.botName}</Text>
            <View style={[styles.bubble, styles.bubbleThem]}>
              <Text style={styles.typing}>{STR.helpdesk.typing}</Text>
            </View>
          </View>
        )}

        {/* Confirm-to-send: the composer's escape hatch when nothing matched. */}
        {pendingEscalation !== null && !atCap && (
          <View style={styles.sendBox}>
            <TextInput
              style={styles.draft}
              value={draft}
              onChangeText={setDraft}
              placeholder={STR.helpdesk.issuePlaceholder}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={STR.helpdesk.describeIssue}
              multiline
              maxLength={4000}
            />
            {images.length > 0 && (
              <View style={styles.thumbRow}>
                {images.map((img) => (
                  <Image
                    key={img.uri}
                    source={{ uri: img.uri }}
                    style={styles.thumb}
                  />
                ))}
              </View>
            )}
            {config.replyTimeNote ? (
              <Text style={styles.replyNote}>{config.replyTimeNote}</Text>
            ) : null}
            {error && <Text style={styles.errorText}>{error}</Text>}
            <View style={styles.sendActions}>
              <Button
                label={
                  images.length
                    ? `${images.length}/${MAX_FILES}`
                    : STR.helpdesk.attachImage
                }
                variant="secondary"
                onPress={() => void onPickImages()}
              />
              <Button
                label={
                  startMutation.isPending
                    ? STR.helpdesk.sending
                    : STR.helpdesk.sendToTeam
                }
                onPress={() => startMutation.mutate()}
                disabled={startMutation.isPending || draft.trim().length === 0}
              />
            </View>
          </View>
        )}
      </ScrollView>

      {/* The ONE permanent, discoverable route to a person — so no answer has
          to offer it and no member has to guess a magic word. */}
      <Press
        style={styles.strip}
        accessibilityRole="button"
        onPress={() => startEscalation("")}
      >
        <Text style={styles.stripText}>
          {atCap
            ? STR.helpdesk.tooManyOpen
            : `${STR.helpdesk.stillStuck} ${STR.helpdesk.messageTeam}`}
        </Text>
      </Press>

      <View style={[styles.composer, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          style={styles.input}
          placeholder={STR.helpdesk.composerPlaceholder}
          placeholderTextColor={colors.textMuted}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={onSend}
          returnKeyType="send"
          maxLength={4000}
          accessibilityLabel={STR.helpdesk.composerPlaceholder}
        />
        <Press
          style={styles.send}
          accessibilityRole="button"
          accessibilityLabel={STR.helpdesk.send}
          onPress={onSend}
        >
          <Text style={styles.sendText}>{STR.helpdesk.send}</Text>
        </Press>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles({ colors, fonts }: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    list: { flex: 1 },
    listContent: {
      ...contentColumn,
      paddingVertical: spacing.md,
      gap: spacing.sm,
    },
    skeletons: {
      flex: 1,
      backgroundColor: colors.bg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    skelRow: { marginBottom: spacing.xs },

    turn: { gap: 2 },
    who: {
      color: colors.textMuted,
      fontFamily: fonts.semibold,
      fontSize: 11,
      marginLeft: 4,
    },
    bubble: {
      maxWidth: "92%",
      borderRadius: 14,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
    },
    bubbleMine: { alignSelf: "flex-end", backgroundColor: colors.primary },
    bubbleThem: {
      alignSelf: "flex-start",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
    },
    text: {
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 21,
    },
    textMine: {
      color: colors.onPrimary,
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 21,
    },
    typing: {
      color: colors.textMuted,
      fontFamily: fonts.semibold,
      fontSize: 18,
      lineHeight: 21,
    },

    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
      marginTop: spacing.xs,
    },
    chip: {
      borderWidth: 1,
      borderColor: colors.primary,
      borderRadius: 999,
      paddingHorizontal: spacing.sm,
      paddingVertical: 7,
    },
    chipText: {
      color: colors.primary,
      fontFamily: fonts.semibold,
      fontSize: 12.5,
    },

    reqList: { gap: spacing.xs, marginTop: spacing.xs },
    reqRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.borderSoft,
      paddingTop: spacing.xs,
    },
    reqText: { flexShrink: 1 },
    reqName: {
      color: colors.text,
      fontFamily: fonts.semibold,
      fontSize: 14,
    },
    reqDate: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: 12,
      marginTop: 2,
    },

    sendBox: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 14,
      padding: spacing.md,
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    draft: {
      minHeight: 72,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: colors.bg,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 15,
      padding: spacing.sm,
      textAlignVertical: "top",
    },
    strip: {
      alignItems: "center",
      paddingVertical: spacing.xs,
      borderTopWidth: 1,
      borderTopColor: colors.borderSoft,
      backgroundColor: colors.surface,
    },
    stripText: {
      color: colors.textMuted,
      fontFamily: fonts.semibold,
      fontSize: 12.5,
    },
    sendActions: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      flexWrap: "wrap",
    },
    thumbRow: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
    thumb: { width: 64, height: 64, borderRadius: 8 },
    replyNote: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: 12.5,
    },
    errorText: {
      color: colors.danger,
      fontFamily: fonts.regular,
      fontSize: 13,
    },

    composer: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.borderSoft,
      backgroundColor: colors.surface,
    },
    input: {
      flex: 1,
      maxHeight: 120,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      backgroundColor: colors.bg,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 15,
      paddingHorizontal: spacing.sm,
      paddingVertical: 9,
    },
    send: {
      borderRadius: 999,
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
    },
    sendText: {
      color: colors.onPrimary,
      fontFamily: fonts.semibold,
      fontSize: 14,
    },
  });
}
