import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput } from "react-native";
import type { CourseCard } from "@lms/types";

import { useDashboard, useRefreshOnFocus } from "../queries";
import { Loading, ErrorState, EmptyState } from "../components/Screen";
import { CourseRow } from "../components/CourseRow";
import { courseSeed } from "../navigation";
import type { ScreenProps } from "../navigation";
import { contentColumn } from "../responsive";
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
  const [q, setQ] = useState("");

  // react-query keeps the last response across refetches, so only the very
  // first load shows the spinner and a failed refocus refetch leaves the good
  // list alone. null = nothing fetched yet.
  const dashboardQuery = useDashboard();
  const courses: CourseCard[] | null = useMemo(() => {
    const sections = dashboardQuery.data?.categories;
    if (!sections) return null;
    return all
      ? sections.flatMap((s) => s.courses)
      : (sections.find((s) => s.category.id === (categoryId ?? ""))?.courses ??
          []);
  }, [dashboardQuery.data, categoryId, all]);

  // Refetch on focus so progress stays current after viewing a lesson.
  useRefreshOnFocus(() => {
    void dashboardQuery.refetch();
  });

  if (dashboardQuery.isError && !courses && !dashboardQuery.isFetching)
    return (
      <ErrorState
        message={
          dashboardQuery.error instanceof Error
            ? dashboardQuery.error.message
            : "Could not load courses."
        }
        onRetry={() => dashboardQuery.refetch()}
      />
    );
  if (!courses) return <Loading />;
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
              navigation.navigate("Course", {
                courseId: c.id,
                title: c.title,
                seed: courseSeed(c),
              })
            }
          />
        ))
      )}
    </ScrollView>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    list: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.md, ...contentColumn },
    search: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
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
