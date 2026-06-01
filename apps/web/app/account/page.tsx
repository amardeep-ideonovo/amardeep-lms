"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { AuthUser, SubscriptionDetailDTO } from "@lms/types";
import { ApiError, api, clearToken } from "@/lib/api";
import AuthGate from "@/components/AuthGate";

function money(amount: number, currency: string): string {
  return (amount / 100).toLocaleString(undefined, {
    style: "currency",
    currency: (currency || "usd").toUpperCase(),
  });
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [subs, setSubs] = useState<SubscriptionDetailDTO[]>([]);
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

  function fail(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      clearToken();
      router.replace("/login");
      return;
    }
    setError(err instanceof Error ? err.message : "Something went wrong.");
  }

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const [u, s] = await Promise.all([
          api.me(),
          api.mySubscriptionDetails().catch(() => [] as SubscriptionDetailDTO[]),
        ]);
        if (!mounted) return;
        setUser(u);
        setSubs(s);
        setError(null);
      } catch (err) {
        if (mounted) fail(err);
      }
    }
    load();
    // Refresh on tab focus so admin changes (e.g. a paused/canceled plan) show
    // without a manual reload.
    const refresh = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openPortal() {
    setError(null);
    setBusy(true);
    try {
      const { url } = await api.portal();
      window.location.href = url;
    } catch (err) {
      fail(err);
      setBusy(false);
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
      setUser(updated);
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

  function startPwEdit() {
    setPwForm({ current: "", next: "", confirm: "" });
    setPwError(null);
    setPwOk(false);
    setPwEditing(true);
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (pwForm.next.length < 10) {
      setPwError("New password must be at least 10 characters.");
      return;
    }
    if (pwForm.next !== pwForm.confirm) {
      setPwError("New passwords don’t match.");
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
    <>
      <h1 className="page-title">Account</h1>
      <p className="page-sub">Manage your membership and billing.</p>

      <Suspense fallback={null}>
        <CheckoutBanner />
      </Suspense>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="account-section">
        <div className="section-head">
          <h2>Your details</h2>
          {user && !editing && !pwEditing && (
            <div className="section-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={startPwEdit}
              >
                Change password
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={startEdit}
              >
                Edit
              </button>
            </div>
          )}
        </div>
        {pwOk && !editing && !pwEditing && (
          <div className="alert alert-info">
            Your password has been updated.
          </div>
        )}
        {!user ? (
          <p className="empty">Loading…</p>
        ) : editing ? (
          <form onSubmit={saveProfile}>
            {editError && <div className="alert alert-error">{editError}</div>}
            <div className="field-row">
              <div className="field">
                <label htmlFor="firstName">First name</label>
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
                <label htmlFor="lastName">Last name</label>
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
              <label htmlFor="username">Username</label>
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
              <label>Email</label>
              <div className="field-readonly">{user.email}</div>
              <p className="field-hint">
                Email can’t be changed here — contact support if you need it
                updated.
              </p>
            </div>
            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancel
              </button>
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
                <label htmlFor="newpw">New password</label>
                <input
                  id="newpw"
                  type="password"
                  autoComplete="new-password"
                  value={pwForm.next}
                  onChange={(e) =>
                    setPwForm((f) => ({ ...f, next: e.target.value }))
                  }
                  minLength={10}
                  maxLength={72}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="confpw">Confirm new password</label>
                <input
                  id="confpw"
                  type="password"
                  autoComplete="new-password"
                  value={pwForm.confirm}
                  onChange={(e) =>
                    setPwForm((f) => ({ ...f, confirm: e.target.value }))
                  }
                  minLength={10}
                  maxLength={72}
                  required
                />
              </div>
            </div>
            <p className="field-hint">
              At least 10 characters. Use one you don’t use elsewhere.
            </p>
            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={pwSaving}
              >
                {pwSaving ? "Saving…" : "Update password"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setPwEditing(false)}
                disabled={pwSaving}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <dl className="detail-list">
            <div>
              <dt>Name</dt>
              <dd>{fullName}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Username</dt>
              <dd>{user.username}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="account-section">
        <h2>Your plan</h2>
        {subs.length === 0 ? (
          <p className="empty">You don’t have a paid membership yet.</p>
        ) : (
          <dl className="detail-list">
            {subs.map((sub) => (
              <div key={sub.stripeSubId}>
                <dt>{sub.levelName}</dt>
                <dd>
                  {money(sub.amount, sub.currency)} / {sub.interval}
                  {sub.currentPeriodEnd
                    ? ` · renews ${fmtDate(sub.currentPeriodEnd)}`
                    : ""}
                  {sub.cancelAtPeriodEnd ? " · cancels at period end" : ""}
                  {sub.paused ? " · paused" : ""}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <div
          style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap" }}
        >
          <Link href="/pricing/all" className="btn btn-secondary">
            View all plans
          </Link>
          {/* Opens the full payment history in a new tab. */}
          <a
            href="/account/payments"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Payment history ↗
          </a>
        </div>
      </section>

      <section className="account-section">
        <h2>Manage subscription</h2>
        <p>
          Update your card, change plan, or cancel through the secure Stripe
          customer portal.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={openPortal}
          disabled={busy}
        >
          {busy ? "Redirecting…" : "Manage subscription"}
        </button>
      </section>
    </>
  );
}

export default function AccountPage() {
  return (
    <AuthGate>
      <AccountInner />
    </AuthGate>
  );
}
