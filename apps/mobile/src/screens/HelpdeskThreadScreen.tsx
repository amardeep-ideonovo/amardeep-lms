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
    errorText: {
      color: colors.danger,
      fontFamily: fonts.regular,
      fontSize: 13,
    },
  });
}
