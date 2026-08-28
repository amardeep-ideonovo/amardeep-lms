// Read-only account answers for the support surfaces.
//
// These render inside the "From your account" card on HelpdeskAnswerScreen, so
// they are styled as DATA, not as menu rows: progress bars instead of "0/5"
// text, a hero amount for the last payment, semantic tints for done/past-due.
// A support answer has to look different from the menu that led to it, or the
// whole surface reads as one undifferentiated stack of white rectangles.
//
// Logic contract (unchanged): each summary reports through `onAnswered` whether
// it actually had data once its query settles — an empty card is not a
// self-serve success and must not count a cardView. Past-due is checked BEFORE
// the empty case, and a failed lookup is an error, never "you have none".
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
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";

/** Only what the past-due pointer actually needs. Typed structurally so the
 *  same summary renders under Support home or an answer screen. */
type Nav = { navigate: (screen: "Payments") => void };

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
    <View style={{ gap: spacing.sm }}>
      <Skeleton height={18} radius={6} />
      <Skeleton height={44} radius={10} />
      <Skeleton height={44} radius={10} />
    </View>
  );
}

/** The visual heart of the redesign: progress as a BAR, not a fraction in
 *  prose. Track in the hairline border tone, fill in the accent, flipping to
 *  the success tone when complete — the state is legible before the numbers. */
function ProgressRow({
  label,
  completed,
  total,
}: {
  label: string;
  completed: number;
  total: number;
}) {
  const styles = useStyles(makeStyles);
  const pct = total > 0 ? Math.min(1, completed / total) : 0;
  const done = total > 0 && completed >= total;
  return (
    <View style={styles.progressRow}>
      <View style={styles.progressHead}>
        <Text style={styles.progressLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.progressMeta, done && styles.progressMetaDone]}>
          {done ? "✓ " : ""}
          {completed}/{total}
        </Text>
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            done && styles.fillDone,
            { width: `${Math.round(pct * 100)}%` },
          ]}
        />
      </View>
    </View>
  );
}

function EmptyNote({ text }: { text: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function ErrorNote() {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.empty}>
      <Text style={styles.errorText}>{STR.errors.generic}</Text>
    </View>
  );
}

function PastDueNote({ name }: { name: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.alertBox}>
      <Text style={styles.alertText}>{STR.helpdesk.pastDueLocked(name)}</Text>
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
  if (classesQ.isError) return <ErrorNote />;

  const owned = owned0;
  const pastDue = pastDueSub(subsQ.data);
  // Past-due is checked BEFORE the empty case: a locked-out member often has
  // zero *owned* rows, and telling them they never bought anything is wrong.
  if (owned.length === 0 && !pastDue)
    return <EmptyNote text={STR.helpdesk.summaryNoClasses} />;

  return (
    <View style={styles.block}>
      {pastDue && <PastDueNote name={pastDue.levelName} />}
      <Text style={styles.lead}>
        {STR.helpdesk.summaryClassesCount(owned.length)}
      </Text>
      {owned.map((c) => (
        <ProgressRow
          key={c.id}
          label={c.name}
          completed={c.progress?.completed ?? 0}
          total={c.progress?.total ?? 0}
        />
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
  if (coursesQ.isError) return <ErrorNote />;
  const mine = (coursesQ.data ?? []).filter(
    (c) => !c.locked && c.lessonCount > 0,
  );
  if (mine.length === 0)
    return <EmptyNote text={STR.helpdesk.summaryNoCourses} />;

  return (
    <View style={styles.block}>
      {mine.map((c) => (
        <ProgressRow
          key={c.id}
          label={c.title}
          completed={c.completedCount}
          total={c.lessonCount}
        />
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
  if (invoicesQ.isError && subsQ.isError) return <ErrorNote />;
  const subs = subsQ.data ?? [];
  const pastDue = pastDueSub(subs);

  // The one carve-out: a locked member gets a single remediation pointer.
  if (pastDue) {
    return (
      <View style={styles.block}>
        <PastDueNote name={pastDue.levelName} />
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
    return <EmptyNote text={STR.helpdesk.summaryNoPayments} />;

  return (
    <View style={styles.block}>
      {lastPaid ? (
        <View>
          {/* Hero number: the fact the member came for, at a glance. */}
          <Text style={styles.amount}>
            {money(lastPaid.amountPaid, lastPaid.currency)}
          </Text>
          <Text style={styles.amountMeta}>
            {lastPaid.description ?? STR.helpdesk.membershipItem} ·{" "}
            {fmtDate(lastPaid.created)}
          </Text>
        </View>
      ) : (
        <EmptyNote text={STR.helpdesk.summaryNoPayments} />
      )}
      {active?.currentPeriodEnd && (
        <View style={styles.factRow}>
          <Text style={styles.factLabel}>
            {STR.helpdesk.summaryNextBilling(fmtDate(active.currentPeriodEnd))}
          </Text>
        </View>
      )}
      {active && (
        <View style={styles.okBox}>
          <Text style={styles.okText}>{STR.helpdesk.membershipActive}</Text>
        </View>
      )}
    </View>
  );
}

function makeStyles({ colors, fonts }: Theme) {
  return StyleSheet.create({
    block: { gap: spacing.sm },
    lead: {
      color: colors.text,
      fontFamily: fonts.semibold,
      fontSize: 15,
      lineHeight: 21,
      marginBottom: 2,
    },

    // ---- progress rows -------------------------------------------------
    progressRow: { gap: 6, paddingVertical: 4 },
    progressHead: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    progressLabel: {
      color: colors.text,
      fontFamily: fonts.medium,
      fontSize: 14.5,
      flexShrink: 1,
    },
    progressMeta: {
      color: colors.textMuted,
      fontFamily: fonts.semibold,
      fontSize: 12,
      flexShrink: 0,
    },
    progressMetaDone: { color: colors.success },
    track: {
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.borderSoft,
      overflow: "hidden",
    },
    fill: {
      height: "100%",
      borderRadius: 3,
      backgroundColor: colors.primary,
    },
    fillDone: { backgroundColor: colors.success },

    // ---- payments hero -------------------------------------------------
    amount: {
      color: colors.text,
      fontFamily: fonts.bold,
      fontSize: 30,
      lineHeight: 36,
      letterSpacing: -0.5,
    },
    amountMeta: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: 13,
      marginTop: 2,
    },
    factRow: {
      borderTopWidth: 1,
      borderTopColor: colors.borderSoft,
      paddingTop: spacing.sm,
    },
    factLabel: {
      color: colors.text,
      fontFamily: fonts.medium,
      fontSize: 13.5,
    },
    okBox: {
      alignSelf: "flex-start",
      backgroundColor: colors.successBg,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    okText: {
      color: colors.success,
      fontFamily: fonts.semibold,
      fontSize: 12.5,
    },

    // ---- states --------------------------------------------------------
    empty: { paddingVertical: spacing.sm, alignItems: "flex-start" },
    emptyText: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: 14,
      lineHeight: 20,
    },
    errorText: {
      color: colors.danger,
      fontFamily: fonts.regular,
      fontSize: 13.5,
    },
    alertBox: {
      backgroundColor: colors.dangerBg,
      borderRadius: 10,
      padding: spacing.sm + 2,
    },
    alertText: {
      color: colors.danger,
      fontFamily: fonts.medium,
      fontSize: 13.5,
      lineHeight: 19,
    },
    fixBtn: { alignSelf: "flex-start", marginTop: spacing.xs },
  });
}
