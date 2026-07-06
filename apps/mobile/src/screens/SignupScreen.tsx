// Create account — Ink Hero: same ink canvas + floating light card + teal
// gradient CTA as the sign-in screen.
import React, { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
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
import { useAppConfig } from "../config-provider";
import type { AuthScreenProps } from "../navigation";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

type Props = AuthScreenProps<"Signup">;

export function SignupScreen({ navigation }: Props) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const { config } = useAppConfig();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    email.trim().length > 0 &&
    password.length >= 10 &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    !submitting;

  async function onSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.signup({
        email: email.trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        inviteCode: inviteCode.trim() || undefined,
      });
      // Same as login — flipping the auth gate mounts the Home stack.
      await signIn(res.token);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 409) {
          setError(
            "An account with this email already exists. Try signing in."
          );
        } else if (e.status === 403) {
          setError("That invite code isn't valid.");
        } else {
          setError(e.message);
        }
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("Something went wrong.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
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
                <SpotlightMark size={24} />
                <Text style={styles.brand}>{config.title}</Text>
              </View>
            )}
            {config.tagline ? (
              <Text style={styles.tagline}>{config.tagline}</Text>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Create your account</Text>
            <Text style={styles.cardSub}>Join and start learning today</Text>

            <TextInput
              style={styles.input}
              placeholder="First name"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
              value={firstName}
              onChangeText={setFirstName}
              editable={!submitting}
            />
            <TextInput
              style={styles.input}
              placeholder="Last name"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
              value={lastName}
              onChangeText={setLastName}
              editable={!submitting}
            />
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
              placeholder="Password (10+ characters)"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              textContentType="newPassword"
              value={password}
              onChangeText={setPassword}
              editable={!submitting}
            />
            <TextInput
              style={styles.input}
              placeholder="Phone (optional)"
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              value={phone}
              onChangeText={setPhone}
              editable={!submitting}
            />
            <TextInput
              style={styles.input}
              placeholder="Invite code (if you have one)"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              value={inviteCode}
              onChangeText={setInviteCode}
              editable={!submitting}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <CtaButton
              style={styles.button}
              label="Create account"
              textStyle={styles.buttonText}
              disabled={!canSubmit}
              busy={submitting}
              onPress={onSubmit}
            />
          </View>

          <TouchableOpacity
            onPress={() => navigation.navigate("Login")}
            activeOpacity={0.7}
            style={styles.linkButton}
          >
            <Text style={styles.linkText}>
              Already a member? <Text style={styles.linkTextStrong}>Sign in</Text>
            </Text>
          </TouchableOpacity>
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
    fontSize: 24,
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
