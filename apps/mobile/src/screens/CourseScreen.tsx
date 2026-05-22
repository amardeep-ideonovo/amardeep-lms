import React, { useCallback, useState } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { LessonDTO } from "@lms/types";

import { api } from "../api";
import { Loading, ErrorState, EmptyState } from "../components/Screen";
import { ProgressBar } from "../components/ProgressBar";
import type { ScreenProps } from "../navigation";
import { colors, spacing } from "../theme";

export function CourseScreen({ route, navigation }: ScreenProps<"Course">) {
  const { courseId } = route.params;
  const [lessons, setLessons] = useState<LessonDTO[]>([]);
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
        <View style={styles.progressHeader}>
          <Text style={styles.progressTitle}>Course progress</Text>
          <ProgressBar completed={completed} total={lessons.length} />
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
    marginRight: spacing.md,
  },
  numberText: { color: colors.text, fontWeight: "700" },
  rowTitle: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "500" },
  check: { color: colors.primary, fontSize: 18, fontWeight: "700" },
});
