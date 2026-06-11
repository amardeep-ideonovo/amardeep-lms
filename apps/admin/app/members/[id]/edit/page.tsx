"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { MemberRow } from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";

// Edit a member's profile (first/last name, phone) on its own page. Opened from
// the "Edit" button in the members table; saves and returns to the list.
export default function EditMemberPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [member, setMember] = useState<MemberRow | null>(null);
  const [form, setForm] = useState({
    email: "",
    firstName: "",
    lastName: "",
    phone: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Admin password reset (no current password required).
  const [pw, setPw] = useState({ next: "", confirm: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  useEffect(() => {
    if (authLoading || !can("members", "read")) return;
    let active = true;
    api
      .getMember(id)
      .then((m) => {
        if (!active) return;
        setMember(m);
        setForm({
          email: m.email ?? "",
          firstName: m.firstName ?? "",
          lastName: m.lastName ?? "",
          phone: m.phone ?? "",
        });
      })
      .catch((e) =>
        active &&
        setError(e instanceof ApiError ? e.message : "Failed to load member")
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, authLoading]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!member) return;

    // Changing the email re-points login + Stripe + Mailchimp — confirm first.
    const nextEmail = form.email.trim().toLowerCase();
    if (nextEmail !== member.email) {
      const ok = await dialog.confirm({
        title: "Change member email?",
        message:
          `Change this member’s email to:\n\n${nextEmail}\n\n` +
          `• They will log in with the new email.\n` +
          `• Stripe receipts move to the new address.\n` +
          `• Their Mailchimp contact is updated.\n\nContinue?`,
      });
      if (!ok) return;
    }

    setSaving(true);
    setError(null);
    try {
      await api.updateMember(id, {
        email: form.email.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: form.phone.trim(),
      });
      router.push("/members");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save member");
      setSaving(false);
    }
  }

  async function resetPassword(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwOk(false);
    if (pw.next.length < 10) {
      setPwError("New password must be at least 10 characters.");
      return;
    }
    if (pw.next !== pw.confirm) {
      setPwError("Passwords don’t match.");
      return;
    }
    setPwSaving(true);
    try {
      await api.setMemberPassword(id, pw.next);
      setPw({ next: "", confirm: "" });
      setPwOk(true);
    } catch (err) {
      setPwError(
        err instanceof ApiError ? err.message : "Couldn’t set the password.",
      );
    } finally {
      setPwSaving(false);
    }
  }

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("members", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Edit member</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  return (
    <div>
      <Link href="/members" className="linklike">
        ← Back to members
      </Link>
      <div className="page-header" style={{ marginTop: 8 }}>
        <h1>Edit member{member ? ` — ${member.email}` : ""}</h1>
        <p className="subtitle">Update the member’s profile details.</p>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : !member ? null : (
          <form onSubmit={onSubmit}>
            <div className="field">
              <label>Email</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) =>
                  setForm((f) => ({ ...f, email: e.target.value }))
                }
              />
              {form.email.trim().toLowerCase() !== member.email && (
                <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                  Changing the email updates the member’s login, Stripe receipts,
                  and Mailchimp contact. You’ll confirm before saving.
                </p>
              )}
            </div>
            <div className="form-row">
              <div className="field">
                <label>First name</label>
                <input
                  value={form.firstName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, firstName: e.target.value }))
                  }
                  autoFocus
                />
              </div>
              <div className="field">
                <label>Last name</label>
                <input
                  value={form.lastName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, lastName: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="field">
              <label>Phone</label>
              <input
                value={form.phone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, phone: e.target.value }))
                }
                placeholder="+1 555 0100"
              />
            </div>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              Leave name or phone blank to clear it. Email can’t be empty.
            </p>
            <div className="row-actions">
              <button className="btn" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
              <Link href="/members" className="btn btn--ghost">
                Cancel
              </Link>
            </div>
          </form>
        )}
      </div>

      {member && !loading && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Reset password</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Set a new password for this member. They are not asked for their
            current one. Any active session stays valid until it expires.
          </p>
          {pwError && <p className="error">{pwError}</p>}
          {pwOk && <p className="alert-success">Password updated.</p>}
          <form onSubmit={resetPassword}>
            <div className="form-row">
              <div className="field">
                <label>New password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={pw.next}
                  onChange={(e) =>
                    setPw((p) => ({ ...p, next: e.target.value }))
                  }
                  minLength={10}
                  required
                />
              </div>
              <div className="field">
                <label>Confirm new password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={pw.confirm}
                  onChange={(e) =>
                    setPw((p) => ({ ...p, confirm: e.target.value }))
                  }
                  minLength={10}
                  required
                />
              </div>
            </div>
            <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
              At least 10 characters. The member isn’t asked for their old
              password.
            </p>
            <div className="row-actions">
              <button className="btn" type="submit" disabled={pwSaving}>
                {pwSaving ? "Setting…" : "Set new password"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
