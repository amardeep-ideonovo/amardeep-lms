// One topic's answer, on its own screen.
//
// Looking something up is a there-and-back errand, not a turn appended to a
// conversation: the member arrives from Support home, reads their own account
// data, and leaves with the native back gesture.
//
// Visually, the answer must NOT look like the menu that led to it — that was
// the "everything is the same white row" complaint. So the answer lives in one
// ELEVATED card under a "From your account" eyebrow (this is live personal
// data, not navigation), and the Related links are demoted to outline chips so
// they read as secondary wayfinding, not more content.
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { STR } from "@lms/types";
import type { HelpdeskCategory } from "@lms/types";

import { api } from "../api";
import {
  AccountSummary,
  CertificatesSummary,
  ClassesSummary,
  CoursesSummary,
  PaymentsSummary,
} from "./helpdesk-summaries";
import { Press } from "../components/Press";
import { ANSWERABLE } from "../helpdesk-answerable";
import type { ScreenProps } from "../navigation";
import { contentColumn } from "../responsive";
import { elevatedShadow, spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

const TOPIC_LABEL: Partial<Record<HelpdeskCategory, string>> = {
  ACCESS: STR.helpdesk.menuClasses,
  TECHNICAL: STR.helpdesk.menuCourses,
  BILLING: STR.helpdesk.menuPayments,
  CERTIFICATE: STR.helpdesk.menuCertificates,
  ACCOUNT: STR.helpdesk.menuAccount,
};

export function HelpdeskAnswerScreen({
  route,
  navigation,
}: ScreenProps<"HelpdeskAnswer">) {
  const styles = useStyles(makeStyles);
  const { mode } = useTheme();
  const { category } = route.params;

  // Count a self-serve view only once the answer knows it actually had
  // something to say — an empty card is not a deflection.
  const onAnswered = (hadData: boolean) => {
    if (hadData) api.helpdeskStatEvent(category, "cardView");
  };

  const related = ANSWERABLE.filter((c) => c !== category);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={[styles.card, elevatedShadow(mode)]}>
        <Text style={styles.eyebrow}>{STR.helpdesk.fromYourAccount}</Text>
        {category === "ACCESS" && <ClassesSummary onAnswered={onAnswered} />}
        {category === "TECHNICAL" && <CoursesSummary onAnswered={onAnswered} />}
        {category === "BILLING" && (
          <PaymentsSummary navigation={navigation} onAnswered={onAnswered} />
        )}
        {category === "CERTIFICATE" && (
          <CertificatesSummary onAnswered={onAnswered} />
        )}
        {category === "ACCOUNT" && <AccountSummary onAnswered={onAnswered} />}
      </View>

      {related.length > 0 && (
        <>
          <Text style={styles.section}>{STR.helpdesk.relatedHeading}</Text>
          <View style={styles.chipRow}>
            {related.map((c) => (
              <Press
                key={c}
                style={styles.chip}
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
                <Text style={styles.chipText}>{TOPIC_LABEL[c]}</Text>
              </Press>
            ))}
          </View>
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
    // Elevated + roomier than a menu row, with the accent hairline on top:
    // the one card on the screen that holds CONTENT.
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
