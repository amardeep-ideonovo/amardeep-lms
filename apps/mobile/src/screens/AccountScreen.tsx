import React, { useCallback, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { AuthUser, SubscriptionDetailDTO } from "@lms/types";

import { api } from "../api";
import { useAuth } from "../auth";
import { Chip } from "../components/Chip";
import { ErrorState } from "../components/Screen";
import { Skeleton } from "../components/Skeleton";
import { useAppConfig } from "../config-provider";
import { WEB_BASE_URL } from "../config";
import { fmtDate, money } from "../format";
import type { ScreenProps } from "../navigation";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";

// Status chip for a membership: amber when canceling/paused, green otherwise
// (mirrors the web account page's planStatus).
function planStatus(sub: SubscriptionDetailDTO): {
  label: string;
  tone: "success" | "warning";
} {
  if (sub.cancelAtPeriodEnd) {
    return {
      label: sub.currentPeriodEnd
        ? `Cancels ${fmtDate(sub.currentPeriodEnd)}`
        : "Canceling",
      tone: "warning",
    };
  }
  if (sub.paused) return { label: "Paused", tone: "warning" };
  const s = sub.status || "active";
  return { label: s.charAt(0).toUpperCase() + s.slice(1), tone: "success" };
}

function planMeta(sub: SubscriptionDetailDTO): string {
  let meta = `${money(sub.amount, sub.currency)} / ${sub.interval}`;
  if (sub.currentPeriodEnd && !sub.cancelAtPeriodEnd) {
    meta += ` · renews ${fmtDate(sub.currentPeriodEnd)}`;
  }
  if (sub.installmentsTotal != null) {
    meta += ` · payment ${sub.installmentsPaid ?? 0} of ${sub.installmentsTotal}`;
  }
  return meta;
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

type DetailsMode = "view" | "edit" | "password";

export function AccountScreen({ navigation }: ScreenProps<"Account">) {
  const styles = useStyles(makeStyles);
  const { config } = useAppConfig();
  const { signOut } = useAuth();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [subs, setSubs] = useState<SubscriptionDetailDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Your details card: exactly one of view / edit / change-password is visible.
  const [mode, setMode] = useState<DetailsMode>("view");
  const [form, setForm] = useState({ firstName: "", lastName: "", username: "" });
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  // Member self-cancel (period end). `cancelFor` drives the confirm modal.
  const [cancelFor, setCancelFor] = useState<SubscriptionDetailDTO | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // A billing hiccup shouldn't blank the profile — only me() is fatal.
      const [u, s] = await Promise.all([
        api.me(),
        api.mySubscriptionDetails().catch(() => [] as SubscriptionDetailDTO[]),
      ]);
      setUser(u);
      setSubs(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your account.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload on focus so admin-side changes (paused/canceled plan) show up.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function startEdit() {
    if (!user) return;
    setForm({
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      username: user.username,
    });
    setEditError(null);
    setPwOk(false);
    setMode("edit");
  }

  function startPwEdit() {
    setPwForm({ current: "", next: "", confirm: "" });
    setPwError(null);
    setPwOk(false);
    setMode("password");
  }

  async function saveProfile() {
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const username = form.username.trim();
    if (!firstName || !lastName) {
      setEditError("First and last name are required.");
      return;
    }
    if (!USERNAME_RE.test(username)) {
      setEditError("3–30 characters: letters, numbers, or underscore.");
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      const updated = await api.updateMe({ firstName, lastName, username });
      setUser(updated);
      setMode("view");
    } catch (e) {
      // ApiError.message surfaces server checks, e.g. "Username is already taken".
      setEditError(e instanceof Error ? e.message : "Couldn't save your changes.");
    } finally {
      setSaving(false);
    }
  }

  async function savePassword() {
    setPwError(null);
    if (!pwForm.current) {
      setPwError("Enter your current password.");
      return;
    }
    if (pwForm.next.length < 10) {
      setPwError("New password must be at least 10 characters.");
      return;
    }
    if (pwForm.next !== pwForm.confirm) {
      setPwError("New passwords don't match.");
      return;
    }
    setPwSaving(true);
    try {
      await api.changePassword({
        currentPassword: pwForm.current,
        newPassword: pwForm.next,
      });
      // Wrong current password is a 400, so it lands here as an inline error
      // (never a sign-out).
      setPwForm({ current: "", next: "", confirm: "" });
      setMode("view");
      setPwOk(true);
    } catch (e) {
      setPwError(e instanceof Error ? e.message : "Couldn't change your password.");
    } finally {
      setPwSaving(false);
    }
  }

  async function doCancelMembership() {
    if (!cancelFor) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      setSubs(await api.cancelMyMembership(cancelFor.stripeSubId));
      setCancelFor(null);
    } catch (e) {
      setCancelError(
        e instanceof Error ? e.message : "Couldn't cancel the membership."
      );
    } finally {
      setCancelBusy(false);
    }
  }

  async function openPortal() {
    setPortalBusy(true);
    setPortalError(null);
    try {
      const { url } = await api.portal();
      await Linking.openURL(url);
    } catch (e) {
      setPortalError(
        e instanceof Error ? e.message : "Couldn't open the billing portal."
      );
    } finally {
      setPortalBusy(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;

  const fullName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "—";

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
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

        {loading || !user ? (
          <>
            <Skeleton height={160} radius={14} style={styles.skeleton} />
            <Skeleton height={120} radius={14} style={styles.skeleton} />
            <Skeleton height={110} radius={14} style={styles.skeleton} />
          </>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.heading}>Your details</Text>
              {pwOk && mode === "view" ? (
                <View style={styles.successBanner}>
                  <Text style={styles.successText}>
                    Your password has been updated.
                  </Text>
                </View>
              ) : null}

              {mode === "view" ? (
                <>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Name</Text>
                    <Text style={styles.detailValue}>{fullName}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Email</Text>
                    <Text style={styles.detailValue}>{user.email}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Username</Text>
                    <Text style={styles.detailValue}>{user.username}</Text>
                  </View>
                  <View style={styles.actionsRow}>
                    <TouchableOpacity
                      style={[styles.btnSecondary, styles.grow]}
                      onPress={startEdit}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.btnSecondaryText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btnSecondary, styles.grow]}
                      onPress={startPwEdit}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.btnSecondaryText}>Change password</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : mode === "edit" ? (
                <>
                  {editError ? (
                    <Text style={styles.formError}>{editError}</Text>
                  ) : null}
                  <Text style={styles.inputLabel}>First name</Text>
                  <TextInput
                    style={styles.input}
                    value={form.firstName}
                    onChangeText={(v) => setForm((f) => ({ ...f, firstName: v }))}
                    maxLength={80}
                    editable={!saving}
                  />
                  <Text style={styles.inputLabel}>Last name</Text>
                  <TextInput
                    style={styles.input}
                    value={form.lastName}
                    onChangeText={(v) => setForm((f) => ({ ...f, lastName: v }))}
                    maxLength={80}
                    editable={!saving}
                  />
                  <Text style={styles.inputLabel}>Username</Text>
                  <TextInput
                    style={styles.input}
                    value={form.username}
                    onChangeText={(v) => setForm((f) => ({ ...f, username: v }))}
                    maxLength={30}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!saving}
                  />
                  <Text style={styles.inputLabel}>Email</Text>
                  <View style={styles.readonlyBox}>
                    <Text style={styles.readonlyText}>{user.email}</Text>
                  </View>
                  <Text style={styles.hint}>
                    Email can't be changed here — contact support if you need it
                    updated.
                  </Text>
                  <View style={styles.actionsRow}>
                    <TouchableOpacity
                      style={[
                        styles.btnPrimary,
                        styles.grow,
                        saving && styles.btnDisabled,
                      ]}
                      onPress={saveProfile}
                      disabled={saving}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.btnPrimaryText}>
                        {saving ? "Saving…" : "Save changes"}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btnSecondary, styles.grow]}
                      onPress={() => setMode("view")}
                      disabled={saving}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.btnSecondaryText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  {pwError ? (
                    <Text style={styles.formError}>{pwError}</Text>
                  ) : null}
                  <Text style={styles.inputLabel}>Current password</Text>
                  <TextInput
                    style={styles.input}
                    value={pwForm.current}
                    onChangeText={(v) => setPwForm((f) => ({ ...f, current: v }))}
                    secureTextEntry
                    maxLength={72}
                    autoCapitalize="none"
                    editable={!pwSaving}
                  />
                  <Text style={styles.inputLabel}>New password</Text>
                  <TextInput
                    style={styles.input}
                    value={pwForm.next}
                    onChangeText={(v) => setPwForm((f) => ({ ...f, next: v }))}
                    secureTextEntry
                    maxLength={72}
                    autoCapitalize="none"
                    editable={!pwSaving}
                  />
                  <Text style={styles.inputLabel}>Confirm new password</Text>
                  <TextInput
                    style={styles.input}
                    value={pwForm.confirm}
                    onChangeText={(v) => setPwForm((f) => ({ ...f, confirm: v }))}
                    secureTextEntry
                    maxLength={72}
                    autoCapitalize="none"
                    editable={!pwSaving}
                  />
                  <Text style={styles.hint}>
                    At least 10 characters. Use one you don't use elsewhere.
                  </Text>
                  <View style={styles.actionsRow}>
                    <TouchableOpacity
                      style={[
                        styles.btnPrimary,
                        styles.grow,
                        pwSaving && styles.btnDisabled,
                      ]}
                      onPress={savePassword}
                      disabled={pwSaving}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.btnPrimaryText}>
                        {pwSaving ? "Saving…" : "Update password"}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btnSecondary, styles.grow]}
                      onPress={() => setMode("view")}
                      disabled={pwSaving}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.btnSecondaryText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.heading}>
                {subs.length > 1 ? "Your plans" : "Your plan"}
              </Text>
              {subs.length === 0 ? (
                <Text style={styles.empty}>
                  You don't have a paid membership yet.
                </Text>
              ) : (
                subs.map((sub, i) => {
                  const status = planStatus(sub);
                  const canCancel =
                    !sub.cancelAtPeriodEnd &&
                    !sub.paused &&
                    sub.installmentsTotal == null;
                  return (
                    <View
                      key={sub.stripeSubId}
                      style={[styles.planRow, i > 0 && styles.planRowDivider]}
                    >
                      <View style={styles.planTop}>
                        <Text style={styles.planName}>{sub.levelName}</Text>
                        <Chip label={status.label} tone={status.tone} />
                      </View>
                      <Text style={styles.planMeta}>{planMeta(sub)}</Text>
                      {canCancel ? (
                        <TouchableOpacity
                          onPress={() => {
                            setCancelError(null);
                            setCancelFor(sub);
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.cancelLink}>Cancel</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  );
                })
              )}
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.btnSecondary, styles.grow]}
                  onPress={() =>
                    Linking.openURL(WEB_BASE_URL + "/pricing/all").catch(() => {})
                  }
                  activeOpacity={0.8}
                >
                  <Text style={styles.btnSecondaryText}>View all plans ↗</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btnSecondary, styles.grow]}
                  onPress={() => navigation.navigate("Payments")}
                  activeOpacity={0.8}
                >
                  <Text style={styles.btnSecondaryText}>Payment history</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.heading}>Card details</Text>
              <Text style={styles.note}>
                Update your card details through the secure Stripe customer
                portal.
              </Text>
              {portalError ? (
                <Text style={styles.formError}>{portalError}</Text>
              ) : null}
              <TouchableOpacity
                style={[styles.btnPrimary, portalBusy && styles.btnDisabled]}
                onPress={openPortal}
                disabled={portalBusy}
                activeOpacity={0.8}
              >
                <Text style={styles.btnPrimaryText}>
                  {portalBusy ? "Opening…" : "Update card details"}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.storeNote}>
              Plan upgrades and payments are completed on our website.
            </Text>
          </>
        )}

        <TouchableOpacity
          style={styles.signOut}
          onPress={signOut}
          activeOpacity={0.8}
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={cancelFor != null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!cancelBusy) setCancelFor(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Cancel {cancelFor?.levelName}?
            </Text>
            <Text style={styles.modalBody}>
              You'll keep access until{" "}
              {cancelFor?.currentPeriodEnd
                ? fmtDate(cancelFor.currentPeriodEnd)
                : "the end of your billing period"}
              , then it won't renew. You can re-subscribe anytime.
            </Text>
            {cancelError ? (
              <Text style={styles.formError}>{cancelError}</Text>
            ) : null}
            <TouchableOpacity
              style={[styles.btnDanger, cancelBusy && styles.btnDisabled]}
              onPress={doCancelMembership}
              disabled={cancelBusy}
              activeOpacity={0.8}
            >
              <Text style={styles.btnDangerText}>
                {cancelBusy ? "Canceling…" : "Cancel membership"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnSecondary, styles.modalKeep]}
              onPress={() => setCancelFor(null)}
              disabled={cancelBusy}
              activeOpacity={0.8}
            >
              <Text style={styles.btnSecondaryText}>Keep membership</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const makeStyles = ({ colors }: Theme) => StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.lg },
  brandHeader: {
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  logo: {
    height: 40,
    width: 180,
  },
  brandTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
  },
  brandDesc: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  skeleton: { marginBottom: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: 14,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  heading: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: spacing.md,
  },
  successBanner: {
    backgroundColor: colors.successBg,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  successText: { color: colors.success, fontSize: 14, fontWeight: "600" },
  detailRow: { marginBottom: spacing.md },
  detailLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailValue: { color: colors.text, fontSize: 15 },
  formError: { color: colors.danger, fontSize: 14, marginBottom: spacing.sm },
  inputLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.md,
  },
  readonlyBox: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  readonlyText: { color: colors.textMuted, fontSize: 15 },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  actionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  grow: { flex: 1 },
  btnPrimary: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnPrimaryText: { color: colors.onPrimary, fontSize: 15, fontWeight: "700" },
  btnSecondary: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnSecondaryText: { color: colors.text, fontSize: 15, fontWeight: "600" },
  btnDisabled: { opacity: 0.6 },
  empty: { color: colors.textMuted, fontSize: 15, lineHeight: 22 },
  planRow: { paddingVertical: spacing.sm },
  planRowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    marginTop: spacing.xs,
    paddingTop: spacing.md,
  },
  planTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  planName: { color: colors.text, fontSize: 16, fontWeight: "700", flexShrink: 1 },
  planMeta: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  cancelLink: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: "600",
    marginTop: spacing.sm,
  },
  note: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  storeNote: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  signOut: {
    marginTop: spacing.lg,
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  signOutText: { color: colors.danger, fontSize: 16, fontWeight: "600" },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlayMid,
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: 14,
    padding: spacing.lg,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: spacing.sm,
  },
  modalBody: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: spacing.md,
  },
  btnDanger: {
    backgroundColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnDangerText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  modalKeep: { marginTop: spacing.sm },
});
