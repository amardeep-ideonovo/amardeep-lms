// Guided member support home (mobile equivalent of the web HelpdeskWidget).
// Greeting → topic menu that hands off to the screen holding that account data
// (classes / courses / payments) → "Something else" opens an escalation
// composer that raises a ticket → "My requests" lists open conversations.
// JS-only; ships via EAS OTA.
import { useState } from "react";
import { Image, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { STR } from "@lms/types";
import type {
  HelpdeskCategory,
  HelpdeskConversationSummaryDTO,
  HelpdeskStatus,
  HelpdeskThreadDTO,
} from "@lms/types";

import { api, ApiError } from "../api";
import { qk, useHelpdeskConfig, useHelpdeskConversations } from "../queries";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { CtaButton } from "../components/CtaButton";
import { Press } from "../components/Press";
import { EmptyState, ErrorState } from "../components/Screen";
import { Skeleton } from "../components/Skeleton";
import { fmtDate } from "../format";
import type { ScreenProps } from "../navigation";
import { contentColumn } from "../responsive";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { StyleSheet } from "react-native";
import { useStyles, useTheme } from "../theme-provider";

type PickedImage = { uri: string; mimeType?: string };

const MAX_FILES = 3;

// Topic → the screen that already shows that account data, and the ticket
// category an escalation from here pre-fills.
const TOPICS: {
  key: string;
  label: string;
  category: HelpdeskCategory;
  go?: (nav: ScreenProps<"HelpdeskHome">["navigation"]) => void;
}[] = [
  {
    key: "classes",
    label: STR.helpdesk.menuClasses,
    category: "ACCESS",
    go: (nav) => nav.navigate("Main", { screen: "Classes" }),
  },
  {
    key: "courses",
    label: STR.helpdesk.menuCourses,
    category: "TECHNICAL",
    go: (nav) =>
      nav.navigate("CourseList", { title: "All courses", all: true }),
  },
  {
    key: "payments",
    label: STR.helpdesk.menuPayments,
    category: "BILLING",
    go: (nav) => nav.navigate("Payments"),
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
  const queryClient = useQueryClient();

  const configQuery = useHelpdeskConfig();
  const config = configQuery.data ?? null;
  const convQuery = useHelpdeskConversations(config?.enabled === true);
  const conversations: HelpdeskConversationSummaryDTO[] =
    convQuery.data ?? config?.openConversations ?? [];

  const [composeOpen, setComposeOpen] = useState(false);
  const [issue, setIssue] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const atCap =
    !!config && config.openConversations.length >= config.maxOpenPerMember;

  const startMutation = useMutation({
    mutationFn: async () => {
      const thread = await api.helpdeskStart({
        issue: issue.trim(),
        category: "OTHER",
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
      setIssue("");
      setImages([]);
      setComposeOpen(false);
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
        {[0, 1, 2, 3].map((i) => (
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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.greetCard}>
        <Text style={styles.greet}>
          {(config.greeting || STR.helpdesk.greetingFallback).replace(
            /\s*\{firstName\}/g,
            "",
          )}
        </Text>
      </View>

      {TOPICS.map((t) => (
        <Press
          key={t.key}
          style={styles.row}
          accessibilityRole="button"
          onPress={() => {
            api.helpdeskStatEvent(t.category, "cardView");
            t.go?.(navigation);
          }}
        >
          <Text style={styles.rowLabel}>{t.label}</Text>
          <Text style={styles.chevron}>›</Text>
        </Press>
      ))}

      <Press
        style={styles.row}
        accessibilityRole="button"
        onPress={() => {
          setError(null);
          setComposeOpen((v) => !v);
        }}
      >
        <Text style={styles.rowLabel}>{STR.helpdesk.menuSomethingElse}</Text>
        <Text style={styles.chevron}>{composeOpen ? "⌄" : "›"}</Text>
      </Press>

      {composeOpen && (
        <View style={styles.composeCard}>
          <Text style={styles.composeHint}>{STR.helpdesk.describeIssue}</Text>
          <TextInput
            style={styles.input}
            placeholder={STR.helpdesk.issuePlaceholder}
            placeholderTextColor={colors.textMuted}
            value={issue}
            onChangeText={setIssue}
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
          {error && <Text style={styles.errorText}>{error}</Text>}
          <View style={styles.composeActions}>
            <Button
              label={
                images.length
                  ? `${images.length}/${MAX_FILES}`
                  : STR.helpdesk.attachImage
              }
              variant="secondary"
              onPress={() => void onPickImages()}
            />
            <CtaButton
              label={
                startMutation.isPending
                  ? STR.helpdesk.sending
                  : STR.helpdesk.send
              }
              onPress={() => startMutation.mutate()}
              disabled={
                startMutation.isPending || atCap || issue.trim().length === 0
              }
              style={styles.sendBtn}
            />
          </View>
          {atCap && (
            <Text style={styles.errorText}>{STR.helpdesk.tooManyOpen}</Text>
          )}
        </View>
      )}

      {conversations.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>{STR.helpdesk.myRequests}</Text>
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
                  <Text style={styles.reqDate}>{fmtDate(c.lastMessageAt)}</Text>
                </View>
                <Chip label={chip.label} tone={chip.tone} />
              </Press>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

function makeStyles({ colors, fonts }: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
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
      marginBottom: spacing.xs,
    },
    greet: {
      color: colors.text,
      fontFamily: fonts.medium,
      fontSize: 15,
      lineHeight: 22,
    },
    sectionTitle: {
      color: colors.textMuted,
      fontFamily: fonts.semibold,
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
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
    },
    rowLabel: {
      color: colors.text,
      fontFamily: fonts.semibold,
      fontSize: 15,
      flexShrink: 1,
    },
    chevron: { color: colors.textMuted, fontSize: 20, marginLeft: spacing.sm },
    reqText: { flexShrink: 1, marginRight: spacing.sm },
    reqDate: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: 12,
      marginTop: 2,
    },
    composeCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 14,
      padding: spacing.md,
      gap: spacing.sm,
    },
    composeHint: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: 13,
    },
    input: {
      minHeight: 96,
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
    thumbRow: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
    thumb: { width: 64, height: 64, borderRadius: 8 },
    composeActions: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    sendBtn: { flexShrink: 0 },
    errorText: {
      color: colors.danger,
      fontFamily: fonts.regular,
      fontSize: 13,
    },
  });
}
