import React, { useCallback, useState } from "react";
import {
  FlatList,
  Linking,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { InvoiceDTO } from "@lms/types";

import { useMyInvoices } from "../queries";
import { Chip } from "../components/Chip";
import { EmptyState, ErrorState } from "../components/Screen";
import { Skeleton } from "../components/Skeleton";
import { fmtDate, money } from "../format";
import type { ScreenProps } from "../navigation";
import { contentColumn } from "../responsive";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";

function InvoiceRow({ inv }: { inv: InvoiceDTO }) {
  const styles = useStyles(makeStyles);
  // PAID invoices only: an OPEN invoice's hosted page carries a live "Pay"
  // button, which would make this link an in-app path to a web payment
  // (Apple 3.1.1 / Play payments). A settled receipt is just a record.
  const receiptUrl = inv.status === "paid" ? inv.hostedInvoiceUrl : null;
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.date}>{fmtDate(inv.created)}</Text>
        <Text style={styles.desc} numberOfLines={2}>
          {inv.description ?? "—"}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.amount}>
          {money(inv.amountPaid || inv.amountDue, inv.currency)}
        </Text>
        <Chip
          label={inv.status}
          tone={
            inv.status === "paid"
              ? "success"
              : inv.status === "open"
                ? "warning"
                : "default"
          }
        />
        {receiptUrl ? (
          <TouchableOpacity
            onPress={() => Linking.openURL(receiptUrl).catch(() => {})}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text style={styles.receipt}>Receipt ↗</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

export function PaymentsScreen(_props: ScreenProps<"Payments">) {
  const styles = useStyles(makeStyles);
  // react-query keeps the rendered rows across refetches, so a pull-to-refresh
  // never drops the list back to skeletons and a refetch that FAILS leaves them
  // alone instead of swapping in an error page — the old loadedOnce guard, now
  // for free. null = nothing fetched yet (skeleton rows instead of a spinner).
  const invoicesQuery = useMyInvoices();
  const invoices: InvoiceDTO[] | null = invoicesQuery.data ?? null;

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invoicesQuery.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [invoicesQuery]);

  // Error page only before the first success (and skeletons during the retry).
  if (invoicesQuery.isError && invoices === null && !invoicesQuery.isFetching)
    return (
      <ErrorState
        message={
          invoicesQuery.error instanceof Error
            ? invoicesQuery.error.message
            : "Could not load your payments."
        }
        onRetry={() => invoicesQuery.refetch()}
      />
    );
  if (invoices === null) {
    return (
      <View style={styles.skeletons}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton
            key={i}
            height={76}
            radius={12}
            style={styles.skeletonRow}
          />
        ))}
      </View>
    );
  }
  if (invoices.length === 0) return <EmptyState message="No payments yet." />;

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={invoices}
      keyExtractor={(inv) => inv.id}
      renderItem={({ item }) => <InvoiceRow inv={item} />}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    />
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    list: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.md, ...contentColumn },
    skeletons: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
    skeletonRow: { marginBottom: spacing.sm },
    row: {
      flexDirection: "row",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 12,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    rowLeft: { flex: 1, paddingRight: spacing.sm },
    date: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "600",
      fontFamily: fonts.semibold,
    },
    desc: {
      color: colors.textMuted,
      fontSize: 13,
      marginTop: spacing.xs,
      fontFamily: fonts.regular,
    },
    rowRight: { alignItems: "flex-end", gap: spacing.xs },
    amount: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "700",
      fontFamily: fonts.bold,
    },
    receipt: {
      color: colors.primarySoft,
      fontSize: 13,
      fontWeight: "600",
      fontFamily: fonts.semibold,
    },
  });
