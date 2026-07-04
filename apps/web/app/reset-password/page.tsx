"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ApiError, api } from "@/lib/api";

// Self-serve password reset, step 2: the page the emailed link lands on
// (/reset-password?token=…). The signed token is the credential — the member
// isn't logged in here. Success links to /login rather than auto-signing-in:
// the API deliberately doesn't mint a session from a reset.
function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Match-check lives client-side, same as the account change-password form.
    if (password !== confirm) {
      setError("Passwords don’t match.");
      return;
    }
    setLoading(true);
    try {
      await api.resetPassword({ token, newPassword: password });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Try again."
      );
    } finally {
      setLoading(false);
    }
  }

  // No token in the URL (hand-typed path, truncated link) — send them to
  // request a fresh one instead of showing a form that can only 400.
  if (!token) {
    return (
      <>
        <h1>Reset your <span className="t-gradient">password</span></h1>
        <p className="sub">
          This reset link is missing its token. Request a new one and use the
          link from the email.
        </p>
        <p className="sub" style={{ marginTop: 16 }}>
          <Link href="/forgot-password" className="link">
            Request a new reset link
          </Link>
        </p>
      </>
    );
  }

  if (done) {
    return (
      <>
        <h1>Password <span className="t-gradient">updated</span></h1>
        <p className="sub">
          Your password has been changed. Sign in with your new password to
          get back to your courses.
        </p>
        <p className="sub" style={{ marginTop: 16 }}>
          <Link href="/login" className="link">
            Sign in
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Choose a new <span className="t-gradient">password</span></h1>
      <p className="sub">At least 10 characters.</p>

      {error && (
        <div className="alert alert-error">
          {error}{" "}
          <Link href="/forgot-password" className="link">
            Request a new link
          </Link>
        </div>
      )}

      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={72}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="confirm-password">Confirm new password</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={72}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary btn-block press"
          disabled={loading}
        >
          {loading ? "Saving…" : "Set new password"}
        </button>
      </form>
    </>
  );
}

// useSearchParams needs a Suspense boundary for the static prerender (same
// pattern as the account page). The fallback is the empty card shell.
export default function ResetPasswordPage() {
  return (
    <div className="dark-page">
      <div className="dp-wrap">
        <div className="form-card">
          <Suspense fallback={null}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
