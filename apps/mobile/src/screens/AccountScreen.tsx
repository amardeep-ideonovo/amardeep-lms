import React, { useState } from "react";
import {
  Alert,
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useAuth } from "../auth";
import { useAppConfig } from "../config-provider";
import type { ScreenProps } from "../navigation";
import { WEB_ACCOUNT_URL } from "../config";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";

export function AccountScreen(_props: ScreenProps<"Account">) {
  const styles = useStyles(makeStyles);
  const { config } = useAppConfig();
  const { signOut } = useAuth();
  const [opening, setOpening] = useState(false);

  async function openWebAccount() {
    setOpening(true);
    try {
      const supported = await Linking.canOpenURL(WEB_ACCOUNT_URL);
      if (!supported) throw new Error("unsupported");
      await Linking.openURL(WEB_ACCOUNT_URL);
    } catch {
      Alert.alert(
        "Couldn't open the browser",
        `Manage your account at:\n${WEB_ACCOUNT_URL}`
      );
    } finally {
      setOpening(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.brandHeader}>
        {config.logoUrl ? (
          <Image
            source={{ uri: config.logoUrl }}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel={config.title}
          />
        ) : (
          <Text style={styles.brandTitle}>{config.title}</Text>
        )}
        {config.description ? (
          <Text style={styles.brandDesc}>{config.description}</Text>
        ) : null}
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>Billing & account</Text>
        <Text style={styles.note}>
          To keep things simple and to follow App Store and Google Play rules,
          subscriptions and payment details are managed on our website.
        </Text>
        <Text style={styles.note}>
          You can change your plan, update your card, or cancel from your account
          page in the browser.
        </Text>

        <TouchableOpacity
          style={styles.button}
          onPress={openWebAccount}
          disabled={opening}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>
            {opening ? "Opening…" : "Manage account on the web"}
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.signOut} onPress={signOut} activeOpacity={0.8}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = ({ colors }: Theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  brandHeader: {
    alignItems: "center",
    paddingVertical: spacing.lg,
  },
  logo: {
    height: 48,
    width: 200,
  },
  brandTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "800",
  },
  brandDesc: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.lg,
  },
  heading: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: spacing.md,
  },
  note: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: "700" },
  signOut: {
    marginTop: spacing.lg,
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  signOutText: { color: colors.danger, fontSize: 16, fontWeight: "600" },
});
