import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { PostListItem } from "@lms/types";

import { api } from "../api";
import { Chip } from "../components/Chip";
import { HeroBand } from "../components/HeroBand";
import { Loading, ErrorState, EmptyState } from "../components/Screen";
import { fmtDate } from "../format";
import type { ScreenProps } from "../navigation";
import { letterGradient, spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";

export function BlogListScreen({ navigation }: ScreenProps<"Blog">) {
  const styles = useStyles(makeStyles);
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

  // Web parity (blog/page.tsx): the newest post gets the featured hero, the
  // rest render as cards.
  const [featured, ...rest] = posts;
  const open = (item: PostListItem) =>
    navigation.navigate("BlogPost", { slug: item.slug, title: item.title });

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={rest}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        <TouchableOpacity
          style={styles.heroWrap}
          activeOpacity={0.85}
          onPress={() => open(featured)}
        >
          <HeroBand
            eyebrow="Featured"
            title={featured.title}
            imageUrl={featured.coverImageUrl}
            gradientSeed={featured.coverImageUrl ? undefined : featured.id}
            chips={[
              featured.categories[0]?.name,
              fmtDate(featured.publishedAt),
            ].filter((c): c is string => !!c)}
          >
            {featured.excerpt ? (
              <Text style={styles.heroExcerpt} numberOfLines={2}>
                {featured.excerpt}
              </Text>
            ) : null}
          </HeroBand>
        </TouchableOpacity>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.85}
          onPress={() => open(item)}
        >
          {item.coverImageUrl ? (
            <Image
              source={{ uri: item.coverImageUrl }}
              style={styles.cover}
              resizeMode="cover"
            />
          ) : (
            <LinearGradient
              colors={letterGradient(item.id)}
              start={{ x: 0, y: 0 }}
              end={{ x: 0.6, y: 1 }}
              style={[styles.cover, styles.coverLetterBox]}
            >
              <Text style={styles.coverLetter}>
                {item.title.slice(0, 1).toUpperCase()}
              </Text>
            </LinearGradient>
          )}
          <View style={styles.cardBody}>
            <View style={styles.metaRow}>
              {item.categories.length > 0 ? (
                <Chip label={item.categories[0].name} />
              ) : null}
              {item.publishedAt ? (
                <Text style={styles.meta}>{fmtDate(item.publishedAt)}</Text>
              ) : null}
            </View>
            <Text style={styles.title}>{item.title}</Text>
            {item.excerpt ? (
              <Text style={styles.excerpt} numberOfLines={2}>
                {item.excerpt}
              </Text>
            ) : null}
            <Text style={styles.readMore}>Read →</Text>
          </View>
        </TouchableOpacity>
      )}
    />
  );
}

const makeStyles = ({ colors }: Theme) => StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  heroWrap: { marginBottom: spacing.md },
  heroExcerpt: { color: colors.heroTextSoft, fontSize: 14, lineHeight: 20 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: 14,
    marginBottom: spacing.md,
    overflow: "hidden",
  },
  cover: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: colors.surfaceMuted,
  },
  coverLetterBox: { alignItems: "center", justifyContent: "center" },
  coverLetter: { color: colors.heroText, fontSize: 44, fontWeight: "800" },
  cardBody: { padding: spacing.md },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  meta: { color: colors.textMuted, fontSize: 12 },
  title: { color: colors.text, fontSize: 16, fontWeight: "700" },
  excerpt: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  readMore: {
    color: colors.primarySoft,
    fontSize: 13,
    fontWeight: "700",
    marginTop: spacing.sm,
  },
});
