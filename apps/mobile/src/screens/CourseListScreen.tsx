import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { CourseCard } from "@lms/types";

import { api } from "../api";
import { Loading, ErrorState, EmptyState } from "../components/Screen";
import { CourseRow } from "../components/CourseRow";
import type { ScreenProps } from "../navigation";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

// Drill-down target from the Dashboard: shows the courses for one category, or
// all courses (params.all). Native header back returns to the Dashboard.
export function CourseListScreen({
  route,
  navigation,
}: ScreenProps<"CourseList">) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const { categoryId, all } = route.params;
  const [courses, setCourses] = useState<CourseCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

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

  const ql = q.trim().toLowerCase();
  const list = ql
    ? courses.filter((c) => c.title.toLowerCase().includes(ql))
    : courses;

  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.content}>
      <TextInput
        style={styles.search}
        placeholder="Search courses…"
        placeholderTextColor={colors.textMuted}
        value={q}
        onChangeText={setQ}
        autoCorrect={false}
        autoCapitalize="none"
      />
      {list.length === 0 ? (
        <Text style={styles.empty}>Nothing matches “{q}”.</Text>
      ) : (
        list.map((c) => (
          <CourseRow
            key={c.id}
            course={c}
            onPress={() =>
              navigation.navigate("Course", { courseId: c.id, title: c.title })
            }
          />
        ))
      )}
    </ScrollView>
  );
}

const makeStyles = ({ colors, fonts }: Theme) => StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  search: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 15,
    marginBottom: spacing.md,
    fontFamily: fonts.regular,
  },
  empty: {
    color: colors.textMuted,
    fontSize: 15,
    textAlign: "center",
    marginTop: spacing.lg,
    fontFamily: fonts.regular,
  },
});
