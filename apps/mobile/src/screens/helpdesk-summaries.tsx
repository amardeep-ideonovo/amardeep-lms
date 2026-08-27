// Read-only account summaries the helpdesk shows INLINE when a member opens a
// topic — the "answer in the chat" half of the conversational rework. Each is a
// child of the topic accordion, so its query only fires when the topic is
// expanded (no fetch on screen mount). No navigation: the one exception is the
// past-due "fix payment" pointer, the single remediation escape hatch.
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { STR } from "@lms/types";
import type { SubscriptionDetailDTO } from "@lms/types";

import {
  useCourses,
  useMyClasses,
  useMyInvoices,
  useMySubscriptionDetails,
} from "../queries";
import { fmtDate, money } from "../format";
import { CtaButton } from "../components/CtaButton";
import { Skeleton } from "../components/Skeleton";
import type { ScreenProps } from "../navigation";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";

type Nav = ScreenProps<"HelpdeskHome">["navigation"];

/** Reported once a summary settles: did it actually answer anything? An empty
 *  card is not a self-serve success, and counting it as one inflates the
 *  deflection rate precisely for the members who were helped least. */
export type OnAnswered = (hadData: boolean) => void;

/** Fire `onAnswered` once the query settles, never while still loading. */
function useAnswered(
  onAnswered: OnAnswered | undefined,
  settled: boolean,
  hadData: boolean,
) {
  useEffect(() => {
    if (settled) onAnswered?.(hadData);
  }, [onAnswered, settled, hadData]);
}

/** A member's genuinely stuck state — the only place a pointer is kept. */
function pastDueSub(
  subs: SubscriptionDetailDTO[] | undefined,
): SubscriptionDetailDTO | null {
  return (
    (subs ?? []).find((s) => s.status?.toLowerCase() === "past_due") ?? null
  );
}

function SummarySkeleton() {
  return (
    <View style={{ gap: spacing.xs }}>
      <Skeleton height={16} radius={6} />
      <Skeleton height={16} radius={6} />
    </View>
  );
}

export function ClassesSummary({ onAnswered }: { onAnswered?: OnAnswered }) {
  const styles = useStyles(makeStyles);
  const classesQ = useMyClasses();
  const subsQ = useMySubscriptionDetails();
  const owned0 = (classesQ.data ?? []).filter((c) => c.owned);
  useAnswered(onAnswered, !classesQ.isPending, owned0.length > 0);

  if (classesQ.isPending) return <SummarySkeleton />;
  // A failed lookup is NOT "you have none" — saying so to a paying member is
  // worse than admitting we could not load it.
  if (classesQ.isError)
    return <Text style={styles.alert}>{STR.errors.generic}</Text>;

  const owned = (classesQ.data ?? []).filter((c) => c.owned);
  const pastDue = pastDueSub(subsQ.data);
  // Past-due is checked BEFORE the empty case: a locked-out member often has
  // zero *owned* rows, and telling them they never bought anything is wrong.
  if (owned.length === 0 && !pastDue)
    return <Text style={styles.muted}>{STR.helpdesk.summaryNoClasses}</Text>;
  return (
    <View style={styles.block}>
      {pastDue && (
        <Text style={styles.alert}>
          {STR.helpdesk.pastDueLocked(pastDue.levelName)}
        </Text>
      )}
      <Text style={styles.lead}>
        {STR.helpdesk.summaryClassesCount(owned.length)}
      </Text>
      {owned.map((c) => (
        <View key={c.id} style={styles.row}>
          <Text style={styles.rowName} numberOfLines={1}>
            {c.name}
          </Text>
          {c.progress && c.progress.total > 0 && (
            <Text style={styles.rowMeta}>
              {c.progress.completed}/{c.progress.total}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

export function CoursesSummary({ onAnswered }: { onAnswered?: OnAnswered }) {
  const styles = useStyles(makeStyles);
  const coursesQ = useCourses();
  useAnswered(
    onAnswered,
    !coursesQ.isPending,
    (coursesQ.data ?? []).some((c) => !c.locked && c.lessonCount > 0),
  );

  if (coursesQ.isPending) return <SummarySkeleton />;
  if (coursesQ.isError)
    return <Text style={styles.alert}>{STR.errors.generic}</Text>;
  const mine = (coursesQ.data ?? []).filter(
    (c) => !c.locked && c.lessonCount > 0,
  );
  if (mine.length === 0)
    return <Text style={styles.muted}>{STR.helpdesk.summaryNoCourses}</Text>;

  return (
    <View style={styles.block}>
      {mine.map((c) => (
        <View key={c.id} style={styles.row}>
          <Text style={styles.rowName} numberOfLines={1}>
            {c.title}
          </Text>
          <Text style={styles.rowMeta}>
            {STR.helpdesk.summaryCourseProgress(
              c.completedCount,
              c.lessonCount,
            )}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function PaymentsSummary({
  navigation,
  onAnswered,
}: {
  navigation: Nav;
  onAnswered?: OnAnswered;
}) {
  const styles = useStyles(makeStyles);
  const invoicesQ = useMyInvoices();
  const subsQ = useMySubscriptionDetails();
  useAnswered(
    onAnswered,
    !invoicesQ.isPending && !subsQ.isPending,
    (invoicesQ.data ?? []).length > 0 || (subsQ.data ?? []).length > 0,
  );

  if (invoicesQ.isPending || subsQ.isPending) return <SummarySkeleton />;
  if (invoicesQ.isError && subsQ.isError)
    return <Text style={styles.alert}>{STR.errors.generic}</Text>;
  const subs = subsQ.data ?? [];
  const pastDue = pastDueSub(subs);

  // The one carve-out: a locked member gets a single remediation pointer.
  if (pastDue) {
    return (
      <View style={styles.block}>
        <Text style={styles.alert}>
          {STR.helpdesk.pastDueLocked(pastDue.levelName)}
        </Text>
        <CtaButton
          label={STR.helpdesk.fixPayment}
          onPress={() => navigation.navigate("Payments")}
          style={styles.fixBtn}
        />
      </View>
    );
  }

  const lastPaid = (invoicesQ.data ?? []).find((i) => i.status === "paid");
  const active = subs.find((s) => s.status?.toLowerCase() === "active");
  if (!lastPaid && subs.length === 0)
    return <Text style={styles.muted}>{STR.helpdesk.summaryNoPayments}</Text>;

  return (
    <View style={styles.block}>
      {lastPaid ? (
        <Text style={styles.lead}>
          {STR.helpdesk.summaryLastPayment(
            money(lastPaid.amountPaid, lastPaid.currency),
            lastPaid.description ?? STR.helpdesk.membershipItem,
            fmtDate(lastPaid.created),
          )}
        </Text>
      ) : (
        <Text style={styles.muted}>{STR.helpdesk.summaryNoPayments}</Text>
      )}
      {active?.currentPeriodEnd && (
        <Text style={styles.line}>
          {STR.helpdesk.summaryNextBilling(fmtDate(active.currentPeriodEnd))}
        </Text>
      )}
      {active && (
        <Text style={styles.line}>{STR.helpdesk.membershipActive}</Text>
      )}
    </View>
  );
}

function makeStyles({ colors, fonts }: Theme) {
  return StyleSheet.create({
    block: { gap: spacing.xs },
    lead: {
      color: colors.text,
      fontFamily: fonts.semibold,
      fontSize: 14,
      lineHeight: 20,
    },
    line: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 19,
    },
    muted: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 19,
    },
    alert: {
      color: colors.danger,
      fontFamily: fonts.medium,
      fontSize: 13,
      lineHeight: 19,
    },
    row: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.sm,
    },
    rowName: {
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 14,
      flexShrink: 1,
    },
    rowMeta: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: 12,
      flexShrink: 0,
    },
    fixBtn: { alignSelf: "flex-start", marginTop: spacing.xs },
  });
}
