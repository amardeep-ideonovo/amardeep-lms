import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { InvoiceDTO } from "@lms/types";

import { api } from "../api";
import { Chip } from "../components/Chip";
import { EmptyState, ErrorState } from "../components/Screen";
import { Skeleton } from "../components/Skeleton";
import { fmtDate, money } from "../format";
import type { ScreenProps } from "../navigation";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";

function InvoiceRow({ inv }: { inv: InvoiceDTO }) {
  const styles = useStyles(makeStyles);
  const receiptUrl = inv.hostedInvoiceUrl;
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
  // null = still loading (skeleton rows instead of a spinner).
  const [invoices, setInvoices] = useState<InvoiceDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setInvoices(null);
    setError(null);
    try {
      setInvoices(await api.myInvoices());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your payments.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (invoices === null) {
    return (
      <View style={styles.skeletons}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={76} radius={12} style={styles.skeletonRow} />
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
    />
  );
}

const makeStyles = ({ colors }: Theme) => StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
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
  date: { color: colors.text, fontSize: 15, fontWeight: "600" },
  desc: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  rowRight: { alignItems: "flex-end", gap: spacing.xs },
  amount: { color: colors.text, fontSize: 15, fontWeight: "700" },
  receipt: { color: colors.primarySoft, fontSize: 13, fontWeight: "600" },
});
