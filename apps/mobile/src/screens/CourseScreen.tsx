import React, { useCallback, useState } from "react";
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { CourseCard, LessonDTO } from "@lms/types";

import { api } from "../api";
import { Loading, ErrorState, EmptyState } from "../components/Screen";
import { ProgressBar } from "../components/ProgressBar";
import type { ScreenProps } from "../navigation";
import { colors, spacing } from "../theme";

export function CourseScreen({ route, navigation }: ScreenProps<"Course">) {
  const { courseId } = route.params;
  const [lessons, setLessons] = useState<LessonDTO[]>([]);
  const [course, setCourse] = useState<CourseCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.courseLessons(courseId);
      setLessons([...data].sort((a, b) => a.order - b.order));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load lessons.");
    } finally {
      setLoading(false);
    }
    // Cover image / title are decorative — best effort, never blocks lessons.
    api
      .courses()
      .then((cs) => setCourse(cs.find((c) => c.id === courseId) ?? null))
      .catch(() => {});
  }, [courseId]);

  // Reload on focus so completing a lesson and returning updates progress.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (lessons.length === 0) {
    return <EmptyState message="This course has no lessons yet." />;
  }

  const completed = lessons.filter((l) => l.completed).length;

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={lessons}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        <View>
          {course?.coverImageUrl ? (
            <Image
              source={{ uri: course.coverImageUrl }}
              style={styles.cover}
              resizeMode="cover"
            />
          ) : null}
          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>Course progress</Text>
            <ProgressBar completed={completed} total={lessons.length} />
          </View>
        </View>
      }
      renderItem={({ item, index }) => (
        <TouchableOpacity
          style={styles.row}
          activeOpacity={0.8}
          onPress={() =>
            navigation.navigate("Lesson", {
              lessonId: item.id,
              title: item.title,
            })
          }
        >
          <View style={styles.numberBadge}>
            <Text style={styles.numberText}>{index + 1}</Text>
          </View>
          {item.thumbnailUrl ? (
            <Image source={{ uri: item.thumbnailUrl }} style={styles.rowThumb} />
          ) : (
            <View style={[styles.rowThumb, styles.rowThumbEmpty]}>
              <Text style={styles.rowThumbGlyph}>▶</Text>
            </View>
          )}
          <Text style={styles.rowTitle} numberOfLines={2}>
            {item.title}
          </Text>
          {item.completed ? <Text style={styles.check}>✓</Text> : null}
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  cover: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
    marginBottom: spacing.sm,
  },
  progressHeader: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  progressTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  numberBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  numberText: { color: colors.text, fontWeight: "700" },
  rowThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    marginRight: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  rowThumbEmpty: { alignItems: "center", justifyContent: "center" },
  rowThumbGlyph: { color: colors.textMuted, fontSize: 16 },
  rowTitle: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "500" },
  check: { color: colors.primary, fontSize: 18, fontWeight: "700" },
});
