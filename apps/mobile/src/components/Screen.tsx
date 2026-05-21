import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { colors, spacing } from "../theme";

export function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.center}>{children}</View>;
}

export function Loading() {
  return (
    <Centered>
      <ActivityIndicator size="large" color={colors.primary} />
    </Centered>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Centered>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry ? (
        <TouchableOpacity style={styles.retry} onPress={onRetry} activeOpacity={0.8}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      ) : null}
    </Centered>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <Centered>
      <Text style={styles.emptyText}>{message}</Text>
    </Centered>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: colors.bg,
  },
  errorText: {
    color: colors.danger,
    fontSize: 15,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  emptyText: { color: colors.textMuted, fontSize: 15, textAlign: "center" },
  retry: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryText: { color: colors.text, fontWeight: "600" },
});
