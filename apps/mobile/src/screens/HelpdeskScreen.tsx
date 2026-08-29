// Support home — a launchpad, not a conversation.
//
// A support visit is usually several unrelated errands ("what did I pay?",
// "where's my lesson?", "why is this locked?"). Stacking them into one endless
// transcript buried the useful answer three screens up, so self-serve lookups
// and the human channel now live in separate places:
//
//   home (here) → topic rows, your requests, one ask/message box
//   answer      → HelpdeskAnswerScreen: one topic, then back
//   thread      → HelpdeskThreadScreen: an actual conversation with a person
//
// The one text box routes: a recognised question opens that answer screen (the
// deterministic keyword router — no language model), anything else becomes a
// message to the team pre-filled with what was typed, so nothing is retyped.
// JS-only; ships via EAS OTA.
import { useEffect, useState } from "react";
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
  useHelpdeskArticles,
  useHelpdeskConfig,
  useHelpdeskConversations,
  useMe,
} from "../queries";
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

const TOPIC_LABEL: Partial<Record<HelpdeskCategory, string>> = {
  ACCESS: STR.helpdesk.menuClasses,
  TECHNICAL: STR.helpdesk.menuCourses,
  BILLING: STR.helpdesk.menuPayments,
};

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

export function HelpdeskScreen({
  route,
  navigation,
}: ScreenProps<"HelpdeskHome">) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const me = useMe();

  const configQuery = useHelpdeskConfig();
  const config = configQuery.data ?? null;
  const convQuery = useHelpdeskConversations(config?.enabled === true);
  // This academy's published FAQ — listed below the topics and fed to the
  // composer's router so a typed question can open the matching article.
  const articlesQuery = useHelpdeskArticles(config?.enabled === true);
  const articles = articlesQuery.data ?? [];
  // The full list, closed tickets included — config.openConversations excludes
  // CLOSED, which used to leave closed history unreachable.
  const conversations: HelpdeskConversationSummaryDTO[] =
    convQuery.data ?? config?.openConversations ?? [];

  const [input, setInput] = useState("");
  /** Non-null while the member is writing to a human. */
  const [draft, setDraft] = useState<string | null>(null);
  const [images, setImages] = useState<PickedImage[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Mirror the server's cap (helpdesk.service.ts OPEN_STATUSES): RESOLVED is
  // reopenable and does NOT count toward it.
  const atCap =
    !!config &&
    config.openConversations.filter(
      (c) => c.status === "ESCALATED" || c.status === "WAITING_ON_MEMBER",
    ).length >= config.maxOpenPerMember;

  // An answer screen's "Still stuck?" hands back here asking for the composer.
  const wantsCompose = route.params?.compose === true;
  useEffect(() => {
    if (!wantsCompose) return;
    setDraft((d) => (d === null && !atCap ? "" : d));
    navigation.setParams({ compose: undefined });
  }, [wantsCompose, atCap, navigation]);

  function openAnswer(category: HelpdeskCategory) {
    navigation.navigate("HelpdeskAnswer", {
      category,
      title: TOPIC_LABEL[category] ?? STR.helpdesk.title,
    });
  }

  function openArticle(id: string, title: string) {
    navigation.navigate("HelpdeskArticle", { articleId: id, title });
  }

  function onSend() {
    const text = input.trim();
    if (!text) return;
    setError(null);
    setInput("");
    const intent = routeHelpdeskText(text, ANSWERABLE, articles);
    // A question we can answer goes straight to that answer — faster than
    // filing a ticket, and it keeps the deflection honest.
    if (intent.kind === "topic") {
      openAnswer(intent.category);
      return;
    }
    if (intent.kind === "article") {
      const a = articles.find((x) => x.id === intent.articleId);
      if (a) {
        openArticle(a.id, a.title);
        return;
      }
    }
    // Anything else becomes a message to the team, pre-filled.
    setImages([]);
    setDraft(text);
  }

  const startMutation = useMutation({
    mutationFn: async () => {
      const issue = (draft ?? "").trim();
      const thread = await api.helpdeskStart({
        issue,
        category: categoryForText(issue),
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
      api.helpdeskStatEvent(thread.category, "escalation");
      queryClient.setQueryData(qk.helpdeskThread(thread.id), thread);
      void queryClient.invalidateQueries({ queryKey: qk.helpdeskConfig });
      void queryClient.invalidateQueries({
        queryKey: qk.helpdeskConversations,
      });
      setImages([]);
      setDraft(null);
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

  const greeting = (config.greeting || STR.helpdesk.greetingFallback).replace(
    /\s*\{firstName\}/g,
    me.data?.firstName ? ` ${me.data.firstName}` : "",
  );

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
    >
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.greetCard}>
          <Text style={styles.greet}>{greeting}</Text>
        </View>

        <Text style={styles.section}>{STR.helpdesk.findAnswer}</Text>
        {ANSWERABLE.map((c) => (
          <Press
            key={c}
            style={styles.row}
            accessibilityRole="button"
            onPress={() => openAnswer(c)}
          >
            <Text style={styles.rowLabel}>{TOPIC_LABEL[c]}</Text>
            <Text style={styles.chevron}>›</Text>
          </Press>
        ))}

        {/* Academy-authored FAQ — hidden entirely until the admin writes one. */}
        {articles.length > 0 && (
          <>
            <Text style={styles.section}>{STR.helpdesk.articlesHeading}</Text>
            {articles.map((a) => (
              <Press
                key={a.id}
                style={styles.row}
                accessibilityRole="button"
                onPress={() => openArticle(a.id, a.title)}
              >
                <Text style={styles.rowLabel} numberOfLines={1}>
                  {a.title}
                </Text>
                <Text style={styles.chevron}>›</Text>
              </Press>
            ))}
          </>
        )}

        {/* Work already in flight with the team, on screen the moment support
            opens — this is what the unread badge was pointing at. */}
        {conversations.length > 0 && (
          <>
            <Text style={styles.section}>{STR.helpdesk.yourRequests}</Text>
            {conversations.map((c) => {
              const chip = statusChip(c.status);
              return (
                <Press
                  key={c.id}
                  style={styles.row}
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
                    <Text style={styles.rowLabel} numberOfLines={1}>
                      {c.subject}
                    </Text>
                    <Text style={styles.reqDate}>
                      {fmtDate(c.lastMessageAt)}
                    </Text>
                  </View>
                  {c.unread ? <View style={styles.unread} /> : null}
                  <Chip label={chip.label} tone={chip.tone} />
                </Press>
              );
            })}
          </>
        )}

        {/* Writing to a person — opened by the composer or by an answer's
            "Still stuck?", always seeded so nothing is retyped. */}
        {draft !== null && !atCap && (
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

        {atCap && (
          <Text style={styles.capNote}>{STR.helpdesk.tooManyOpen}</Text>
        )}
      </ScrollView>

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
    content: { ...contentColumn, paddingVertical: spacing.md, gap: spacing.sm },
    skeletons: {
      flex: 1,
      backgroundColor: colors.bg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    skelRow: { marginBottom: spacing.xs },

    greetCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 14,
      padding: spacing.md,
    },
    greet: {
      color: colors.text,
      fontFamily: fonts.medium,
      fontSize: 15,
      lineHeight: 22,
    },
    section: {
      color: colors.textMuted,
      fontFamily: fonts.semibold,
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginTop: spacing.sm,
      marginBottom: -2,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 12,
      paddingHorizontal: spacing.md,
      paddingVertical: 14,
      gap: spacing.sm,
    },
    rowLabel: {
      color: colors.text,
      fontFamily: fonts.semibold,
      fontSize: 15,
      flexShrink: 1,
    },
    chevron: { color: colors.textMuted, fontSize: 20 },
    reqText: { flexShrink: 1 },
    reqDate: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: 12,
      marginTop: 2,
    },
    unread: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.primary,
    },

    sendBox: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 14,
      padding: spacing.md,
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    draft: {
      minHeight: 84,
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
    capNote: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: 13,
      marginTop: spacing.sm,
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
