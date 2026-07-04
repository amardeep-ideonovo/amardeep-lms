import React, { useCallback, useEffect, useState } from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type { PostDetailDTO } from "@lms/types";

import { api } from "../api";
import { Chip } from "../components/Chip";
import { HtmlView } from "../components/HtmlView";
import { Loading, ErrorState } from "../components/Screen";
import type { ScreenProps } from "../navigation";
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
  const { width } = useWindowDimensions();
  const [post, setPost] = useState<PostDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPost(await api.post(slug));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this post.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!post) return <ErrorState message="Post not found." onRetry={load} />;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
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
        contentWidth={width - spacing.md * 2}
        baseStyle={styles.htmlBase}
      />

      {post.tags.length > 0 ? (
        <View style={styles.tags}>
          {post.tags.map((t) => (
            <Text key={t} style={styles.tag}>
              #{t}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.spacer} />
    </ScrollView>
  );
}

const makeStyles = ({ colors, fonts }: Theme) => StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
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
  metaRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: spacing.md },
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
