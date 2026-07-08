// Sign in — Ink Hero: full ink chrome canvas, brand block, floating light
// card with the form, teal gradient CTA. Links on the ink use the on-dark
// accent.
import React, { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { CtaButton } from "../components/CtaButton";
import { SpotlightMark } from "../components/SpotlightMark";
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
      // Storing the token flips the auth gate -> the Home stack mounts.
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
      {/* The whole screen sits on ink chrome — light status icons. */}
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brandBlock}>
            {config.logoUrl ? (
              <Image
                source={{ uri: config.logoUrl }}
                style={styles.logo}
                resizeMode="contain"
                accessibilityLabel={config.title}
              />
            ) : (
              <View style={styles.brandRow}>
                <SpotlightMark size={26} />
                <Text style={styles.brand}>{config.title}</Text>
              </View>
            )}
            {config.tagline ? (
              <Text style={styles.tagline}>{config.tagline}</Text>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Welcome back</Text>
            <Text style={styles.cardSub}>Sign in to your membership</Text>

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

            <CtaButton
              style={styles.button}
              label="Sign in"
              textStyle={styles.buttonText}
              disabled={!canSubmit}
              busy={submitting}
              onPress={onSubmit}
            />
          </View>

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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = ({ colors, fonts }: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.chrome },
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  brandBlock: { alignItems: "center", marginBottom: spacing.lg },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brand: {
    color: "#ffffff",
    fontSize: 26,
    fontFamily: fonts.bold,
    textAlign: "center",
  },
  logo: {
    height: 56,
    width: 220,
    alignSelf: "center",
  },
  tagline: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    textAlign: "center",
    marginTop: spacing.sm,
    fontFamily: fonts.regular,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: spacing.lg,
    shadowColor: "#140f2d",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 10,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 18,
    fontFamily: fonts.bold,
  },
  cardSub: {
    color: colors.textMuted,
    fontSize: 12.5,
    marginTop: 2,
    marginBottom: spacing.md,
    fontFamily: fonts.regular,
  },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
    marginBottom: spacing.md - 4,
    fontFamily: fonts.regular,
  },
  button: { marginTop: spacing.xs },
  buttonText: { fontSize: 14, fontFamily: fonts.bold },
  error: {
    color: colors.danger,
    marginBottom: spacing.sm,
    textAlign: "center",
    fontFamily: fonts.regular,
  },
  linkButton: { marginTop: spacing.lg, alignItems: "center" },
  linkText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13.5,
    fontFamily: fonts.regular,
  },
  linkTextStrong: { color: colors.primaryOnDark, fontFamily: fonts.bold },
});
