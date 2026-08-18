import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { STR } from "@lms/types";

import { Button } from "./Button";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

export function Centered({ children }: { children: React.ReactNode }) {
  const styles = useStyles(makeStyles);
  return <View style={styles.center}>{children}</View>;
}

export function Loading() {
  const { colors } = useTheme();
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
  const styles = useStyles(makeStyles);
  return (
    <Centered>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry ? (
        <Button
          variant="secondary"
          label={STR.common.retry}
          onPress={onRetry}
          // Centered under the error text — Button's default alignSelf:flex-start
          // would otherwise pin it to the left of the Centered container.
          style={{ alignSelf: "center" }}
        />
      ) : null}
    </Centered>
  );
}

export function EmptyState({ message }: { message: string }) {
  const styles = useStyles(makeStyles);
  return (
    <Centered>
      <Text style={styles.emptyText}>{message}</Text>
    </Centered>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
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
      fontFamily: fonts.regular,
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 15,
      textAlign: "center",
      fontFamily: fonts.regular,
    },
  });
