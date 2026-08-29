// One member-support conversation: transcript (member / admin / system turns +
// screenshot attachments) with a reply composer. Polls every 10s so an admin
// reply appears without a manual pull. JS-only; ships via EAS OTA.
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { STR } from "@lms/types";
import type { HelpdeskMessageDTO, HelpdeskThreadDTO } from "@lms/types";

import { api, ApiError, helpdeskAttachmentUrl } from "../api";
import { qk, useHelpdeskThread } from "../queries";
import { Button } from "../components/Button";
import { CtaButton } from "../components/CtaButton";
import { Press } from "../components/Press";
import { EmptyState, ErrorState } from "../components/Screen";
import { Skeleton } from "../components/Skeleton";
import type { ScreenProps } from "../navigation";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

type PickedImage = { uri: string; mimeType?: string };
const MAX_FILES = 3;

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

// A member screenshot: RN <Image> can't send a header, so fetch the scoped
// token URL once, then render it.
function AuthedImage({ attachmentId }: { attachmentId: string }) {
  const styles = useStyles(makeStyles);
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    helpdeskAttachmentUrl(attachmentId)
      .then((u) => {
        if (active) setUri(u);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [attachmentId]);
  if (!uri) return <View style={styles.msgThumbPlaceholder} />;
  return <Image source={{ uri }} style={styles.msgThumb} />;
}

function MessageBubble({ m }: { m: HelpdeskMessageDTO }) {
  const styles = useStyles(makeStyles);
  const kind = m.authorKind;
  if (kind === "SYSTEM") return <Text style={styles.systemText}>{m.body}</Text>;
  const mine = kind === "MEMBER";
  return (
    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleThem]}>
      {kind === "ADMIN" && (
        <Text style={styles.who}>{m.authorName ?? "Support"}</Text>
      )}
      <Text style={mine ? styles.bubbleTextMine : styles.bubbleText}>
        {m.body}
      </Text>
      {m.attachments.length > 0 && (
        <View style={styles.thumbRow}>
          {m.attachments.map((a) => (
            <AuthedImage key={a.id} attachmentId={a.id} />
          ))}
        </View>
      )}
    </View>
  );
}

export function HelpdeskThreadScreen({ route }: ScreenProps<"HelpdeskThread">) {
  const { conversationId, replyTimeNote } = route.params;
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const threadQuery = useHelpdeskThread(conversationId);
  const thread: HelpdeskThreadDTO | null = threadQuery.data ?? null;

  const [body, setBody] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Mark read on open (explicit — never a GET side effect) + refresh the badge.
  useEffect(() => {
    api
      .helpdeskMarkRead(conversationId)
      .then(() =>
        queryClient.invalidateQueries({ queryKey: qk.helpdeskConfig }),
      )
      .catch(() => undefined);
  }, [conversationId, queryClient]);

  const resolveMutation = useMutation({
    scope: { id: `helpdesk:${conversationId}` },
    mutationFn: () => api.helpdeskResolve(conversationId),
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.helpdeskThread(conversationId), updated);
      void queryClient.invalidateQueries({ queryKey: qk.helpdeskConfig });
      void queryClient.invalidateQueries({
        queryKey: qk.helpdeskConversations,
      });
    },
    onError: () => setError(STR.errors.generic),
  });

  const replyMutation = useMutation({
    scope: { id: `helpdesk:${conversationId}` },
    mutationFn: async () => {
      let latest = await api.helpdeskReply(conversationId, body.trim());
      const msgId = latest.messages[latest.messages.length - 1]?.id;
      if (images.length > 0 && msgId) {
        for (const img of images) {
          latest = await api.uploadHelpdeskAttachment(
            conversationId,
            msgId,
            img.uri,
            img.mimeType,
          );
        }
      }
      return latest;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.helpdeskThread(conversationId), updated);
      setBody("");
      setImages([]);
    },
    onError: (e) => {
      setError(
        e instanceof ApiError && e.code === "HELPDESK_CLOSED"
          ? STR.helpdesk.statusClosed
          : e instanceof Error
            ? e.message
            : STR.errors.generic,
      );
    },
  });

  if (threadQuery.isError && thread === null && !threadQuery.isFetching)
    return (
      <ErrorState
        message={
          threadQuery.error instanceof Error
            ? threadQuery.error.message
            : STR.errors.generic
        }
        onRetry={() => void threadQuery.refetch()}
      />
    );
  if (thread === null)
    return (
      <View style={styles.skeletons}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={60} radius={12} style={styles.skelRow} />
        ))}
      </View>
    );

  const closed = thread.status === "CLOSED";
  const isOpen =
    thread.status === "ESCALATED" || thread.status === "WAITING_ON_MEMBER";
  const resolved = thread.status === "RESOLVED" || closed;

  async function onPickImages() {
    try {
      const picked = await pickAttachments();
      if (picked.length) setImages(picked);
    } catch {
      /* denied / cancelled */
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
    >
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
      >
        {thread.messages.map((m) => (
          <MessageBubble key={m.id} m={m} />
        ))}
        {replyTimeNote ? (
          <Text style={styles.replyNote}>{replyTimeNote}</Text>
        ) : null}
        {closed && <EmptyState message={STR.helpdesk.statusClosed} />}

        {/* The member's own way out — reversible (a reply reopens), so a
            single quiet tap with no confirmation. */}
        {isOpen && (
          <Press
            style={styles.resolveLink}
            accessibilityRole="button"
            onPress={() => resolveMutation.mutate()}
            disabled={resolveMutation.isPending}
          >
            <Text style={styles.resolveText}>
              ✓ {STR.helpdesk.markResolved}
            </Text>
          </Press>
        )}

        {resolved && (
          <CsatCard
            conversationId={conversationId}
            satisfactionUp={thread.satisfactionUp}
          />
        )}
      </ScrollView>

      {!closed && (
        <View style={[styles.composer, { paddingBottom: insets.bottom + 8 }]}>
          {images.length > 0 && (
            <View style={styles.thumbRow}>
              {images.map((img) => (
                <Image
                  key={img.uri}
                  source={{ uri: img.uri }}
                  style={styles.msgThumb}
                />
              ))}
            </View>
          )}
          {error && <Text style={styles.errorText}>{error}</Text>}
          <View style={styles.composerRow}>
            <TextInput
              style={styles.input}
              placeholder={STR.helpdesk.replyPlaceholder}
              placeholderTextColor={colors.textMuted}
              value={body}
              onChangeText={setBody}
              multiline
              maxLength={4000}
            />
          </View>
          <View style={styles.composerActions}>
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
                replyMutation.isPending
                  ? STR.helpdesk.sending
                  : STR.helpdesk.reply
              }
              onPress={() => replyMutation.mutate()}
              disabled={replyMutation.isPending || body.trim().length === 0}
              style={styles.sendBtn}
            />
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

/** Once-per-resolution CSAT — the ONLY feedback ask in the helpdesk. Prompt
 *  renders only while resolved and unrated; a past-session rating renders
 *  nothing. A 👎 opens one optional note box. */
function CsatCard({
  conversationId,
  satisfactionUp,
}: {
  conversationId: string;
  satisfactionUp: boolean | null;
}) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [ratedNow, setRatedNow] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [noteSent, setNoteSent] = useState(false);

  const rate = useMutation({
    scope: { id: `helpdesk:${conversationId}` },
    mutationFn: (input: { up: boolean; note?: string }) =>
      api.helpdeskRate(conversationId, input),
    onSuccess: (updated, input) => {
      queryClient.setQueryData(qk.helpdeskThread(conversationId), updated);
      setRatedNow(input.up);
      if (input.note !== undefined) setNoteSent(true);
    },
  });

  if (satisfactionUp !== null && ratedNow === null) return null;

  if (ratedNow !== null) {
    return (
      <View style={styles.csat}>
        <Text style={styles.csatThanks}>{STR.helpdesk.csatThanks}</Text>
        {ratedNow === false && !noteSent && (
          <View style={styles.csatNoteRow}>
            <TextInput
              style={styles.csatNoteInput}
              value={note}
              onChangeText={setNote}
              placeholder={STR.helpdesk.csatNotePlaceholder}
              placeholderTextColor={colors.textMuted}
              maxLength={500}
            />
            <Button
              label={STR.helpdesk.csatSendNote}
              variant="secondary"
              onPress={() => rate.mutate({ up: false, note: note.trim() })}
              disabled={rate.isPending || note.trim().length === 0}
            />
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.csat}>
      <Text style={styles.csatPrompt}>{STR.helpdesk.csatPrompt}</Text>
      <View style={styles.csatActions}>
        <Button
          label={STR.helpdesk.csatYes}
          variant="secondary"
          onPress={() => rate.mutate({ up: true })}
          disabled={rate.isPending}
        />
        <Button
          label={STR.helpdesk.csatNo}
          variant="secondary"
          onPress={() => rate.mutate({ up: false })}
          disabled={rate.isPending}
        />
      </View>
    </View>
  );
}

function makeStyles({ colors, fonts }: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    list: { flex: 1 },
    listContent: { padding: spacing.md, gap: spacing.sm },
    skeletons: {
      flex: 1,
      backgroundColor: colors.bg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    skelRow: { marginBottom: spacing.xs },
    bubble: {
      maxWidth: "88%",
      borderRadius: 12,
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
    who: {
      color: colors.textMuted,
      fontFamily: fonts.semibold,
      fontSize: 11,
      marginBottom: 2,
    },
    bubbleText: {
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 21,
    },
    bubbleTextMine: {
      color: colors.onPrimary,
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 21,
    },
    systemText: {
      alignSelf: "center",
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontStyle: "italic",
      fontSize: 12,
      textAlign: "center",
      paddingHorizontal: spacing.md,
    },
    thumbRow: {
      flexDirection: "row",
      gap: spacing.xs,
      flexWrap: "wrap",
      marginTop: spacing.xs,
    },
    msgThumb: { width: 96, height: 96, borderRadius: 8 },
    msgThumbPlaceholder: {
      width: 96,
      height: 96,
      borderRadius: 8,
      backgroundColor: colors.surfaceMuted,
    },
    replyNote: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: 12,
      textAlign: "center",
      marginTop: spacing.sm,
    },
    composer: {
      borderTopWidth: 1,
      borderTopColor: colors.borderSoft,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      gap: spacing.sm,
    },
    composerRow: { flexDirection: "row" },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: 120,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: colors.bg,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 15,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      textAlignVertical: "top",
    },
    composerActions: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    sendBtn: { flexShrink: 0 },
    resolveLink: { alignSelf: "center", paddingVertical: 10 },
    resolveText: {
      color: colors.textMuted,
      fontFamily: fonts.semibold,
      fontSize: 13,
    },
    csat: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 12,
      padding: spacing.md,
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    csatPrompt: {
      color: colors.text,
      fontFamily: fonts.semibold,
      fontSize: 14.5,
    },
    csatThanks: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: 13.5,
    },
    csatActions: { flexDirection: "row", gap: spacing.sm },
    csatNoteRow: {
      flexDirection: "row",
      gap: spacing.sm,
      alignItems: "center",
    },
    csatNoteInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: colors.bg,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 13.5,
      paddingHorizontal: spacing.sm,
      paddingVertical: 8,
    },
    errorText: {
      color: colors.danger,
      fontFamily: fonts.regular,
      fontSize: 13,
    },
  });
}
