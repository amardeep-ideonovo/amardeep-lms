import React, { useCallback, useEffect, useState } from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { CategoryDTO, CourseCard, DashboardResponse } from "@lms/types";

import { api } from "../api";
import { useAuth } from "../auth";
import { Loading, ErrorState, EmptyState } from "../components/Screen";
import { CourseRow } from "../components/CourseRow";
import { PopupHost } from "../components/PopupHost";
import type { ScreenProps } from "../navigation";
import { colors, spacing } from "../theme";

type Section = { category: CategoryDTO; courses: CourseCard[] };

function CategoryTile({
  section,
  onPress,
}: {
  section: Section;
  onPress: () => void;
}) {
  const { category, courses } = section;
  return (
    <TouchableOpacity style={styles.catCard} onPress={onPress} activeOpacity={0.8}>
      {category.thumbnailUrl ? (
        <Image source={{ uri: category.thumbnailUrl }} style={styles.catThumb} />
      ) : (
        <View style={[styles.catThumb, styles.catThumbEmpty]}>
          <Text style={styles.catThumbLetter}>
            {category.name.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
      <View style={styles.cardText}>
        <Text style={styles.cardTitle}>{category.name}</Text>
        <Text style={styles.cardDesc}>
          {courses.length} course{courses.length === 1 ? "" : "s"}
        </Text>
      </View>
      <Text style={styles.indicator}>›</Text>
    </TouchableOpacity>
  );
}

function AllCoursesTile({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.catCard} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.catThumb, styles.catThumbAll]}>
        <Text style={styles.catThumbLetter}>▦</Text>
      </View>
      <View style={styles.cardText}>
        <Text style={styles.cardTitle}>All courses</Text>
        <Text style={styles.cardDesc}>
          {count} course{count === 1 ? "" : "s"}
        </Text>
      </View>
      <Text style={styles.indicator}>›</Text>
    </TouchableOpacity>
  );
}

export function DashboardScreen({ navigation }: ScreenProps<"Dashboard">) {
  const { signOut } = useAuth();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.dashboard());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload on focus so progress reflects lessons completed since last visit.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => navigation.navigate("Blog")}>
            <Text style={styles.headerLink}>Blog</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate("Account")}>
            <Text style={styles.headerLink}>Account</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={signOut}>
            <Text style={[styles.headerLink, styles.signOut]}>Sign out</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, signOut]);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <EmptyState message="No courses available yet." />;

  const sections: Section[] = data.categories;
  const allCourses = sections.flatMap((s) => s.courses);
  const withCourses = sections.filter((s) => s.courses.length > 0);
  const hasCategories = withCourses.some((s) => s.category.id !== "");
  const query = q.trim().toLowerCase();

  const openCourse = (c: CourseCard) =>
    navigation.navigate("Course", { courseId: c.id, title: c.title });
  const openCategory = (s: Section) =>
    navigation.navigate("CourseList", {
      title: s.category.name,
      categoryId: s.category.id,
    });
  const openAll = () =>
    navigation.navigate("CourseList", { title: "All courses", all: true });

  if (allCourses.length === 0) {
    return <EmptyState message="No courses available yet." />;
  }

  const matchCats = withCourses.filter(
    (s) => s.category.id !== "" && s.category.name.toLowerCase().includes(query)
  );
  const matchCourses = allCourses.filter((c) =>
    c.title.toLowerCase().includes(query)
  );

  return (
    <>
      <PopupHost context={{ type: "dashboard" }} />
      <ScrollView style={styles.list} contentContainerStyle={styles.content}>
      <TextInput
        style={styles.search}
        placeholder="Search categories or courses…"
        placeholderTextColor={colors.textMuted}
        value={q}
        onChangeText={setQ}
        autoCorrect={false}
        autoCapitalize="none"
      />

      {query ? (
        matchCats.length === 0 && matchCourses.length === 0 ? (
          <Text style={styles.empty}>Nothing matches “{q}”.</Text>
        ) : (
          <>
            {matchCats.length > 0 ? (
              <Text style={styles.sectionHeader}>Categories</Text>
            ) : null}
            {matchCats.map((s) => (
              <CategoryTile
                key={s.category.id}
                section={s}
                onPress={() => openCategory(s)}
              />
            ))}
            {matchCourses.length > 0 ? (
              <Text style={styles.sectionHeader}>Courses</Text>
            ) : null}
            {matchCourses.map((c) => (
              <CourseRow key={c.id} course={c} onPress={() => openCourse(c)} />
            ))}
          </>
        )
      ) : !hasCategories ? (
        allCourses.map((c) => (
          <CourseRow key={c.id} course={c} onPress={() => openCourse(c)} />
        ))
      ) : (
        <>
          {withCourses.map((s) => (
            <CategoryTile
              key={s.category.id || "uncategorized"}
              section={s}
              onPress={() => openCategory(s)}
            />
          ))}
          <AllCoursesTile count={allCourses.length} onPress={openAll} />
        </>
      )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
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
  },
  sectionHeader: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  empty: {
    color: colors.textMuted,
    fontSize: 15,
    textAlign: "center",
    marginTop: spacing.lg,
  },
  catCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  catThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    marginRight: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  catThumbEmpty: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  catThumbAll: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  catThumbLetter: { color: colors.text, fontSize: 24, fontWeight: "700" },
  cardText: { flex: 1, paddingRight: spacing.sm },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  cardDesc: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  indicator: { color: colors.text, fontSize: 18 },
  headerActions: { flexDirection: "row", gap: spacing.md },
  headerLink: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  signOut: { color: colors.textMuted },
});
