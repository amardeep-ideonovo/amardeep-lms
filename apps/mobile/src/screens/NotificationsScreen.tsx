// In-app notification inbox — the durable record behind the OS push. Rows show
// title / body / when, with an unread dot; tapping marks read (optimistically)
// and deep-links to the target via openAppHref. "Mark all read" clears the feed.
import React, { useCallback, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import type {
  MemberNotificationDTO,
  MemberNotificationListDTO,
} from "@lms/types";

import { api } from "../api";
import { ErrorState } from "../components/Screen";
import { Skeleton } from "../components/Skeleton";
import { Press } from "../components/Press";
import { openAppHref } from "../links";
import { fmtDate } from "../format";
import { qk, useNotifications } from "../queries";
import type { ScreenProps } from "../navigation";
import { contentColumn } from "../responsive";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

export function NotificationsScreen(_props: ScreenProps<"Notifications">) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const query = useNotifications();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [query]);

  // Optimistically flip a row (and the unread badge) read, then persist. On
  // failure, invalidate so the server state wins back.
  const markRead = useCallback(
    (n: MemberNotificationDTO) => {
      if (!n.read) {
        queryClient.setQueryData<MemberNotificationListDTO>(
          qk.notifications,
          (prev) =>
            prev
              ? {
                  ...prev,
                  items: prev.items.map((i) =>
                    i.id === n.id ? { ...i, read: true } : i,
                  ),
                  unreadCount: Math.max(0, prev.unreadCount - 1),
                }
              : prev,
        );
        queryClient.setQueryData<{ count: number }>(
          qk.notificationsUnread,
          (prev) => (prev ? { count: Math.max(0, prev.count - 1) } : prev),
        );
        void api.markNotificationRead(n.id).catch(() => {
          void queryClient.invalidateQueries({ queryKey: qk.notifications });
          void queryClient.invalidateQueries({
            queryKey: qk.notificationsUnread,
          });
        });
      }
      if (n.href) openAppHref(n.href);
    },
    [queryClient],
  );

  const markAll = useCallback(() => {
    queryClient.setQueryData<MemberNotificationListDTO>(
      qk.notifications,
      (prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((i) => ({ ...i, read: true })),
              unreadCount: 0,
            }
          : prev,
    );
    queryClient.setQueryData(qk.notificationsUnread, { count: 0 });
    void api.markAllNotificationsRead().catch(() => {
      void queryClient.invalidateQueries({ queryKey: qk.notifications });
      void queryClient.invalidateQueries({ queryKey: qk.notificationsUnread });
    });
  }, [queryClient]);

  if (query.isError) {
    return (
      <ErrorState
        message="Couldn't load your notifications."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const data = query.data;
  const items = data?.items ?? [];
  const hasUnread = (data?.unreadCount ?? 0) > 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      {hasUnread ? (
        <Press
          onPress={markAll}
          style={styles.markAll}
          accessibilityRole="button"
        >
          <Text style={styles.markAllText}>Mark all as read</Text>
        </Press>
      ) : null}

      {data == null ? (
        <View style={styles.list}>
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>You're all caught up</Text>
          <Text style={styles.emptyBody}>
            Replies, new content and live sessions will show up here.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {items.map((n) => (
            <Press
              key={n.id}
              onPress={() => markRead(n)}
              style={[styles.row, !n.read && styles.rowUnread]}
              accessibilityRole="button"
            >
              <View
                style={[styles.dot, n.read ? styles.dotRead : styles.dotUnread]}
              />
              <View style={styles.rowBody}>
                <Text
                  style={[styles.title, !n.read && styles.titleUnread]}
                  numberOfLines={1}
                >
                  {n.title}
                </Text>
                <Text style={styles.body} numberOfLines={2}>
                  {n.body}
                </Text>
                <Text style={styles.when}>{fmtDate(n.createdAt)}</Text>
              </View>
            </Press>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function makeStyles(theme: Theme) {
  const { colors } = theme;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { ...contentColumn, paddingVertical: spacing.md },
    markAll: { alignSelf: "flex-end", padding: spacing.sm },
    markAllText: {
      color: colors.primary,
      fontWeight: "600",
      fontSize: 14,
    },
    list: { gap: spacing.sm },
    row: {
      flexDirection: "row",
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      padding: spacing.md,
    },
    rowUnread: { borderColor: colors.border },
    dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
    dotUnread: { backgroundColor: colors.primary },
    dotRead: { backgroundColor: "transparent" },
    rowBody: { flex: 1, gap: 2 },
    title: { color: colors.text, fontSize: 15, fontWeight: "500" },
    titleUnread: { fontWeight: "700" },
    body: { color: colors.textMuted, fontSize: 14, lineHeight: 19 },
    when: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    empty: { alignItems: "center", paddingVertical: spacing.xl * 2, gap: 6 },
    emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
    emptyBody: {
      color: colors.textMuted,
      fontSize: 14,
      textAlign: "center",
      maxWidth: 260,
    },
  });
}
