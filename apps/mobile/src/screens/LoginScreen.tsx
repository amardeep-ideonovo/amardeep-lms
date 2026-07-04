import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Press } from "../components/Press";
import { IS_LOCKED_BUILD, WEB_BASE_URL, unbindInstance } from "../config";
import { useAppConfig } from "../config-provider";
import type { AuthScreenProps } from "../navigation";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

type Props = AuthScreenProps<"Login">;

export function LoginScreen({ navigation }: Props) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const { config } = useAppConfig();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

  async function onSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.login(email.trim(), password);
      // Storing the token flips the auth gate -> the Dashboard stack mounts.
      await signIn(res.token);
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 401
          ? "Invalid email or password."
          : e instanceof Error
            ? e.message
            : "Something went wrong.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.container}>
          {config.logoUrl ? (
            <Image
              source={{ uri: config.logoUrl }}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel={config.title}
            />
          ) : (
            <Text style={styles.brand}>{config.title}</Text>
          )}
          {config.tagline ? (
            <Text style={styles.tagline}>{config.tagline}</Text>
          ) : null}
          <Text style={styles.subtitle}>Sign in to your membership</Text>

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            value={email}
            onChangeText={setEmail}
            editable={!submitting}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            textContentType="password"
            value={password}
            onChangeText={setPassword}
            editable={!submitting}
            onSubmitEditing={onSubmit}
            returnKeyType="go"
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Press
            style={[styles.button, !canSubmit && styles.buttonDisabled]}
            onPress={onSubmit}
            disabled={!canSubmit}
          >
            {submitting ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Press>

          {/* Password reset is web-only by policy (like billing/account), so
              this opens the member site's forgot-password page in the browser.
              WEB_BASE_URL is a live binding — empty only when no instance is
              bound yet, in which case the link is hidden. */}
          {WEB_BASE_URL ? (
            <TouchableOpacity
              onPress={() =>
                void Linking.openURL(`${WEB_BASE_URL}/forgot-password`).catch(
                  () => undefined,
                )
              }
              activeOpacity={0.7}
              style={styles.linkButton}
            >
              <Text style={styles.linkText}>
                Forgot your password?{" "}
                <Text style={styles.linkTextStrong}>Reset it</Text>
              </Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            onPress={() => navigation.navigate("Signup")}
            activeOpacity={0.7}
            style={styles.linkButton}
          >
            <Text style={styles.linkText}>
              New here?{" "}
              <Text style={styles.linkTextStrong}>Create an account</Text>
            </Text>
          </TouchableOpacity>

          {!IS_LOCKED_BUILD && (
            <TouchableOpacity
              onPress={() => void unbindInstance()}
              activeOpacity={0.7}
              style={styles.linkButton}
            >
              <Text style={styles.linkText}>
                Wrong academy?{" "}
                <Text style={styles.linkTextStrong}>Switch academy</Text>
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = ({ colors, fonts }: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  brand: {
    color: colors.text,
    fontSize: 40,
    fontWeight: "800",
    textAlign: "center",
    fontFamily: fonts.display,
  },
  logo: {
    height: 56,
    width: 220,
    alignSelf: "center",
  },
  tagline: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    marginTop: spacing.xs,
    fontFamily: fonts.regular,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 16,
    textAlign: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    fontFamily: fonts.regular,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    fontFamily: fonts.regular,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700", fontFamily: fonts.bold },
  error: { color: colors.danger, marginBottom: spacing.sm, textAlign: "center", fontFamily: fonts.regular },
  linkButton: { marginTop: spacing.lg, alignItems: "center" },
  linkText: { color: colors.textMuted, fontSize: 14, fontFamily: fonts.regular },
  linkTextStrong: { color: colors.primary, fontWeight: "700", fontFamily: fonts.bold },
});
