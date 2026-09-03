import React, { useCallback, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AuthUser,
  DeleteAccountSummaryDTO,
  SubscriptionDetailDTO,
} from "@lms/types";
import { PASSWORD_MIN, STR } from "@lms/types";

import { api } from "../api";
import { useAuth } from "../auth";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { ErrorState } from "../components/Screen";
import { Skeleton } from "../components/Skeleton";
import { useAppConfig } from "../config-provider";
import { IS_LOCKED_BUILD, unbindInstance } from "../config";
import { fmtDate, money } from "../format";
import type { TabScreenProps } from "../navigation";
import {
  qk,
  useMe,
  useMySubscriptionDetails,
  useRefreshOnFocus,
} from "../queries";
import { contentColumn, formColumn } from "../responsive";
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

// Avatar fallback initials from the member's name, else username/email.
function initialsOf(u: AuthUser): string {
  const src =
    [u.firstName, u.lastName].filter(Boolean).join(" ") ||
    u.username ||
    u.email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "M") + (parts[1]?.[0] ?? "")).toUpperCase();
}

type DetailsMode = "view" | "edit" | "password";

export function AccountScreen({ navigation }: TabScreenProps<"Profile">) {
  const styles = useStyles(makeStyles);
  const { config } = useAppConfig();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();

  // Profile + subscriptions come from the shared cache (`me` is the same entry
  // Home's greeting reads, so edits here propagate there instantly). react-query
  // keeps the rendered account across refetches — coming back from Payments/
  // Plans/Certificates never drops the profile to skeletons, and a failed
  // refetch keeps the content instead of swapping in an error page (the old
  // loadedOnce guard, now for free). A billing hiccup still can't blank the
  // profile: useMySubscriptionDetails resolves [] instead of erroring, so only
  // the `me` read is fatal.
  const meQuery = useMe();
  const subsQuery = useMySubscriptionDetails();
  const user = meQuery.data ?? null;
  const subs: SubscriptionDetailDTO[] = subsQuery.data ?? [];
  // First load only (both halves, like the old Promise.all): once data exists
  // the cache keeps it through every revalidation.
  const loading = meQuery.isLoading || subsQuery.isLoading;

  // Your details card: exactly one of view / edit / change-password is visible.
  const [mode, setMode] = useState<DetailsMode>("view");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    username: "",
  });
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  // Member self-cancel (period end). `cancelFor` drives the confirm modal.
  const [cancelFor, setCancelFor] = useState<SubscriptionDetailDTO | null>(
    null,
  );
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Member self-service account deletion (irreversible). Two-step modal: review
  // the member's real stakes, then confirm with the account password.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteStep, setDeleteStep] = useState<"review" | "confirm">("review");
  const [deleteSummary, setDeleteSummary] =
    useState<DeleteAccountSummaryDTO | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteLoadError, setDeleteLoadError] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Profile photo upload/remove.
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // Both avatar mutations write the SAME cache slice, so they share one entity
  // scope (overlapping runs would queue, not interleave). In practice overlap
  // is unreachable anyway: every avatar control is disabled while either is
  // pending — which is exactly what makes the plain `onMutate` snapshot below
  // safe (see docs/coding-standards.md D4: `onMutate` runs at mutate() time,
  // before any scope-queue turn, so it must never capture mid-flight state;
  // here there is none to capture). The snapshot is restored VERBATIM, never
  // re-derived; if a background refetch replaced the entry mid-flight the
  // restore wins and the screen is briefly stale — self-healing on the next
  // revalidation, and the honest choice over rendering a failed write as done.
  //
  // Optimistic: show the photo the member just cropped instead of leaving the
  // OLD one up for the whole upload. <Image> renders the picker's local
  // file:// URI exactly like the served /media URL, so when the response lands
  // the swap to the real URL is invisible. A profile photo is cosmetic — it
  // grants nothing — so it is safe to be wrong about. The paint lives in
  // `onMutate`, which only runs once `mutate()` is called — the permission and
  // picker early-outs in pickAvatar below happen BEFORE that, so a failure
  // there has nothing to undo (the old revert-only-after-swap rule).
  const pickAvatarMutation = useMutation({
    scope: { id: "avatar" },
    mutationFn: ({ uri, mimeType }: { uri: string; mimeType?: string }) =>
      api.uploadAvatar(uri, mimeType),
    onMutate: ({ uri }) => {
      const snapshot = queryClient.getQueryData<AuthUser>(qk.me) ?? null;
      queryClient.setQueryData<AuthUser>(qk.me, (prev) =>
        prev ? { ...prev, avatarUrl: uri } : prev,
      );
      return snapshot;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.me, updated);
    },
    onError: (e, _vars, snapshot) => {
      // Upload failed -> the previous photo comes back, before any messaging.
      if (snapshot) queryClient.setQueryData(qk.me, snapshot);
      setAvatarError(
        e instanceof Error ? e.message : "Couldn't update your photo.",
      );
    },
  });

  const removeAvatarMutation = useMutation({
    // Same entity as the upload above — see the scope note there.
    scope: { id: "avatar" },
    mutationFn: () => api.updateMe({ removeAvatar: true }),
    // Optimistic in the same way: the photo drops to the initials fallback now,
    // and comes back untouched if the request fails.
    onMutate: () => {
      const snapshot = queryClient.getQueryData<AuthUser>(qk.me) ?? null;
      queryClient.setQueryData<AuthUser>(qk.me, (prev) =>
        prev ? { ...prev, avatarUrl: null } : prev,
      );
      return snapshot;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.me, updated);
    },
    onError: (e, _vars, snapshot) => {
      if (snapshot) queryClient.setQueryData(qk.me, snapshot);
      setAvatarError(
        e instanceof Error ? e.message : "Couldn't remove the photo.",
      );
    },
  });

  // Drives the same "Uploading…" / "Removing…" labels and disabled states as
  // the old busy flag.
  const avatarBusy: null | "pick" | "remove" = pickAvatarMutation.isPending
    ? "pick"
    : removeAvatarMutation.isPending
      ? "remove"
      : null;

  // Refetch on focus so admin-side changes (paused/canceled plan) show up.
  useRefreshOnFocus(() => {
    void meQuery.refetch();
    void subsQuery.refetch();
  });

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

  // Pick a photo from the library, square-cropped via the native editor, then
  // upload. The picker's allowsEditing flow IS the resize/crop step on mobile.
  // Nothing is painted until the pick succeeds and `mutate()` runs — a denied
  // permission, a cancel or a picker error bails out with nothing to undo.
  async function pickAvatar() {
    setAvatarError(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setAvatarError("Photo access is needed to choose a picture.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      pickAvatarMutation.mutate({ uri: asset.uri, mimeType: asset.mimeType });
    } catch (e) {
      // The picker itself failed — no optimistic paint has happened yet.
      setAvatarError(
        e instanceof Error ? e.message : "Couldn't update your photo.",
      );
    }
  }

  function removeAvatar() {
    setAvatarError(null);
    removeAvatarMutation.mutate();
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
      // Server truth straight into the shared `me` entry (Home reads it too).
      queryClient.setQueryData(qk.me, updated);
      setMode("view");
    } catch (e) {
      // ApiError.message surfaces server checks, e.g. "Username is already taken".
      setEditError(
        e instanceof Error ? e.message : "Couldn't save your changes.",
      );
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
    if (pwForm.next.length < PASSWORD_MIN.member) {
      setPwError(STR.validation.passwordMin(PASSWORD_MIN.member));
      return;
    }
    if (pwForm.next !== pwForm.confirm) {
      setPwError(STR.errors.passwordsDontMatch);
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
      setPwError(
        e instanceof Error ? e.message : "Couldn't change your password.",
      );
    } finally {
      setPwSaving(false);
    }
  }

  async function doCancelMembership() {
    if (!cancelFor) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      // The endpoint returns the fresh subscription list — write it into the
      // shared cache entry (Plans reads the same one).
      queryClient.setQueryData(
        qk.mySubscriptionDetails,
        await api.cancelMyMembership(cancelFor.stripeSubId),
      );
      setCancelFor(null);
    } catch (e) {
      setCancelError(
        e instanceof Error ? e.message : "Couldn't cancel the membership.",
      );
    } finally {
      setCancelBusy(false);
    }
  }

  // Fetch the "what you'll lose" summary from the live API so the confirm shows
  // true stakes rather than boilerplate. Kept separate so the review step can
  // offer a retry when the fetch itself fails.
  const loadDeleteSummary = useCallback(async () => {
    setDeleteLoading(true);
    setDeleteLoadError(null);
    try {
      setDeleteSummary(await api.deleteAccountSummary());
    } catch (e) {
      setDeleteLoadError(
        e instanceof Error ? e.message : "Couldn't load your account details.",
      );
    } finally {
      setDeleteLoading(false);
    }
  }, []);

  function openDelete() {
    setDeleteStep("review");
    setDeleteSummary(null);
    setDeleteLoadError(null);
    setDeletePassword("");
    setDeleteError(null);
    setDeleteBusy(false);
    setDeleteOpen(true);
    void loadDeleteSummary();
  }

  function closeDelete() {
    if (deleteBusy) return; // never dismiss mid-request
    setDeleteOpen(false);
  }

  async function doDeleteAccount() {
    if (!deletePassword) {
      setDeleteError("Enter your password to confirm.");
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      // The DELETE must fire and fully RESOLVE against the CURRENTLY bound API
      // (the api client reads the live API_BASE_URL per call) before anything
      // clears the token or instance binding.
      await api.deleteMyAccount(deletePassword);
    } catch (e) {
      // 400 wrong password / 409 subscription-cancel-failed: the account still
      // exists — surface the server message inline and keep the modal open
      // (do NOT sign out).
      setDeleteError(
        e instanceof Error ? e.message : "Couldn't delete your account.",
      );
      setDeleteBusy(false);
      return;
    }
    // Deletion succeeded. Sign out first (clears the token; App.tsx swaps to
    // the auth stack), THEN — for a shared build only — unbind so the app
    // returns to the Connect screen; a locked/white-label build stops at
    // sign-out (it serves a single instance for the life of the binary).
    await signOut();
    if (!IS_LOCKED_BUILD) await unbindInstance();
  }

  // Error page only before the first success (a failed refetch keeps the
  // rendered account), and only for `me` — subscriptions resolve [] on failure.
  if (meQuery.isError && !user && !meQuery.isFetching)
    return (
      <ErrorState
        message={
          meQuery.error instanceof Error
            ? meQuery.error.message
            : "Could not load your account."
        }
        onRetry={() => {
          void meQuery.refetch();
          void subsQuery.refetch();
        }}
      />
    );

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
                  <View
                    style={[styles.avatarBlock, avatarBusy && { opacity: 0.6 }]}
                  >
                    {user.avatarUrl ? (
                      <Image
                        source={{ uri: user.avatarUrl }}
                        style={styles.avatarImg}
                      />
                    ) : (
                      <View style={styles.avatarFallback}>
                        <Text style={styles.avatarInitials}>
                          {initialsOf(user)}
                        </Text>
                      </View>
                    )}
                    <View style={styles.avatarActions}>
                      <Button
                        variant="secondary"
                        style={styles.grow}
                        onPress={pickAvatar}
                        disabled={!!avatarBusy}
                        label={
                          avatarBusy === "pick"
                            ? "Uploading…"
                            : user.avatarUrl
                              ? "Change photo"
                              : "Add photo"
                        }
                      />
                      {/* The optimistic remove clears `avatarUrl` immediately,
                          which would yank this button out from under the tap —
                          keep it mounted for the in-flight window so its
                          "Removing…" state still reads. */}
                      {user.avatarUrl || avatarBusy === "remove" ? (
                        <Button
                          variant="secondary"
                          style={styles.grow}
                          onPress={removeAvatar}
                          disabled={!!avatarBusy}
                          label={
                            avatarBusy === "remove"
                              ? "Removing…"
                              : STR.common.remove
                          }
                        />
                      ) : null}
                    </View>
                  </View>
                  {avatarError ? (
                    <Text style={styles.formError}>{avatarError}</Text>
                  ) : null}
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Name</Text>
                    <Text style={styles.detailValue}>{fullName}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{STR.labels.email}</Text>
                    <Text style={styles.detailValue}>{user.email}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>
                      {STR.labels.username}
                    </Text>
                    <Text style={styles.detailValue}>{user.username}</Text>
                  </View>
                  <View style={styles.actionsRow}>
                    <Button
                      variant="secondary"
                      style={styles.grow}
                      onPress={startEdit}
                      label={STR.common.edit}
                    />
                    <Button
                      variant="secondary"
                      style={styles.grow}
                      onPress={startPwEdit}
                      label="Change password"
                    />
                  </View>
                </>
              ) : mode === "edit" ? (
                <>
                  {editError ? (
                    <Text style={styles.formError}>{editError}</Text>
                  ) : null}
                  <Text style={styles.inputLabel}>{STR.labels.firstName}</Text>
                  <TextInput
                    style={styles.input}
                    value={form.firstName}
                    onChangeText={(v) =>
                      setForm((f) => ({ ...f, firstName: v }))
                    }
                    maxLength={80}
                    editable={!saving}
                  />
                  <Text style={styles.inputLabel}>{STR.labels.lastName}</Text>
                  <TextInput
                    style={styles.input}
                    value={form.lastName}
                    onChangeText={(v) =>
                      setForm((f) => ({ ...f, lastName: v }))
                    }
                    maxLength={80}
                    editable={!saving}
                  />
                  <Text style={styles.inputLabel}>{STR.labels.username}</Text>
                  <TextInput
                    style={styles.input}
                    value={form.username}
                    onChangeText={(v) =>
                      setForm((f) => ({ ...f, username: v }))
                    }
                    maxLength={30}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!saving}
                  />
                  <Text style={styles.inputLabel}>{STR.labels.email}</Text>
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
                      accessibilityRole="button"
                    >
                      <Text style={styles.btnPrimaryText}>
                        {saving ? STR.common.saving : "Save changes"}
                      </Text>
                    </TouchableOpacity>
                    <Button
                      variant="secondary"
                      style={styles.grow}
                      onPress={() => setMode("view")}
                      disabled={saving}
                      label={STR.common.cancel}
                    />
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
                    onChangeText={(v) =>
                      setPwForm((f) => ({ ...f, current: v }))
                    }
                    secureTextEntry
                    maxLength={72}
                    autoCapitalize="none"
                    editable={!pwSaving}
                  />
                  <Text style={styles.inputLabel}>
                    {STR.labels.newPassword}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={pwForm.next}
                    onChangeText={(v) => setPwForm((f) => ({ ...f, next: v }))}
                    secureTextEntry
                    maxLength={72}
                    autoCapitalize="none"
                    editable={!pwSaving}
                  />
                  <Text style={styles.inputLabel}>
                    {STR.labels.confirmNewPassword}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={pwForm.confirm}
                    onChangeText={(v) =>
                      setPwForm((f) => ({ ...f, confirm: v }))
                    }
                    secureTextEntry
                    maxLength={72}
                    autoCapitalize="none"
                    editable={!pwSaving}
                  />
                  <Text style={styles.hint}>
                    At least {PASSWORD_MIN.member} characters. Use one you don't
                    use elsewhere.
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
                      accessibilityRole="button"
                    >
                      <Text style={styles.btnPrimaryText}>
                        {pwSaving ? STR.common.saving : "Update password"}
                      </Text>
                    </TouchableOpacity>
                    <Button
                      variant="secondary"
                      style={styles.grow}
                      onPress={() => setMode("view")}
                      disabled={pwSaving}
                      label={STR.common.cancel}
                    />
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
                          accessibilityRole="button"
                        >
                          <Text style={styles.cancelLink}>
                            {STR.common.cancel}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  );
                })
              )}
              <View style={styles.actionsRow}>
                <Button
                  variant="secondary"
                  style={styles.grow}
                  onPress={() => navigation.navigate("Plans")}
                  label="View all plans"
                />
                <Button
                  variant="secondary"
                  style={styles.grow}
                  onPress={() => navigation.navigate("Payments")}
                  label="Payment history"
                />
              </View>
            </View>

            {/* Certificates live on their own Ink Hero screen now; Blog moved
                out of the tab bar, so both stay reachable from here. */}
            <View style={styles.card}>
              <Text style={styles.heading}>More</Text>
              <TouchableOpacity
                style={styles.moreRow}
                onPress={() => navigation.navigate("Certificates")}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <Text style={styles.moreText}>My certificates</Text>
                <Text style={styles.moreChevron}>›</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.moreRow, styles.moreRowDivider]}
                onPress={() => navigation.navigate("Blog")}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <Text style={styles.moreText}>Blog</Text>
                <Text style={styles.moreChevron}>›</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.moreRow, styles.moreRowDivider]}
                onPress={() => navigation.navigate("HelpdeskHome")}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <Text style={styles.moreText}>{STR.helpdesk.open}</Text>
                <Text style={styles.moreChevron}>›</Text>
              </TouchableOpacity>
            </View>

            {/* Billing is managed on the web member dashboard — the app never
                opens a payment or plan-change surface (no purchases in-app, per
                store policy and product decision). Neutral, link-free guidance:
                no purchase call-to-action. PayPal members also manage their
                payment method in their PayPal account. */}
            {subs.length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.heading}>Billing</Text>
                <Text style={styles.note}>
                  Manage your payment details and membership from your account
                  settings on the web.
                </Text>
                {subs.some((s) => s.provider === "paypal") ? (
                  <Text style={styles.note}>
                    Your PayPal-billed subscription’s payment method is managed
                    in your PayPal account at paypal.com.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* Account deletion lives directly above Sign out, where store
                reviewers expect it. Opens a two-step confirm modal. */}
            <View style={styles.card}>
              <Text style={styles.heading}>Delete account</Text>
              <Text style={styles.note}>
                Permanently delete your account and all your data. This can't be
                undone.
              </Text>
              <Button
                variant="danger"
                block
                onPress={openDelete}
                label="Delete account"
              />
            </View>
          </>
        )}

        <TouchableOpacity
          style={styles.signOut}
          onPress={signOut}
          activeOpacity={0.8}
          accessibilityRole="button"
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
            <Button
              variant="danger"
              block
              onPress={doCancelMembership}
              disabled={cancelBusy}
              label={cancelBusy ? "Canceling…" : "Cancel membership"}
            />
            <Button
              variant="secondary"
              block
              style={styles.modalKeep}
              onPress={() => setCancelFor(null)}
              disabled={cancelBusy}
              label="Keep membership"
            />
          </View>
        </View>
      </Modal>

      <Modal
        visible={deleteOpen}
        transparent
        animationType="fade"
        onRequestClose={closeDelete}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete your account?</Text>

            {deleteStep === "review" ? (
              <>
                {deleteLoading ? (
                  <Text style={styles.modalBody}>Loading your details…</Text>
                ) : deleteLoadError ? (
                  <>
                    <Text style={styles.formError}>{deleteLoadError}</Text>
                    <Button
                      variant="secondary"
                      block
                      onPress={loadDeleteSummary}
                      label={STR.common.retry}
                    />
                  </>
                ) : deleteSummary ? (
                  <>
                    <Text style={styles.modalBody}>
                      This permanently erases your account. Deleting removes:
                    </Text>
                    <ScrollView
                      style={styles.deleteScroll}
                      keyboardShouldPersistTaps="handled"
                    >
                      {deleteSummary.certificates.length > 0 ? (
                        <View style={styles.deleteGroup}>
                          <Text style={styles.deleteGroupLabel}>
                            Certificates
                          </Text>
                          {deleteSummary.certificates.map((c) => (
                            <Text key={c.id} style={styles.deleteItem}>
                              {c.className} ({c.serial}) — verification link
                              stops working
                            </Text>
                          ))}
                          <Text style={styles.deleteHint}>
                            Download any certificates you want to keep first
                            from "My certificates" in the More section above.
                          </Text>
                        </View>
                      ) : null}

                      {deleteSummary.subscriptions.length > 0 ? (
                        <View style={styles.deleteGroup}>
                          <Text style={styles.deleteGroupLabel}>
                            Memberships
                          </Text>
                          {deleteSummary.subscriptions.map((sub) => (
                            <View
                              key={sub.stripeSubId}
                              style={styles.deleteItemBlock}
                            >
                              <Text style={styles.deleteItem}>
                                {sub.levelName} —{" "}
                                {money(sub.amount, sub.currency)}/{sub.interval}
                              </Text>
                              <Text style={styles.deleteDanger}>
                                Canceled immediately, no refund
                              </Text>
                              {sub.installmentsTotal != null ? (
                                <Text style={styles.deleteDanger}>
                                  Payment {sub.installmentsPaid ?? 0} of{" "}
                                  {sub.installmentsTotal} — forfeited
                                </Text>
                              ) : null}
                            </View>
                          ))}
                        </View>
                      ) : null}

                      {deleteSummary.lifetimeLevels.length > 0 ? (
                        <View style={styles.deleteGroup}>
                          <Text style={styles.deleteGroupLabel}>
                            Lifetime plans
                          </Text>
                          {deleteSummary.lifetimeLevels.map((l) => (
                            <Text key={l.levelId} style={styles.deleteItem}>
                              {l.levelName} — permanent access lost
                            </Text>
                          ))}
                        </View>
                      ) : null}

                      {deleteSummary.completedLessons > 0 ? (
                        <View style={styles.deleteGroup}>
                          <Text style={styles.deleteGroupLabel}>Progress</Text>
                          <Text style={styles.deleteItem}>
                            All progress ({deleteSummary.completedLessons}{" "}
                            lessons)
                          </Text>
                        </View>
                      ) : null}

                      <Text style={styles.deleteClosing}>
                        Free classes can be re-joined with a new account. Paid
                        purchases, certificates and progress cannot.
                      </Text>
                    </ScrollView>

                    <Button
                      variant="danger"
                      block
                      onPress={() => {
                        setDeleteError(null);
                        setDeleteStep("confirm");
                      }}
                      label="Continue"
                    />
                  </>
                ) : null}

                <Button
                  variant="secondary"
                  block
                  style={styles.modalKeep}
                  onPress={closeDelete}
                  label="Keep my account"
                />
              </>
            ) : (
              <>
                <Text style={styles.modalBody}>
                  Enter your password to permanently delete your account. This
                  can't be undone.
                </Text>
                {deleteError ? (
                  <Text style={styles.formError}>{deleteError}</Text>
                ) : null}
                <Text style={styles.inputLabel}>{STR.labels.password}</Text>
                <TextInput
                  style={styles.input}
                  value={deletePassword}
                  onChangeText={setDeletePassword}
                  secureTextEntry
                  maxLength={72}
                  autoCapitalize="none"
                  editable={!deleteBusy}
                />
                <Button
                  variant="danger"
                  block
                  onPress={doDeleteAccount}
                  disabled={deleteBusy}
                  label={
                    deleteBusy
                      ? "Deleting…"
                      : deleteSummary && deleteSummary.subscriptions.length > 0
                        ? "Cancel subscription & delete account"
                        : "Delete account"
                  }
                />
                <Button
                  variant="secondary"
                  block
                  style={styles.modalKeep}
                  onPress={() => {
                    if (deleteBusy) return;
                    setDeleteError(null);
                    setDeleteStep("review");
                  }}
                  disabled={deleteBusy}
                  label={STR.common.back}
                />
              </>
            )}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.bg },
    content: {
      padding: spacing.md,
      paddingBottom: spacing.lg,
      ...contentColumn,
    },
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
      fontFamily: fonts.extrabold,
    },
    brandDesc: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
      textAlign: "center",
      marginTop: spacing.xs,
      fontFamily: fonts.regular,
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
      fontFamily: fonts.extrabold,
    },
    successBanner: {
      backgroundColor: colors.successBg,
      borderRadius: 10,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.md,
    },
    successText: {
      color: colors.success,
      fontSize: 14,
      fontWeight: "600",
      fontFamily: fonts.semibold,
    },
    detailRow: { marginBottom: spacing.md },
    detailLabel: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 2,
      fontFamily: fonts.bold,
    },
    detailValue: {
      color: colors.text,
      fontSize: 15,
      fontFamily: fonts.regular,
    },
    formError: {
      color: colors.danger,
      fontSize: 14,
      marginBottom: spacing.sm,
      fontFamily: fonts.regular,
    },
    inputLabel: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: "600",
      marginBottom: spacing.xs,
      fontFamily: fonts.semibold,
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
      fontFamily: fonts.regular,
    },
    readonlyBox: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 10,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
    },
    readonlyText: {
      color: colors.textMuted,
      fontSize: 15,
      fontFamily: fonts.regular,
    },
    hint: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
      fontFamily: fonts.regular,
    },
    actionsRow: {
      flexDirection: "row",
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    grow: { flex: 1 },
    avatarBlock: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    avatarImg: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.surfaceMuted,
    },
    avatarFallback: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarInitials: {
      color: colors.onPrimary,
      fontSize: 26,
      fontFamily: fonts.bold,
    },
    avatarActions: { flex: 1, flexDirection: "row", gap: spacing.sm },
    btnPrimary: {
      backgroundColor: colors.primary,
      // Match the shared Button's metrics so a flat primary and a secondary
      // Button sitting in the same actions row line up (radius/height).
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: "center",
    },
    btnPrimaryText: {
      color: colors.onPrimary,
      fontSize: 15,
      fontWeight: "700",
      fontFamily: fonts.bold,
    },
    btnDisabled: { opacity: 0.6 },
    empty: {
      color: colors.textMuted,
      fontSize: 15,
      lineHeight: 22,
      fontFamily: fonts.regular,
    },
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
    planName: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "700",
      flexShrink: 1,
      fontFamily: fonts.bold,
    },
    planMeta: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
      fontFamily: fonts.regular,
    },
    cancelLink: {
      color: colors.danger,
      fontSize: 14,
      fontWeight: "600",
      marginTop: spacing.sm,
      fontFamily: fonts.semibold,
    },
    moreRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: spacing.sm + 2,
    },
    moreRowDivider: {
      borderTopWidth: 1,
      borderTopColor: colors.borderSoft,
    },
    moreText: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "600",
      fontFamily: fonts.semibold,
    },
    moreChevron: {
      color: colors.textMuted,
      fontSize: 18,
      fontFamily: fonts.regular,
    },
    note: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: spacing.md,
      fontFamily: fonts.regular,
    },
    signOut: {
      marginTop: spacing.lg,
      alignItems: "center",
      paddingVertical: spacing.md,
    },
    signOutText: {
      color: colors.danger,
      fontSize: 16,
      fontWeight: "600",
      fontFamily: fonts.semibold,
    },
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
      ...formColumn,
    },
    modalTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "800",
      marginBottom: spacing.sm,
      fontFamily: fonts.extrabold,
    },
    modalBody: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 21,
      marginBottom: spacing.md,
      fontFamily: fonts.regular,
    },
    modalKeep: { marginTop: spacing.sm },
    deleteScroll: { maxHeight: 300, marginBottom: spacing.md },
    deleteGroup: { marginBottom: spacing.md },
    deleteGroupLabel: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: spacing.xs,
      fontFamily: fonts.bold,
    },
    deleteItemBlock: { marginBottom: spacing.sm },
    deleteItem: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 2,
      fontFamily: fonts.regular,
    },
    deleteDanger: {
      color: colors.danger,
      fontSize: 13,
      lineHeight: 18,
      fontFamily: fonts.semibold,
    },
    deleteHint: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
      marginTop: spacing.xs,
      fontFamily: fonts.regular,
    },
    deleteClosing: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
      marginTop: spacing.xs,
      fontFamily: fonts.regular,
    },
  });
