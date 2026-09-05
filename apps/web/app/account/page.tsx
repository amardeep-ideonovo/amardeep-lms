"use client";

import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AuthUser,
  DeleteAccountSummaryDTO,
  MyCertificateDTO,
  SubscriptionDetailDTO,
} from "@lms/types";
import { PASSWORD_MIN, STR, formatMoney } from "@lms/types";
import { Button, buttonClass, MobileConnectCard } from "@lms/ui";
import { ApiError, api, clearToken } from "@/lib/api";
import { qk, useMe, useMySubscriptions } from "@/lib/queries";
import AuthGate from "@/components/AuthGate";
import AvatarCropper from "@/components/AvatarCropper";
import PageBand from "@/components/PageBand";
import { useModalA11y } from "@/lib/useModalA11y";

// Avatar fallback initials from the member's name, else username/email.
function avatarInitials(u: AuthUser): string {
  const src =
    [u.firstName, u.lastName].filter(Boolean).join(" ") ||
    u.username ||
    u.email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "M") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// True when a subscription's latest charge failed and it hasn't recovered.
function isPastDue(sub: SubscriptionDetailDTO): boolean {
  const s = (sub.status || "").toLowerCase();
  return s === "past_due" || s === "unpaid";
}

// Status pill for a membership row: green active, amber paused/canceling, red
// past-due (a failed payment must never read as a healthy green pill).
function planStatus(sub: SubscriptionDetailDTO): {
  label: string;
  cls: string;
} {
  if (sub.cancelAtPeriodEnd)
    return {
      label: sub.currentPeriodEnd
        ? `Cancels ${fmtDate(sub.currentPeriodEnd)}`
        : "Canceling",
      cls: "plan-status--cancel",
    };
  if (sub.paused) return { label: "Paused", cls: "plan-status--paused" };
  if (isPastDue(sub)) return { label: "Past due", cls: "plan-status--pastdue" };
  const s = sub.status || "active";
  return {
    label: s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " "),
    cls: "plan-status--active",
  };
}

// Class-completion certificates the member has earned (claimed on the final
// lesson or the class page). Self-contained: own fetch, own empty state.
function CertificatesSection() {
  const [certs, setCerts] = useState<MyCertificateDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .myCertificates()
      .then((rows) => active && setCerts(rows))
      .catch(() => active && setCerts([]));
    return () => {
      active = false;
    };
  }, []);

  async function download(c: MyCertificateDTO) {
    setDownloadingId(c.id);
    setError(null);
    try {
      await api.downloadCertificate(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloadingId(null);
    }
  }

  if (certs === null || certs.length === 0) return null; // nothing earned yet

  return (
    <section className="account-section">
      <h2>My certificates</h2>
      <div className="plan-list">
        {certs.map((c) => (
          <div key={c.id} className="plan-tile">
            <div className="plan-tile__info">
              <div className="plan-tile__top">
                <strong>{c.className}</strong>
              </div>
              <span className="plan-tile__meta">
                {c.serial} · issued {fmtDate(c.issuedAt)} ·{" "}
                <Link
                  href={`/verify/${c.serial}`}
                  style={{ textDecoration: "underline" }}
                >
                  verify
                </Link>
              </span>
            </div>
            <div className="plan-tile__actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => download(c)}
                disabled={downloadingId === c.id}
                aria-busy={downloadingId === c.id}
              >
                {downloadingId === c.id ? "Preparing…" : "Download"}
              </Button>
            </div>
          </div>
        ))}
      </div>
      {error && (
        <p className="alert-error" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}
    </section>
  );
}

// Danger Zone: permanent, self-service account deletion. Two-step so a member
// sees their REAL stakes (live subscriptions, certificates, lifetime purchases,
// progress) — fetched live when the modal opens — before the irreversible
// confirm. Self-contained: own state, own fetch, own modal.
function DangerZoneSection() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<DeleteAccountSummaryDTO | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [dlErr, setDlErr] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleteModalRef = useModalA11y();

  function openModal() {
    setPassword("");
    setError(null);
    setLoadErr(null);
    setDlErr(null);
    setSummary(null);
    setOpen(true);
    api
      .deleteAccountSummary()
      .then(setSummary)
      .catch((e) =>
        setLoadErr(
          e instanceof Error
            ? e.message
            : "Couldn’t load your account details.",
        ),
      );
  }

  async function confirmDelete(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.deleteMyAccount(password);
      clearToken();
      router.replace("/login?deleted=1");
      // Leave `busy` true through the redirect so the form stays disabled.
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError("Password is incorrect");
      } else if (err instanceof ApiError && err.status === 409) {
        // Subscription cancel failed — the account still exists. Keep the modal
        // (and the token) and show the server's message verbatim.
        setError(err.message);
      } else {
        setError(
          err instanceof Error ? err.message : "Couldn’t delete your account.",
        );
      }
      setBusy(false);
    }
  }

  const hasSubs = (summary?.subscriptions.length ?? 0) > 0;

  return (
    <>
      <section className="account-section">
        <h2>Delete account</h2>
        <p>
          Permanently delete your account and everything tied to it. This can’t
          be undone.
        </p>
        <Button type="button" variant="danger" onClick={openModal}>
          Delete my account
        </Button>
      </section>

      {open && (
        // Not dismissable by accident (backdrop/Escape) — use ×/Cancel/Save.
        <div
          ref={deleteModalRef}
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Delete your account?</h2>
              <button
                type="button"
                className="modal-close"
                aria-label={STR.common.close}
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              {loadErr ? (
                <div className="alert alert-error">{loadErr}</div>
              ) : !summary ? (
                <p>Loading your account details…</p>
              ) : (
                <div
                  style={{
                    maxHeight: "48vh",
                    overflowY: "auto",
                    marginBottom: 16,
                  }}
                >
                  <p>
                    Deleting your account is <strong>permanent</strong>. Here’s
                    what you’ll lose:
                  </p>

                  {summary.certificates.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <strong>Certificates</strong>
                      <p style={{ margin: "4px 0 8px" }}>
                        Public verification links will stop working permanently.
                        Download any you want to keep first.
                      </p>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {summary.certificates.map((c) => (
                          <li key={c.id} style={{ marginBottom: 8 }}>
                            {c.className} · {c.serial}{" "}
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() =>
                                api
                                  .downloadCertificate(c)
                                  .catch((err) =>
                                    setDlErr(
                                      err instanceof Error
                                        ? err.message
                                        : "Download failed",
                                    ),
                                  )
                              }
                            >
                              Download
                            </Button>
                          </li>
                        ))}
                      </ul>
                      {dlErr && (
                        <p className="alert-error" style={{ marginTop: 8 }}>
                          {dlErr}
                        </p>
                      )}
                    </div>
                  )}

                  {summary.subscriptions.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <strong>Subscriptions</strong>
                      <p style={{ margin: "4px 0 8px" }}>
                        Canceled immediately — no refund of the remaining
                        period.
                      </p>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {summary.subscriptions.map((s) => (
                          <li key={s.stripeSubId} style={{ marginBottom: 6 }}>
                            {s.levelName} — {formatMoney(s.amount, s.currency)}/
                            {s.interval}
                            {s.currentPeriodEnd
                              ? ` · renews ${fmtDate(s.currentPeriodEnd)}`
                              : ""}
                            {s.installmentsTotal != null
                              ? ` · payment ${s.installmentsPaid ?? 0} of ${s.installmentsTotal} — payments made are forfeited`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {summary.lifetimeLevels.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <strong>Lifetime plans</strong>
                      <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                        {summary.lifetimeLevels.map((l) => (
                          <li key={l.levelId} style={{ marginBottom: 6 }}>
                            {l.levelName} — permanent access, destroyed
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {summary.completedLessons > 0 && (
                    <p style={{ marginBottom: 14 }}>
                      <strong>Progress:</strong> All progress (
                      {summary.completedLessons} completed lessons).
                    </p>
                  )}

                  {summary.hasPaymentHistory && (
                    <p style={{ marginBottom: 14 }}>
                      Your in-app payment history and receipts will no longer be
                      available.
                    </p>
                  )}

                  <p style={{ marginBottom: 0 }}>
                    Free classes can be re-joined with a new account. Paid
                    purchases, certificates, and progress cannot.
                  </p>
                </div>
              )}

              <form onSubmit={confirmDelete}>
                {error && <div className="alert alert-error">{error}</div>}
                <div className="field">
                  <label htmlFor="delpw">Confirm your password</label>
                  <input
                    id="delpw"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="modal-actions">
                  <Button
                    type="submit"
                    variant="danger"
                    disabled={busy || !summary}
                  >
                    {busy
                      ? "Deleting…"
                      : hasSubs
                        ? "Cancel subscription & delete account"
                        : "Delete my account"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setOpen(false)}
                  >
                    Keep my account
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Stripe redirects back to /account?checkout=success|cancel after a Checkout
// Session. Reads search params → must sit in <Suspense>.
function CheckoutBanner() {
  const status = useSearchParams().get("checkout");
  if (status === "success") {
    return (
      <div className="alert alert-info">
        Subscription successful — your new access will appear shortly.
      </div>
    );
  }
  if (status === "cancel") {
    return (
      <div className="alert alert-info">
        Checkout canceled — you haven’t been charged.
      </div>
    );
  }
  return null;
}

function AccountInner() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Initial reads. The queries revalidate on tab focus so admin changes (e.g.
  // a paused/canceled plan) show without a manual reload; the forms/mutations
  // below stay as they are and write their responses back into the cache in
  // place (queryClient.setQueryData) exactly where they used to setState — no
  // refetch. Subscriptions render `data ?? []`, so loading and load errors
  // alike show the no-plan state, as the old catch-to-[] did.
  const meQuery = useMe();
  const subsQuery = useMySubscriptions();
  const user = meQuery.data ?? null;
  const subs = subsQuery.data ?? [];
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Member website origin, for the "connect the mobile app" code. Resolved after
  // mount (window.__ENV__ is set before hydration, but reading it during SSR
  // would render nothing and mismatch on hydrate) — so the card appears once,
  // client-side. Prefers the configured runtime origin, falls back to location.
  const [memberWebUrl, setMemberWebUrl] = useState<string | null>(null);
  useEffect(() => {
    const env = (window as unknown as { __ENV__?: { webUrl?: string } })
      .__ENV__;
    setMemberWebUrl(env?.webUrl || window.location.origin);
  }, []);
  // Member self-cancel (period end). `cancelFor` drives the confirm modal.
  const [cancelFor, setCancelFor] = useState<SubscriptionDetailDTO | null>(
    null,
  );
  const [cancelBusy, setCancelBusy] = useState(false);
  // Inline edit of name + username (email is not editable by members).
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    username: "",
  });
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  // Change-password form (separate concern from the profile edit).
  const [pwEditing, setPwEditing] = useState(false);
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);
  // Profile photo: cropper file. Busy state comes off the avatar mutations
  // below (their isPending replaced the old manual avatarBusy flag).
  const [cropFile, setCropFile] = useState<File | null>(null);
  // Object URL for the just-cropped bytes, shown while the upload is in flight.
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarErr, setAvatarErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Pure confirm with nothing to lose, so Escape may dismiss it (mirrors the
  // DialogProvider policy); the delete-account modal above stays Escape-proof.
  const cancelModalRef = useModalA11y({
    onEscape: () => {
      if (!cancelBusy) setCancelFor(null);
    },
  });

  function fail(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      clearToken();
      router.replace("/login");
      return;
    }
    setError(err instanceof Error ? err.message : STR.errors.generic);
  }

  // Initial-load failure of the profile read, shown in the same alert slot the
  // actions use. A 401 is excluded: the global handler (lib/query.tsx) is
  // already clearing the token and redirecting to /login?session=expired.
  const loadErr = meQuery.error;
  const loadError =
    loadErr && !(loadErr instanceof ApiError && loadErr.status === 401)
      ? loadErr instanceof Error
        ? loadErr.message
        : STR.errors.generic
      : null;

  async function openPortal() {
    setError(null);
    setBusy(true);
    // Open the tab synchronously inside the click so popup blockers allow it,
    // then point it at the portal URL once we have it. Sever `opener` for safety.
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const { url } = await api.portal();
      if (tab) tab.location.href = url;
      else window.location.href = url; // popup blocked → same-tab fallback
    } catch (err) {
      tab?.close();
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  // Cancel the chosen membership at period end, then refresh the plan list.
  async function doCancelMembership() {
    if (!cancelFor) return;
    setCancelBusy(true);
    setError(null);
    try {
      const updated = await api.cancelMyMembership(cancelFor.stripeSubId);
      // The endpoint returns the refreshed plan list — write it into the cache
      // in place (no refetch), exactly as the old setSubs did.
      queryClient.setQueryData(qk.mySubscriptions, updated);
      setCancelFor(null);
    } catch (err) {
      fail(err);
    } finally {
      setCancelBusy(false);
    }
  }

  function startEdit() {
    if (!user) return;
    setForm({
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      username: user.username,
    });
    setEditError(null);
    setEditing(true);
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setEditError(null);
    try {
      const updated = await api.updateMe({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        username: form.username.trim(),
      });
      // Write the response into the shared cache in place (no refetch),
      // exactly as the old setUser did — the dashboard greeting reads it too.
      queryClient.setQueryData(qk.me, updated);
      setEditing(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        fail(err);
        return;
      }
      setEditError(
        err instanceof ApiError ? err.message : "Couldn’t save your changes.",
      );
    } finally {
      setSaving(false);
    }
  }

  function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAvatarErr("Please choose an image file.");
      return;
    }
    setAvatarErr(null);
    setCropFile(file);
  }

  // Both avatar mutations share scope id "avatar" — the same entity key the
  // retired useOptimisticAction used: TanStack v5 serializes mutations sharing
  // a scope id, so an upload and a remove can never interleave their requests.
  // One deliberate difference — the old hook DROPPED an overlapping run
  // outright (a double-fire shield), while scope QUEUES its request behind the
  // in-flight one. Both buttons are disabled while either mutation is pending,
  // so a queued second run is unreachable in practice, and queueing is the
  // semantic the admin's hook already proved.
  //
  // The cropped bytes are already in the browser, so there is no reason to
  // leave the OLD photo on screen for the whole upload. Show them now (the
  // object URL rides in as a variable); the server URL replaces this the
  // moment it lands.
  const uploadAvatarMutation = useMutation({
    scope: { id: "avatar" },
    mutationFn: ({ blob }: { blob: Blob; preview: string }) =>
      api.uploadAvatar(blob),
    onMutate: ({ preview }) => {
      setAvatarErr(null);
      setAvatarPreview(preview);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.me, updated);
      setCropFile(null);
    },
    // Nothing to put back but the preview: `user` is only ever written from
    // the server response, so a failure just uncovers the previous photo.
    onError: (err) => {
      setAvatarPreview(null);
      if (err instanceof ApiError && err.status === 401) {
        fail(err);
        return;
      }
      setAvatarErr(
        err instanceof ApiError ? err.message : "Couldn’t upload the photo.",
      );
    },
    onSettled: (_data, _err, { preview }) => {
      setAvatarPreview(null);
      URL.revokeObjectURL(preview);
    },
  });

  function uploadCroppedAvatar(blob: Blob) {
    uploadAvatarMutation.mutate({ blob, preview: URL.createObjectURL(blob) });
  }

  const removeAvatarMutation = useMutation({
    // Same entity as the upload above — see the scope note there.
    scope: { id: "avatar" },
    mutationFn: () => api.updateMe({ removeAvatar: true }),
    onMutate: () => {
      setAvatarErr(null);
      // Snapshot the whole user, so a failure restores the exact photo that
      // was there rather than a re-derived guess at it. State lives in the
      // query cache, so snapshot/paint/restore go through it (same in-place
      // contract).
      const snapshot = queryClient.getQueryData<AuthUser>(qk.me) ?? null;
      queryClient.setQueryData<AuthUser>(qk.me, (u) =>
        u ? { ...u, avatarUrl: null } : u,
      );
      return snapshot;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.me, updated);
    },
    onError: (err, _vars, snapshot) => {
      // Restore the captured cache value VERBATIM, before any error handling.
      if (snapshot) queryClient.setQueryData(qk.me, snapshot);
      if (err instanceof ApiError && err.status === 401) {
        fail(err);
        return;
      }
      setAvatarErr(
        err instanceof ApiError ? err.message : "Couldn’t remove the photo.",
      );
    },
  });

  const avatarBusy =
    uploadAvatarMutation.isPending || removeAvatarMutation.isPending;

  function startPwEdit() {
    setPwForm({ current: "", next: "", confirm: "" });
    setPwError(null);
    setPwOk(false);
    setPwEditing(true);
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
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
      setPwForm({ current: "", next: "", confirm: "" });
      setPwEditing(false);
      setPwOk(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        fail(err);
        return;
      }
      setPwError(
        err instanceof ApiError
          ? err.message
          : "Couldn’t change your password.",
      );
    } finally {
      setPwSaving(false);
    }
  }

  const fullName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "—";

  return (
    <div className="account-cinema has-band">
      <PageBand
        title="Account"
        subtitle="Manage your membership and billing."
      />
      <div className="ac-wrap">
        <Suspense fallback={null}>
          <CheckoutBanner />
        </Suspense>

        {(error ?? loadError) && (
          <div className="alert alert-error">{error ?? loadError}</div>
        )}

        <section className="account-section">
          <div className="section-head">
            <h2>Your details</h2>
            {user && !editing && !pwEditing && (
              <div className="section-actions">
                <Button type="button" variant="secondary" onClick={startPwEdit}>
                  Change password
                </Button>
                <Button type="button" variant="secondary" onClick={startEdit}>
                  {STR.common.edit}
                </Button>
              </div>
            )}
          </div>
          {pwOk && !editing && !pwEditing && (
            <div className="alert alert-info">
              Your password has been updated.
            </div>
          )}
          {!user ? (
            <p className="empty">{STR.common.loading}</p>
          ) : editing ? (
            <form onSubmit={saveProfile}>
              {editError && (
                <div className="alert alert-error">{editError}</div>
              )}
              <div className="field-row">
                <div className="field">
                  <label htmlFor="firstName">{STR.labels.firstName}</label>
                  <input
                    id="firstName"
                    value={form.firstName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, firstName: e.target.value }))
                    }
                    maxLength={80}
                    required
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label htmlFor="lastName">{STR.labels.lastName}</label>
                  <input
                    id="lastName"
                    value={form.lastName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, lastName: e.target.value }))
                    }
                    maxLength={80}
                    required
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="username">{STR.labels.username}</label>
                <input
                  id="username"
                  value={form.username}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, username: e.target.value }))
                  }
                  pattern="[a-zA-Z0-9_]{3,30}"
                  title="3–30 characters: letters, numbers, or underscore"
                  required
                />
                <p className="field-hint">
                  Letters, numbers, underscore. Must be unique.
                </p>
              </div>
              <div className="field">
                <label>{STR.labels.email}</label>
                <div className="field-readonly">{user.email}</div>
                <p className="field-hint">
                  Email can’t be changed here — contact support if you need it
                  updated.
                </p>
              </div>
              <div className="form-actions">
                <Button type="submit" disabled={saving} aria-busy={saving}>
                  {saving ? STR.common.saving : "Save changes"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  aria-busy={saving}
                >
                  {STR.common.cancel}
                </Button>
              </div>
            </form>
          ) : pwEditing ? (
            <form onSubmit={savePassword}>
              {pwError && <div className="alert alert-error">{pwError}</div>}
              <div className="field">
                <label htmlFor="curpw">Current password</label>
                <input
                  id="curpw"
                  type="password"
                  autoComplete="current-password"
                  value={pwForm.current}
                  onChange={(e) =>
                    setPwForm((f) => ({ ...f, current: e.target.value }))
                  }
                  required
                  autoFocus
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="newpw">{STR.labels.newPassword}</label>
                  <input
                    id="newpw"
                    type="password"
                    autoComplete="new-password"
                    value={pwForm.next}
                    onChange={(e) =>
                      setPwForm((f) => ({ ...f, next: e.target.value }))
                    }
                    minLength={PASSWORD_MIN.member}
                    maxLength={72}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="confpw">
                    {STR.labels.confirmNewPassword}
                  </label>
                  <input
                    id="confpw"
                    type="password"
                    autoComplete="new-password"
                    value={pwForm.confirm}
                    onChange={(e) =>
                      setPwForm((f) => ({ ...f, confirm: e.target.value }))
                    }
                    minLength={PASSWORD_MIN.member}
                    maxLength={72}
                    required
                  />
                </div>
              </div>
              <p className="field-hint">
                {`At least ${PASSWORD_MIN.member} characters. Use one you don’t use elsewhere.`}
              </p>
              <div className="form-actions">
                <Button type="submit" disabled={pwSaving} aria-busy={pwSaving}>
                  {pwSaving ? STR.common.saving : "Update password"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setPwEditing(false)}
                  disabled={pwSaving}
                  aria-busy={pwSaving}
                >
                  {STR.common.cancel}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <div className="account-avatar-row">
                <div className="account-avatar">
                  {(avatarPreview ?? user.avatarUrl) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      // The local crop wins while it exists, so the new photo is
                      // on screen before the upload finishes.
                      src={avatarPreview ?? user.avatarUrl ?? undefined}
                      alt=""
                      className="account-avatar-img"
                    />
                  ) : (
                    <span className="account-avatar-initials">
                      {avatarInitials(user)}
                    </span>
                  )}
                </div>
                <div className="account-avatar-actions">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={onPickAvatar}
                  />
                  <div className="account-avatar-btns">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={avatarBusy}
                      onClick={() => fileRef.current?.click()}
                    >
                      {uploadAvatarMutation.isPending
                        ? "Uploading…"
                        : user.avatarUrl
                          ? "Change photo"
                          : "Upload photo"}
                    </Button>
                    {user.avatarUrl && (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={avatarBusy}
                        aria-busy={removeAvatarMutation.isPending}
                        onClick={() => removeAvatarMutation.mutate()}
                      >
                        {removeAvatarMutation.isPending
                          ? "Removing…"
                          : STR.common.remove}
                      </Button>
                    )}
                  </div>
                  <p className="field-hint">
                    JPG, PNG, WebP or GIF, up to 8 MB.
                  </p>
                </div>
              </div>
              {avatarErr && (
                <div className="alert alert-error">{avatarErr}</div>
              )}
              <dl className="detail-list">
                <div>
                  <dt>{STR.labels.name}</dt>
                  <dd>{fullName}</dd>
                </div>
                <div>
                  <dt>{STR.labels.email}</dt>
                  <dd>{user.email}</dd>
                </div>
                <div>
                  <dt>{STR.labels.username}</dt>
                  <dd>{user.username}</dd>
                </div>
              </dl>
            </>
          )}
        </section>

        <section className="account-section">
          <h2>{subs.length > 1 ? "Your plans" : "Your plan"}</h2>
          {subs.some(isPastDue) && (
            <div className="account-alert account-alert--pastdue" role="alert">
              <div className="account-alert__text">
                <strong>A recent payment didn’t go through.</strong>{" "}
                {subs.some((s) => isPastDue(s) && s.provider === "stripe")
                  ? "Update your payment method to keep your access."
                  : "Update your payment method in PayPal to keep your access."}
              </div>
              {subs.some((s) => isPastDue(s) && s.provider === "stripe") && (
                <Button
                  type="button"
                  onClick={openPortal}
                  disabled={busy}
                  aria-busy={busy}
                >
                  {busy ? "Redirecting…" : "Update payment method"}
                </Button>
              )}
            </div>
          )}
          {subs.length === 0 ? (
            <p className="empty">You don’t have a paid membership yet.</p>
          ) : (
            <div className="plan-list">
              {subs.map((sub) => {
                const installment = sub.installmentsTotal != null;
                const status = planStatus(sub);
                return (
                  <div key={sub.stripeSubId} className="plan-tile">
                    <div className="plan-tile__info">
                      <div className="plan-tile__top">
                        <strong>{sub.levelName}</strong>
                        <span className={`plan-status ${status.cls}`}>
                          {status.label}
                        </span>
                      </div>
                      <span className="plan-tile__meta">
                        {sub.provider === "paypal" ? "PayPal · " : ""}
                        {formatMoney(sub.amount, sub.currency)} / {sub.interval}
                        {sub.currentPeriodEnd
                          ? ` · renews ${fmtDate(sub.currentPeriodEnd)}`
                          : ""}
                        {installment
                          ? ` · payment ${sub.installmentsPaid ?? 0} of ${sub.installmentsTotal} (then lifetime)`
                          : ""}
                      </span>
                    </div>
                    <div className="plan-tile__actions">
                      {!sub.cancelAtPeriodEnd &&
                        !sub.paused &&
                        !installment && (
                          <button
                            type="button"
                            className="plan-tile__cancel"
                            onClick={() => setCancelFor(sub)}
                          >
                            {STR.common.cancel}
                          </button>
                        )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 14,
              flexWrap: "wrap",
            }}
          >
            <Link
              href="/pricing/all"
              className={buttonClass({ variant: "secondary" })}
            >
              View all plans
            </Link>
            {/* Opens the full payment history in a new tab. */}
            <a
              href="/account/payments"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass({ variant: "secondary" })}
            >
              Payment history ↗
            </a>
          </div>
        </section>

        <CertificatesSection />

        {/* Take the membership to a phone — the Spotlight app connect code. */}
        {memberWebUrl && (
          <section className="account-section">
            <h2>Mobile app</h2>
            <MobileConnectCard webUrl={memberWebUrl} audience="member" />
          </section>
        )}

        {/* Card management is a Stripe-portal feature; PayPal members manage
          their payment method in their PayPal account instead. */}
        {subs.some((s) => s.provider === "stripe") ? (
          <section className="account-section">
            <h2>Manage/Update Your Card Details</h2>
            <p>
              Update your card details through the secure Stripe customer
              portal.
            </p>
            <Button
              type="button"
              onClick={openPortal}
              disabled={busy}
              aria-busy={busy}
            >
              {busy ? "Redirecting…" : "Update Card Details"}
            </Button>
          </section>
        ) : subs.some((s) => s.provider === "paypal") ? (
          <section className="account-section">
            <h2>Payment method</h2>
            <p>
              Your subscription is billed through PayPal. Manage your payment
              method in your PayPal account at paypal.com.
            </p>
          </section>
        ) : null}

        <DangerZoneSection />
      </div>

      {cancelFor && (
        <div
          ref={cancelModalRef}
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Cancel {cancelFor.levelName}?</h2>
              <button
                type="button"
                className="modal-close"
                aria-label={STR.common.close}
                disabled={cancelBusy}
                aria-busy={cancelBusy}
                onClick={() => setCancelFor(null)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <p>
                You’ll keep access until{" "}
                {cancelFor.currentPeriodEnd
                  ? fmtDate(cancelFor.currentPeriodEnd)
                  : "the end of your billing period"}
                , then it won’t renew. You can re-subscribe anytime.
              </p>
              <div className="modal-actions">
                <Button
                  type="button"
                  variant="danger"
                  disabled={cancelBusy}
                  aria-busy={cancelBusy}
                  onClick={doCancelMembership}
                >
                  {cancelBusy ? "Canceling…" : "Cancel membership"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={cancelBusy}
                  aria-busy={cancelBusy}
                  onClick={() => setCancelFor(null)}
                >
                  Keep membership
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {cropFile && (
        <AvatarCropper
          file={cropFile}
          busy={uploadAvatarMutation.isPending}
          error={avatarErr}
          onCancel={() => {
            if (!avatarBusy) setCropFile(null);
          }}
          onApply={uploadCroppedAvatar}
        />
      )}
    </div>
  );
}

export default function AccountPage() {
  return (
    <AuthGate>
      <AccountInner />
    </AuthGate>
  );
}
