// Create account — Ink Hero: same ink canvas + floating light card + teal
// gradient CTA as the sign-in screen.
import React, { useEffect, useState } from "react";
import {
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
import { PASSWORD_MIN, STR } from "@lms/types";

import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { AuthBrand } from "../components/AuthBrand";
import { legalLinks } from "../config";
import { useAppConfig } from "../config-provider";
import { CtaButton } from "../components/CtaButton";
import type { AuthScreenProps } from "../navigation";
import { formColumn } from "../responsive";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

type Props = AuthScreenProps<"Signup">;

export function SignupScreen({ navigation }: Props) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const { signIn } = useAuth();
  const { config } = useAppConfig();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Show the invite field only when the API's closed-beta gate is on. Default
  // hidden (open signup is the norm); reveal once the public config confirms it.
  const [inviteRequired, setInviteRequired] = useState(false);
  const legal = legalLinks(config);

  useEffect(() => {
    let alive = true;
    api
      .signupConfig()
      .then((c) => alive && setInviteRequired(c.inviteRequired))
      .catch(() => {
        /* config unreachable → leave the field hidden */
      });
    return () => {
      alive = false;
    };
  }, []);

  const canSubmit =
    email.trim().length > 0 &&
    password.length >= PASSWORD_MIN.member &&
    confirmPassword.length > 0 &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    !submitting;

  async function onSubmit() {
    if (!canSubmit) return;
    // Match-check lives client-side, same as the account change-password form.
    if (password !== confirmPassword) {
      setError(STR.errors.passwordsDontMatch);
      return;
    }
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
        // D6: branch on the machine-readable code first; status is the
        // fallback for a fleet API older than the code taxonomy.
        if (e.code === "EMAIL_EXISTS" || e.status === 409) {
          setError(
            "An account with this email already exists. Try signing in.",
          );
        } else if (e.code === "INVALID_INVITE_CODE" || e.status === 403) {
          setError("That invite code isn't valid.");
        } else {
          setError(e.message);
        }
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError(STR.errors.generic);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={colors.onChrome === "#ffffff" ? "light" : "dark"} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <AuthBrand size={24} />

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Create your account</Text>
            <Text style={styles.cardSub}>Join and start learning today</Text>

            <TextInput
              style={styles.input}
              placeholder={STR.labels.firstName}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
              value={firstName}
              onChangeText={setFirstName}
              editable={!submitting}
            />
            <TextInput
              style={styles.input}
              placeholder={STR.labels.lastName}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
              value={lastName}
              onChangeText={setLastName}
              editable={!submitting}
            />
            <TextInput
              style={styles.input}
              placeholder={STR.labels.email}
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
              placeholder={`Password (${PASSWORD_MIN.member}+ characters)`}
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              textContentType="newPassword"
              value={password}
              onChangeText={setPassword}
              editable={!submitting}
            />
            <TextInput
              style={styles.input}
              placeholder={STR.labels.confirmPassword}
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              textContentType="newPassword"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
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
            {inviteRequired && (
              <TextInput
                style={styles.input}
                placeholder="Invite code"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                value={inviteCode}
                onChangeText={setInviteCode}
                editable={!submitting}
              />
            )}

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
            accessibilityRole="button"
            style={styles.linkButton}
          >
            <Text style={styles.linkText}>
              Already a member?{" "}
              <Text style={styles.linkTextStrong}>Sign in</Text>
            </Text>
          </TouchableOpacity>

          {legal ? (
            <Text style={[styles.linkText, styles.legalNote]}>
              By creating an account, you agree to our{" "}
              <Text
                style={styles.linkTextStrong}
                accessibilityRole="link"
                onPress={() =>
                  void Linking.openURL(legal.terms).catch(() => {})
                }
              >
                Terms
              </Text>{" "}
              and{" "}
              <Text
                style={styles.linkTextStrong}
                accessibilityRole="link"
                onPress={() =>
                  void Linking.openURL(legal.privacy).catch(() => {})
                }
              >
                Privacy Policy
              </Text>
              .
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.chrome },
    flex: { flex: 1 },
    container: {
      flexGrow: 1,
      justifyContent: "center",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg,
      ...formColumn,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      padding: spacing.lg,
      // Ink shadow literal kept: same tint as theme.ts elevatedShadow() but a
      // deeper auth-card geometry (offset/opacity/radius differ), so the
      // helper doesn't apply.
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
    legalNote: {
      marginTop: spacing.md,
      textAlign: "center",
      paddingHorizontal: spacing.lg,
    },
    linkButton: { marginTop: spacing.lg, alignItems: "center" },
    linkText: {
      // On the chrome canvas — derive from the (overridable) band color.
      color: colors.onChromeSoft,
      fontSize: 13.5,
      fontFamily: fonts.regular,
    },
    linkTextStrong: { color: colors.onChromeAccent, fontFamily: fonts.bold },
  });
