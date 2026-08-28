// One topic's answer, on its own screen.
//
// Looking something up is a there-and-back errand, not a turn appended to a
// conversation: the member arrives from Support home, reads their own account
// data, and leaves with the native back gesture. Nothing accumulates, so a
// visit that touches three topics never becomes one muddled scroll.
//
// The answer bodies are the same components Support home used to render inline
// (helpdesk-summaries), so the account data, the past-due carve-out and the
// deflection stat all behave exactly as before.
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { STR } from "@lms/types";
import type { HelpdeskCategory } from "@lms/types";

import { api } from "../api";
import {
  ClassesSummary,
  CoursesSummary,
  PaymentsSummary,
} from "./helpdesk-summaries";
import { Press } from "../components/Press";
import { ANSWERABLE } from "../helpdesk-answerable";
import type { ScreenProps } from "../navigation";
import { contentColumn } from "../responsive";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";

const TOPIC_LABEL: Partial<Record<HelpdeskCategory, string>> = {
  ACCESS: STR.helpdesk.menuClasses,
  TECHNICAL: STR.helpdesk.menuCourses,
  BILLING: STR.helpdesk.menuPayments,
};

export function HelpdeskAnswerScreen({
  route,
  navigation,
}: ScreenProps<"HelpdeskAnswer">) {
  const styles = useStyles(makeStyles);
  const { category } = route.params;

  // Count a self-serve view only once the answer knows it actually had
  // something to say — an empty card is not a deflection.
  const onAnswered = (hadData: boolean) => {
    if (hadData) api.helpdeskStatEvent(category, "cardView");
  };

  const related = ANSWERABLE.filter((c) => c !== category);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        {category === "ACCESS" && <ClassesSummary onAnswered={onAnswered} />}
        {category === "TECHNICAL" && <CoursesSummary onAnswered={onAnswered} />}
        {category === "BILLING" && (
          <PaymentsSummary navigation={navigation} onAnswered={onAnswered} />
        )}
      </View>

      {related.length > 0 && (
        <>
          <Text style={styles.section}>{STR.helpdesk.relatedHeading}</Text>
          {related.map((c) => (
            <Press
              key={c}
              style={styles.row}
              accessibilityRole="button"
              onPress={() =>
                // replace, not push: hopping between answers must not build a
                // back-stack the member has to unwind one screen at a time.
                navigation.replace("HelpdeskAnswer", {
                  category: c,
                  title: TOPIC_LABEL[c] ?? STR.helpdesk.title,
                })
              }
            >
              <Text style={styles.rowLabel}>{TOPIC_LABEL[c]}</Text>
              <Text style={styles.chevron}>›</Text>
            </Press>
          ))}
        </>
      )}

      {/* The quiet route to a person, present on every answer but never
          competing with it (see the chat-UX audit: escalation is a standing
          offer, not a verdict on the answer you just read). */}
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
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 14,
      padding: spacing.md,
    },
    section: {
      color: colors.textMuted,
      fontFamily: fonts.semibold,
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 12,
      paddingHorizontal: spacing.md,
      paddingVertical: 14,
    },
    rowLabel: {
      color: colors.text,
      fontFamily: fonts.semibold,
      fontSize: 15,
      flexShrink: 1,
    },
    chevron: { color: colors.textMuted, fontSize: 20, marginLeft: spacing.sm },
    stuck: { alignItems: "center", paddingVertical: spacing.md },
    stuckText: {
      color: colors.textMuted,
      fontFamily: fonts.semibold,
      fontSize: 13,
    },
  });
}
