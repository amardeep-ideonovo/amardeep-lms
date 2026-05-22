import React, { useCallback, useEffect, useState } from "react";
import {
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { CourseCard, DashboardResponse } from "@lms/types";

import { api } from "../api";
import { useAuth } from "../auth";
import { Loading, ErrorState, EmptyState } from "../components/Screen";
import { ProgressBar } from "../components/ProgressBar";
import type { ScreenProps } from "../navigation";
import { colors, spacing } from "../theme";

type Section = { title: string; data: CourseCard[] };

function toSections(data: DashboardResponse): Section[] {
  return data.categories.map((group) => ({
    title: group.category.name,
    data: group.courses,
  }));
}

export function DashboardScreen({ navigation }: ScreenProps<"Dashboard">) {
  const { signOut } = useAuth();
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.dashboard();
      setSections(toSections(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload on focus (not just mount) so progress reflects lessons completed
  // since the last visit — e.g. returning here after finishing a lesson.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Header actions: Account (web billing) + Sign out.
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
  if (sections.length === 0) {
    return <EmptyState message="No courses available yet." />;
  }

  return (
    <SectionList
      style={styles.list}
      contentContainerStyle={styles.content}
      sections={sections}
      keyExtractor={(item) => item.id}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) => (
        <Text style={styles.sectionHeader}>{section.title}</Text>
      )}
      renderItem={({ item }) => (
        <CourseRow
          course={item}
          onPress={() =>
            navigation.navigate("Course", { courseId: item.id, title: item.title })
          }
        />
      )}
    />
  );
}

function CourseRow({
  course,
  onPress,
}: {
  course: CourseCard;
  onPress: () => void;
}) {
  const locked = course.locked;
  return (
    <TouchableOpacity
      style={[styles.card, locked && styles.cardLocked]}
      onPress={onPress}
      disabled={locked}
      activeOpacity={0.8}
    >
      <View style={styles.cardRow}>
        <View style={styles.cardText}>
          <Text style={[styles.cardTitle, locked && styles.lockedText]}>
            {course.title}
          </Text>
          {course.description ? (
            <Text style={styles.cardDesc} numberOfLines={2}>
              {course.description}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.indicator, locked && styles.lockedText]}>
          {locked ? "🔒" : "›"}
        </Text>
      </View>
      {!locked && course.lessonCount > 0 ? (
        <ProgressBar
          completed={course.completedCount}
          total={course.lessonCount}
        />
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  sectionHeader: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardRow: { flexDirection: "row", alignItems: "center" },
  cardLocked: { opacity: 0.6 },
  cardText: { flex: 1, paddingRight: spacing.sm },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  cardDesc: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  indicator: { color: colors.text, fontSize: 18 },
  lockedText: { color: colors.locked },
  headerActions: { flexDirection: "row", gap: spacing.md },
  headerLink: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  signOut: { color: colors.textMuted },
});
