import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { PostListItem } from "@lms/types";

import { api } from "../api";
import { Loading, ErrorState, EmptyState } from "../components/Screen";
import type { ScreenProps } from "../navigation";
import { colors, spacing } from "../theme";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export function BlogListScreen({ navigation }: ScreenProps<"Blog">) {
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPosts(await api.posts());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the blog.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (posts.length === 0) return <EmptyState message="No blog posts yet." />;

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={posts}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.85}
          onPress={() =>
            navigation.navigate("BlogPost", {
              slug: item.slug,
              title: item.title,
            })
          }
        >
          {item.coverImageUrl ? (
            <Image
              source={{ uri: item.coverImageUrl }}
              style={styles.cover}
              resizeMode="cover"
            />
          ) : null}
          <View style={styles.cardBody}>
            <View style={styles.metaRow}>
              {item.categories.length > 0 ? (
                <Text style={styles.cat}>
                  {item.categories.map((c) => c.name).join(", ")}
                </Text>
              ) : null}
              {item.categories.length > 0 && item.publishedAt ? (
                <Text style={styles.meta}>·</Text>
              ) : null}
              {item.publishedAt ? (
                <Text style={styles.meta}>{fmtDate(item.publishedAt)}</Text>
              ) : null}
            </View>
            <Text style={styles.title}>{item.title}</Text>
            {item.excerpt ? (
              <Text style={styles.excerpt} numberOfLines={3}>
                {item.excerpt}
              </Text>
            ) : null}
          </View>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: spacing.md,
    overflow: "hidden",
  },
  cover: { width: "100%", height: 160, backgroundColor: colors.surfaceMuted },
  cardBody: { padding: spacing.md },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  cat: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: 12 },
  title: { color: colors.text, fontSize: 17, fontWeight: "700" },
  excerpt: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: spacing.xs,
    lineHeight: 20,
  },
});
