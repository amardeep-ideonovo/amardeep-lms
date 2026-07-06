// Certificates — Ink Hero (design frame 2n): the newest earned certificate as
// an ink hero card with the teal seal, credential id and View PDF / Share
// actions; older certificates as light rows; then an "In progress" list of
// owned classes with class-colored bars. PDF opening reuses the ?token=
// download contract from the Profile screen (moved here).
import React, { useCallback, useRef, useState } from "react";
import {
  Image,
  Linking,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import type { ClassTileDTO, MyCertificateDTO } from "@lms/types";

import { api, certificateDownloadUrl } from "../api";
import { accentIndexMap, classAccent } from "../class-colors";
import { CtaButton } from "../components/CtaButton";
import { Press } from "../components/Press";
import { ErrorState } from "../components/Screen";
import { Skeleton } from "../components/Skeleton";
import { fmtDate } from "../format";
import type { ScreenProps } from "../navigation";
import { letterGradient, spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

export function CertificatesScreen(_props: ScreenProps<"Certificates">) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();

  const [certs, setCerts] = useState<MyCertificateDTO[] | null>(null);
  const [classes, setClasses] = useState<ClassTileDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [certRes, clsRes] = await Promise.all([
        api.myCertificates(),
        api.myClasses().catch(() => [] as ClassTileDTO[]),
      ]);
      // Newest first — the hero card is the latest achievement.
      setCerts(
        [...certRes].sort(
          (a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt)
        )
      );
      setClasses(clsRes);
      loadedOnce.current = true;
    } catch {
      if (!loadedOnce.current) setError("Could not load your certificates.");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Opens the access-checked PDF in the device browser (?token= URL — same
  // contract as lesson notes).
  const openPdf = useCallback(async (c: MyCertificateDTO) => {
    setActionError(null);
    try {
      const url = await certificateDownloadUrl(c);
      await Linking.openURL(url);
    } catch {
      setActionError("Could not open the certificate PDF.");
    }
  }, []);

  const sharePdf = useCallback(async (c: MyCertificateDTO) => {
    setActionError(null);
    try {
      const url = await certificateDownloadUrl(c);
      await Share.share({
        message: `${c.className} — Certificate of Completion (${c.serial})\n${url}`,
      });
    } catch {
      // user dismissed the share sheet — nothing to report
    }
  }, []);

  if (error) return <ErrorState message={error} onRetry={load} />;

  if (!certs) {
    return (
      <View style={styles.skeletonWrap}>
        <Skeleton height={210} radius={18} />
        <Skeleton height={64} radius={14} />
        <Skeleton height={58} radius={12} />
        <Skeleton height={58} radius={12} />
      </View>
    );
  }

  const [hero, ...rest] = certs;
  const owned = classes.filter((c) => c.owned);
  const accentIndex = accentIndexMap(classes);
  const inProgress = owned.filter(
    (c) => c.progress && c.progress.total > 0 && c.progress.completed < c.progress.total
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {hero ? (
        <View style={styles.heroCard}>
          <View style={styles.heroGlow} />
          <View style={styles.heroTop}>
            <LinearGradient
              colors={[colors.ctaStart, colors.ctaEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.seal}
            >
              <Ionicons name="ribbon-outline" size={20} color="#ffffff" />
            </LinearGradient>
            <Text style={styles.heroEyebrow}>CERTIFICATE OF COMPLETION</Text>
          </View>
          <Text style={styles.heroName}>{hero.className}</Text>
          <Text style={styles.heroMeta}>
            Awarded to {hero.memberName} · {fmtDate(hero.issuedAt)}
          </Text>
          <Text style={styles.heroSerial}>Credential {hero.serial}</Text>
          <View style={styles.heroActions}>
            <CtaButton
              style={styles.heroBtn}
              radius={9}
              icon={
                <Ionicons name="download-outline" size={13} color="#ffffff" />
              }
              label="View PDF"
              onPress={() => openPdf(hero)}
            />
            <Press style={styles.ghostBtn} onPress={() => sharePdf(hero)}>
              <Ionicons name="share-outline" size={13} color="#ffffff" />
              <Text style={styles.ghostBtnText}>Share</Text>
            </Press>
          </View>
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <View style={styles.emptySeal}>
            <Ionicons
              name="ribbon-outline"
              size={20}
              color={colors.primaryOnDark}
            />
          </View>
          <Text style={styles.emptyTitle}>No certificates yet</Text>
          <Text style={styles.emptyBody}>
            Finish every lesson in a class to earn its certificate — your
            progress below shows how close you are.
          </Text>
        </View>
      )}

      {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

      {rest.map((c) => (
        <TouchableOpacity
          key={c.id}
          style={styles.certRow}
          activeOpacity={0.8}
          onPress={() => openPdf(c)}
        >
          <View style={styles.certRowSeal}>
            <Ionicons
              name="ribbon-outline"
              size={17}
              color={colors.primaryOnDark}
            />
          </View>
          <View style={styles.certRowInfo}>
            <Text style={styles.certRowName} numberOfLines={1}>
              {c.className}
            </Text>
            <Text style={styles.certRowMeta} numberOfLines={1}>
              Earned {fmtDate(c.issuedAt)} · {c.serial}
            </Text>
          </View>
          <Text style={styles.certRowLink}>View →</Text>
        </TouchableOpacity>
      ))}

      {inProgress.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>In progress</Text>
          {inProgress.map((c) => {
            const accent = classAccent(accentIndex.get(c.id) ?? 0);
            const p = c.progress!;
            const pct = Math.round((p.completed / p.total) * 100);
            const left = p.total - p.completed;
            return (
              <View key={c.id} style={styles.progressRow}>
                {c.imageUrl ? (
                  <Image
                    source={{ uri: c.imageUrl }}
                    style={styles.progressThumb}
                  />
                ) : (
                  <LinearGradient
                    colors={letterGradient(c.id)}
                    style={[styles.progressThumb, styles.letterBox]}
                  >
                    <Text style={styles.letter}>
                      {c.name.slice(0, 1).toUpperCase()}
                    </Text>
                  </LinearGradient>
                )}
                <View style={styles.progressInfo}>
                  <View style={styles.progressHead}>
                    <Text style={styles.progressName} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={styles.progressLeft}>
                      {left} lesson{left === 1 ? "" : "s"} left
                    </Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${pct}%`, backgroundColor: accent.color },
                      ]}
                    />
                  </View>
                </View>
              </View>
            );
          })}
        </>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.md, gap: 12 },
    skeletonWrap: {
      flex: 1,
      backgroundColor: colors.bg,
      padding: spacing.md,
      gap: spacing.sm,
    },

    heroCard: {
      backgroundColor: colors.chrome,
      borderRadius: 18,
      padding: 22,
      overflow: "hidden",
    },
    heroGlow: {
      position: "absolute",
      top: -30,
      right: -30,
      width: 130,
      height: 130,
      borderRadius: 65,
      backgroundColor: `${colors.primary}1f`,
    },
    heroTop: { flexDirection: "row", alignItems: "center", gap: 8 },
    seal: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#35b3a2",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.4,
      shadowRadius: 10,
    },
    heroEyebrow: {
      color: "rgba(255,255,255,0.6)",
      fontSize: 9.5,
      fontFamily: fonts.bold,
      letterSpacing: 1.4,
      flexShrink: 1,
    },
    heroName: {
      color: "#ffffff",
      fontSize: 18,
      fontFamily: fonts.bold,
      marginTop: 14,
    },
    heroMeta: {
      color: "rgba(255,255,255,0.55)",
      fontSize: 11.5,
      fontFamily: fonts.regular,
      marginTop: 4,
    },
    heroSerial: {
      color: "rgba(255,255,255,0.45)",
      fontSize: 10.5,
      fontFamily: fonts.medium,
      marginTop: 2,
    },
    heroActions: { flexDirection: "row", gap: 9, marginTop: 16 },
    heroBtn: { flex: 1 },
    ghostBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.25)",
      borderRadius: 9,
      paddingVertical: 10,
    },
    ghostBtnText: {
      color: "#ffffff",
      fontSize: 11.5,
      fontFamily: fonts.semibold,
    },

    actionError: {
      color: colors.danger,
      fontSize: 13,
      fontFamily: fonts.regular,
    },

    certRow: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 15,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    certRowSeal: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.chrome,
      alignItems: "center",
      justifyContent: "center",
    },
    certRowInfo: { flex: 1, gap: 1 },
    certRowName: { color: colors.text, fontSize: 13, fontFamily: fonts.semibold },
    certRowMeta: {
      color: colors.textMuted,
      fontSize: 10.5,
      fontFamily: fonts.regular,
    },
    certRowLink: {
      color: colors.primarySoft,
      fontSize: 11,
      fontFamily: fonts.semibold,
    },

    sectionTitle: {
      color: colors.text,
      fontSize: 13,
      fontFamily: fonts.semibold,
      marginHorizontal: 4,
      marginTop: 6,
      marginBottom: -3,
    },
    progressRow: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 13,
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
    },
    progressThumb: {
      width: 48,
      height: 34,
      borderRadius: 8,
      backgroundColor: colors.surfaceMuted,
    },
    letterBox: { alignItems: "center", justifyContent: "center" },
    letter: {
      color: "rgba(255,255,255,0.6)",
      fontSize: 13,
      fontFamily: fonts.extrabold,
    },
    progressInfo: { flex: 1, gap: 5 },
    progressHead: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "baseline",
      gap: spacing.sm,
    },
    progressName: {
      color: colors.text,
      fontSize: 12,
      fontFamily: fonts.semibold,
      flexShrink: 1,
    },
    progressLeft: {
      color: colors.textMuted,
      fontSize: 10.5,
      fontFamily: fonts.regular,
    },
    progressTrack: {
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.surfaceMuted,
      overflow: "hidden",
    },
    progressFill: { height: 4, borderRadius: 2 },

    emptyCard: {
      backgroundColor: colors.chrome,
      borderRadius: 18,
      padding: 22,
      alignItems: "center",
      gap: 6,
    },
    emptySeal: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: "rgba(255,255,255,0.1)",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 4,
    },
    emptyTitle: { color: "#ffffff", fontSize: 15, fontFamily: fonts.bold },
    emptyBody: {
      color: "rgba(255,255,255,0.55)",
      fontSize: 12,
      lineHeight: 17.5,
      textAlign: "center",
      fontFamily: fonts.regular,
    },
  });
