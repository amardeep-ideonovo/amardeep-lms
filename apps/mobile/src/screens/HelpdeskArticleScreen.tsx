// One admin-authored help article, on its own screen.
//
// Same there-and-back shape as HelpdeskAnswerScreen, but the card carries
// ACADEMY content instead of account data — hence the "Help article" eyebrow.
// Reached from the Support-home article rows or straight from the composer
// when the router matches the typed question against an article's keywords.
import { useEffect, useRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { STR } from "@lms/types";

import { api } from "../api";
import { Press } from "../components/Press";
import { ErrorState } from "../components/Screen";
import { Skeleton } from "../components/Skeleton";
import type { ScreenProps } from "../navigation";
import { useHelpdeskArticles } from "../queries";
import { contentColumn } from "../responsive";
import { elevatedShadow, spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

export function HelpdeskArticleScreen({
  route,
  navigation,
}: ScreenProps<"HelpdeskArticle">) {
  const styles = useStyles(makeStyles);
  const { mode } = useTheme();
  const { articleId } = route.params;

  const articlesQ = useHelpdeskArticles(true);
  const articles = articlesQ.data ?? [];
  const article = articles.find((a) => a.id === articleId) ?? null;

  // A read article is a self-serve answer: count it under the article's own
  // category so a later escalation files against the same bucket. Once per
  // mount — hopping between articles remounts via navigation.replace.
  const counted = useRef(false);
  useEffect(() => {
    if (!article || counted.current) return;
    counted.current = true;
    api.helpdeskStatEvent(article.category, "cardView");
  }, [article]);

  if (articlesQ.isPending) {
    return (
      <View style={styles.skeletons}>
        <Skeleton height={160} radius={16} />
      </View>
    );
  }
  if (articlesQ.isError || !article) {
    return (
      <ErrorState
        message={STR.errors.generic}
        onRetry={() => void articlesQ.refetch()}
      />
    );
  }

  const related = articles.filter((a) => a.id !== article.id).slice(0, 4);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={[styles.card, elevatedShadow(mode)]}>
        <Text style={styles.eyebrow}>{STR.helpdesk.helpArticleEyebrow}</Text>
        {article.body
          .split(/\n{2,}/)
          .filter((p) => p.trim())
          .map((p, i) => (
            <Text key={i} style={styles.body}>
              {p}
            </Text>
          ))}
      </View>

      {related.length > 0 && (
        <>
          <Text style={styles.section}>{STR.helpdesk.relatedHeading}</Text>
          <View style={styles.chipRow}>
            {related.map((a) => (
              <Press
                key={a.id}
                style={styles.chip}
                accessibilityRole="button"
                onPress={() =>
                  // replace, not push: hopping between articles must not build
                  // a back-stack the member has to unwind one screen at a time.
                  navigation.replace("HelpdeskArticle", {
                    articleId: a.id,
                    title: a.title,
                  })
                }
              >
                <Text style={styles.chipText} numberOfLines={1}>
                  {a.title}
                </Text>
              </Press>
            ))}
          </View>
        </>
      )}

      <Press
        style={styles.stuck}
        accessibilityRole="button"
        onPress={() => navigation.navigate("HelpdeskHome", { compose: true })}
      >
        <Text style={styles.stuckText}>
          {STR.helpdesk.stillStuck} {STR.helpdesk.messageTeam}
        </Text>
      </Press>
    </ScrollView>
  );
}

function makeStyles({ colors, fonts }: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { ...contentColumn, paddingVertical: spacing.md, gap: spacing.sm },
    skeletons: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderTopWidth: 3,
      borderTopColor: colors.primary,
      borderRadius: 16,
      padding: spacing.md,
      gap: spacing.sm,
    },
    eyebrow: {
      color: colors.primarySoft,
      fontFamily: fonts.semibold,
      fontSize: 11,
      letterSpacing: 1.2,
      textTransform: "uppercase",
    },
    body: {
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 14.5,
      lineHeight: 22,
    },
    section: {
      color: colors.textMuted,
      fontFamily: fonts.semibold,
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginTop: spacing.sm,
    },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    chip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: 9,
      maxWidth: "100%",
    },
    chipText: {
      color: colors.text,
      fontFamily: fonts.semibold,
      fontSize: 13.5,
    },
    stuck: { alignItems: "center", paddingVertical: spacing.md },
    stuckText: {
      color: colors.textMuted,
      fontFamily: fonts.semibold,
      fontSize: 13,
    },
  });
}
