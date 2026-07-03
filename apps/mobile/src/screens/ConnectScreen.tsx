import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  DIRECTORY_URL,
  bindInstance,
  type InstanceBinding,
} from "../config";
import { DEFAULT_APP_CONFIG, paletteFrom, fonts, spacing } from "../theme";

// First-run screen of the SHARED app: turns a client's connect code (their
// instance subdomain or id, shown on their license portal) into an instance
// binding via the licensing control plane's public resolver. White-label /
// locked builds never see this screen. Uses the default (unbranded) palette —
// the instance's own branding takes over right after connecting.
export function ConnectScreen({
  onConnected,
}: {
  onConnected: (b: InstanceBinding) => void;
}) {
  const colors = useMemo(
    () => paletteFrom(DEFAULT_APP_CONFIG.dark, "dark"),
    [],
  );
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [code, setCode] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [advanced, setAdvanced] = useState(!DIRECTORY_URL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Validate a binding by fetching the instance's public branding config —
  // proves the URL is a live LMS API before we commit to it. Timed out so a
  // black-holing host doesn't hang the button forever.
  const validateAndBind = async (b: InstanceBinding) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(`${b.apiUrl.replace(/\/$/, "")}/app/config`, {
        signal: ctrl.signal,
      });
    } catch {
      throw new Error("Couldn't reach that academy. Check the details and try again.");
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) throw new Error("That server doesn't look like an academy.");
    const cfg = (await res.json()) as { title?: string };
    const bound: InstanceBinding = { ...b, name: cfg.title ?? b.name };
    await bindInstance(bound);
    onConnected(bound);
  };

  const connectByCode = async () => {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(
        `${DIRECTORY_URL}/api/app/resolve?code=${encodeURIComponent(trimmed)}`,
        { signal: ctrl.signal },
      );
      if (res.status === 404) {
        throw new Error("No academy found for that code. Check it and try again.");
      }
      if (res.status === 429) {
        throw new Error("Too many attempts. Please wait a minute and try again.");
      }
      if (!res.ok) throw new Error("Could not reach the directory. Try again.");
      const data = (await res.json()) as {
        name: string;
        apiUrl: string;
        webUrl: string;
      };
      await validateAndBind({ ...data, code: trimmed });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
    } finally {
      clearTimeout(t);
      setBusy(false);
    }
  };

  const connectByUrl = async () => {
    const trimmed = serverUrl.trim().replace(/\/$/, "");
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const apiUrl = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
      // Without the directory we don't know the member website URL; default to
      // the API origin (account links degrade gracefully). Dev/self-host path.
      await validateAndBind({ apiUrl, webUrl: apiUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.body}>
        <Text style={styles.title}>Connect your academy</Text>
        <Text style={styles.subtitle}>
          {advanced
            ? "Enter your academy's server address."
            : "Enter the connect code from your academy's welcome email or member website."}
        </Text>

        {!advanced ? (
          <>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="e.g. spotlight-academy"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              editable={!busy}
              onSubmitEditing={connectByCode}
              returnKeyType="go"
            />
            <Pressable
              onPress={connectByCode}
              disabled={busy || !code.trim()}
              style={[styles.button, (busy || !code.trim()) && styles.buttonDisabled]}
            >
              {busy ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.buttonText}>Connect</Text>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <TextInput
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="https://academy-api.example.com"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.input}
              editable={!busy}
              onSubmitEditing={connectByUrl}
              returnKeyType="go"
            />
            <Pressable
              onPress={connectByUrl}
              disabled={busy || !serverUrl.trim()}
              style={[styles.button, (busy || !serverUrl.trim()) && styles.buttonDisabled]}
            >
              {busy ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.buttonText}>Connect to server</Text>
              )}
            </Pressable>
          </>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        {!!DIRECTORY_URL && (
          <Pressable
            onPress={() => {
              setAdvanced((a) => !a);
              setError(null);
            }}
            style={styles.linkButton}
            disabled={busy}
          >
            <Text style={styles.linkText}>
              {advanced ? "Use a connect code instead" : "Advanced: connect by server URL"}
            </Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

type Colors = ReturnType<typeof paletteFrom>;

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    body: { flex: 1, justifyContent: "center", padding: spacing.lg },
    title: {
      color: colors.text,
      fontSize: 28,
      textAlign: "center",
      fontFamily: fonts.display,
    },
    subtitle: {
      color: colors.textMuted,
      fontSize: 14,
      textAlign: "center",
      marginTop: spacing.sm,
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
    },
    buttonDisabled: { opacity: 0.5 },
    buttonText: {
      color: colors.onPrimary,
      fontSize: 16,
      fontFamily: fonts.bold,
    },
    error: {
      color: colors.danger,
      marginTop: spacing.md,
      textAlign: "center",
      fontFamily: fonts.regular,
    },
    linkButton: { marginTop: spacing.lg, alignItems: "center" },
    linkText: { color: colors.textMuted, fontSize: 14, fontFamily: fonts.regular },
  });
