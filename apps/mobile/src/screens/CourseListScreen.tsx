import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { CourseCard } from "@lms/types";

import { api } from "../api";
import { Loading, ErrorState, EmptyState } from "../components/Screen";
import { CourseRow } from "../components/CourseRow";
import type { ScreenProps } from "../navigation";
import { colors, spacing } from "../theme";

// Drill-down target from the Dashboard: shows the courses for one category, or
// all courses (params.all). Native header back returns to the Dashboard.
export function CourseListScreen({
  route,
  navigation,
}: ScreenProps<"CourseList">) {
  const { categoryId, all } = route.params;
  const [courses, setCourses] = useState<CourseCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.dashboard();
      const sections = data.categories;
      const picked = all
        ? sections.flatMap((s) => s.courses)
        : sections.find((s) => s.category.id === (categoryId ?? ""))?.courses ??
          [];
      setCourses(picked);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load courses.");
    } finally {
      setLoading(false);
    }
  }, [categoryId, all]);

  // Reload on focus so progress stays current after viewing a lesson.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (courses.length === 0) {
    return <EmptyState message="No courses here yet." />;
  }

  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.content}>
      {courses.map((c) => (
        <CourseRow
          key={c.id}
          course={c}
          onPress={() =>
            navigation.navigate("Course", { courseId: c.id, title: c.title })
          }
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
});
