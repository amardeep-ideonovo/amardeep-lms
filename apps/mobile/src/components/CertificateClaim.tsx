import React, { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { ClassCertificateStatusDTO, MyCertificateDTO } from "@lms/types";
import { STR } from "@lms/types";
import {
  api,
  certificateDownloadUrl,
  certificateFileName,
  downloadAndShareFile,
} from "../api";
import { Button } from "./Button";
import { CtaButton } from "./CtaButton";
import { useStyles, useTheme } from "../theme-provider";
import { formColumn } from "../responsive";
import { spacing, type Theme } from "../theme";

// "Get certificate" / "Download certificate" — RN twin of the web component.
// Shown on the final lesson of a completed class and on the class screen.
// The PDF opens in the device browser via the ?token= download URL (same
// contract as lesson-note downloads). When the profile has no name a small
// modal asks for the exact name to print (snapshotted server-side).
export default function CertificateClaim({
  status,
}: {
  status: ClassCertificateStatusDTO;
}) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const [cert, setCert] = useState<MyCertificateDTO | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askName, setAskName] = useState(false);
  const [name, setName] = useState("");

  const claimed = status.claimed || !!cert;
  const serial = cert?.serial ?? status.serial;

  if (!status.eligible && !claimed) return null;

  async function openPdf(c: MyCertificateDTO) {
    if (Platform.OS === "ios") {
      // Header-auth download + native share sheet — no token in the URL.
      await downloadAndShareFile({
        downloadPath: c.downloadUrl,
        fileName: certificateFileName(c),
      });
      return;
    }
    await Linking.openURL(await certificateDownloadUrl(c));
  }

  async function claim(withName?: string) {
    setClaiming(true);
    setError(null);
    try {
      const issued = await api.claimCertificate({
        levelId: status.levelId,
        ...(withName ? { name: withName } : {}),
      });
      setCert(issued);
      setAskName(false);
      await openPdf(issued);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not issue the certificate.",
      );
    } finally {
      setClaiming(false);
    }
  }

  async function download() {
    setClaiming(true);
    setError(null);
    try {
      // claim() is idempotent — it returns the existing certificate when the
      // member already earned it (e.g. claimed on the web earlier).
      const c =
        cert ?? (await api.claimCertificate({ levelId: status.levelId }));
      setCert(c);
      await openPdf(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <View style={styles.wrap}>
      {claimed ? (
        <>
          <CtaButton
            label="Download certificate"
            onPress={download}
            busy={claiming}
            style={{ alignSelf: "stretch" }}
          />
          {serial ? <Text style={styles.serial}>{serial}</Text> : null}
        </>
      ) : (
        <CtaButton
          label="🎓 Get certificate"
          onPress={() => (status.needsName ? setAskName(true) : claim())}
          busy={claiming}
          style={{ alignSelf: "stretch" }}
        />
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* One-time "name on certificate" prompt (profile name is blank). */}
      <Modal visible={askName} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Name on your certificate</Text>
            <Text style={styles.modalSub}>
              This is printed on the PDF exactly as typed.
            </Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Your full name"
              placeholderTextColor={colors.textMuted}
              maxLength={120}
              autoFocus
            />
            <View style={styles.modalRow}>
              <TouchableOpacity
                style={[styles.button, styles.modalBtn]}
                disabled={claiming || !name.trim()}
                onPress={() => claim(name.trim())}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                {claiming ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Text style={styles.buttonText}>Issue</Text>
                )}
              </TouchableOpacity>
              <Button
                variant="ghost"
                label={STR.common.cancel}
                onPress={() => setAskName(false)}
                style={styles.modalBtn}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    wrap: { marginTop: spacing.md },
    button: {
      backgroundColor: colors.primary,
      borderRadius: 11,
      paddingVertical: 13,
      alignItems: "center",
    },
    buttonText: {
      color: colors.onPrimary,
      fontSize: 15.5,
      fontWeight: "700",
      fontFamily: fonts.bold,
    },
    serial: {
      color: colors.textMuted,
      fontSize: 12.5,
      marginTop: 6,
      textAlign: "center",
      fontFamily: fonts.regular,
    },
    error: {
      color: colors.danger,
      marginTop: 8,
      fontSize: 13.5,
      fontFamily: fonts.regular,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      justifyContent: "center",
      padding: spacing.lg,
    },
    modalCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
      ...formColumn,
    },
    modalTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "700",
      fontFamily: fonts.bold,
    },
    modalSub: {
      color: colors.textMuted,
      fontSize: 13,
      marginTop: 4,
      marginBottom: 12,
      fontFamily: fonts.regular,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      color: colors.text,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15.5,
      fontFamily: fonts.regular,
      marginBottom: 12,
    },
    modalRow: { flexDirection: "row", gap: 10 },
    modalBtn: { flex: 1 },
  });
