import React, { useCallback, useState } from "react";
import {
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { usePost } from "../queries";
import { Chip } from "../components/Chip";
import { HtmlView } from "../components/HtmlView";
import { Loading, ErrorState } from "../components/Screen";
import type { ScreenProps } from "../navigation";
import { contentColumn, useContentLayout } from "../responsive";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export function BlogPostScreen({ route }: ScreenProps<"BlogPost">) {
  const styles = useStyles(makeStyles);
  const { slug } = route.params;
  const { contentWidth } = useContentLayout();
  // react-query keeps the rendered article across refetches, so a refetch that
  // FAILS leaves it on screen instead of swapping it for an error page — the
  // old loadedOnce guard, now for free.
  const postQuery = usePost(slug);
  const post = postQuery.data ?? null;

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await postQuery.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [postQuery]);

  if (!post) {
    // Error page only before the first success; the retry shows the spinner.
    if (postQuery.isError && !postQuery.isFetching)
      return (
        <ErrorState
          message={
            postQuery.error instanceof Error
              ? postQuery.error.message
              : "Could not load this post."
          }
          onRetry={() => postQuery.refetch()}
        />
      );
    if (postQuery.isPending || postQuery.isFetching) return <Loading />;
    return (
      <ErrorState
        message="Post not found."
        onRetry={() => postQuery.refetch()}
      />
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {post.coverImageUrl ? (
        <Image
          source={{ uri: post.coverImageUrl }}
          style={styles.cover}
          resizeMode="cover"
        />
      ) : null}

      {post.categories.length > 0 ? (
        <View style={styles.catRow}>
          {post.categories.map((c) => (
            <Chip key={c.id} label={c.name} />
          ))}
        </View>
      ) : null}

      <Text style={styles.title}>{post.title}</Text>

      <View style={styles.metaRow}>
        {post.author ? (
          <Text style={styles.meta}>By {post.author.name}</Text>
        ) : null}
        {post.publishedAt ? (
          <Text style={styles.meta}> · {fmtDate(post.publishedAt)}</Text>
        ) : null}
      </View>

      <HtmlView
        html={post.content || "<p></p>"}
        contentWidth={contentWidth - spacing.md * 2}
        baseStyle={styles.htmlBase}
      />

      {post.tags.length > 0 ? (
        <View style={styles.tags}>
          {post.tags.map((t) => (
            <Text key={t.id} style={styles.tag}>
              #{t.name}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.spacer} />
    </ScrollView>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    scroll: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.md, ...contentColumn },
    cover: {
      width: "100%",
      height: 200,
      borderRadius: 14,
      backgroundColor: colors.surfaceMuted,
      marginBottom: spacing.md,
    },
    catRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
      marginBottom: spacing.sm,
    },
    title: {
      color: colors.text,
      fontSize: 24,
      fontWeight: "800",
      marginBottom: spacing.sm,
      fontFamily: fonts.display,
    },
    metaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginBottom: spacing.md,
    },
    meta: { color: colors.textMuted, fontSize: 13, fontFamily: fonts.regular },
    htmlBase: { color: colors.text },
    tags: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
      marginTop: spacing.md,
    },
    tag: {
      color: colors.textMuted,
      fontSize: 12,
      backgroundColor: colors.chipBg,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: 999,
      overflow: "hidden",
      fontFamily: fonts.regular,
    },
    spacer: { height: spacing.lg },
  });
